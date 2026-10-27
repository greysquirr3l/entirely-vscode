import * as vscode from 'vscode';
import { summariseSettings } from '../lib/entire';
import { readExtensionSettings } from './configuration';
import { readEntireSettings } from './settingsSource';

import { decodeWorkspaceStatus, unwrap, type WorkspaceStatus } from '../lib/entire';
import { CliRunner } from './cli';
import { watchHeadChanges } from './headWatcher';
import type { HookBridge } from './hookBridge';
import { enableEntire } from './setup';
import type { StatusBar, StatusDisplay } from './statusBar';

/** What the controller needs to do its job. */
export interface StatusControllerOptions {
	readonly statusBar: StatusBar;
	readonly runner: CliRunner;
	readonly output: vscode.OutputChannel;
	/**
	 * Where the workspace's agent activity is reported.
	 *
	 * The controller is the one thing that knows whether the workspace is
	 * tracked, and a session only begins in a tracked workspace.
	 */
	readonly hooks?: HookBridge;
}

/** What clicking the status bar item does. */
export type ClickAction =
	/** Open the Entire view. */
	| 'show-sessions'
	/** Offer to set Entire up for the workspace. */
	| 'set-up'
	/** Explain that the workspace cannot be tracked. */
	| 'explain-not-a-repository'
	/** Report the error and offer the logs. */
	| 'show-error';

/**
 * What clicking the item does for a state.
 *
 * A tracked workspace opens the view. A workspace that could be tracked
 * offers to set it up. A workspace that cannot be tracked, and a CLI that
 * could not be read, each explain themselves.
 */
export function clickAction(display: StatusDisplay | undefined): ClickAction {
	switch (display?.kind) {
		case 'not-set-up':
			return 'set-up';
		case 'not-a-repository':
			return 'explain-not-a-repository';
		case 'error':
			return 'show-error';
		default:
			return 'show-sessions';
	}
}

/** The status bar rendering for a workspace status. */
function toDisplay(status: WorkspaceStatus, settings: readonly string[]): StatusDisplay {
	switch (status.kind) {
		case 'tracked': {
			const session = status.activeSessions[0];
			return session
				? { kind: 'active-session', agent: session.agent, settings }
				: { kind: 'tracked', settings };
		}
		case 'not-set-up':
			return { kind: 'not-set-up', settings };
		case 'not-a-repository':
			return { kind: 'not-a-repository' };
	}
}

/**
 * Keeps the status bar in step with the workspace's tracking state.
 *
 * The controller owns the conversation with the CLI: it discovers the CLI,
 * reads the workspace status, renders the result, and decides what clicking
 * the item should do. The status bar itself renders and nothing more.
 */
export class StatusController {
	private readonly disposables: vscode.Disposable[] = [];
	private display: StatusDisplay | undefined;
	private timer: NodeJS.Timeout | undefined;
	private sessionStarted = false;

	constructor(private readonly options: StatusControllerOptions) {
		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.refresh();
			}),

			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('entirely.cliPath')) {
					this.options.runner.setConfiguredPath(this.configuredPath());
				}
				this.schedulePolling();
				void this.refresh();
			}),

			watchHeadChanges(() => {
				void this.refresh();
			}),
		);

		this.schedulePolling();
	}

	/** The state currently on show. */
	get current(): StatusDisplay | undefined {
		return this.display;
	}

	/**
	 * Reads the workspace state and renders it.
	 *
	 * Every failure is a state rather than an exception: a CLI that is
	 * missing, broken or slow must never take the extension down with it.
	 */
	async refresh(): Promise<void> {
		const runner = this.options.runner;

		const discovery = await runner.discover();
		if (discovery.state === 'absent') {
			// The extension stays invisible in a workspace that does not use
			// Entire, so an absent CLI means no item at all.
			this.display = undefined;
			this.options.statusBar.hide();
			return;
		}

		if (discovery.state === 'broken') {
			this.display = { kind: 'error', detail: discovery.detail };
			this.options.statusBar.show(this.display);
			return;
		}

		const result = await runner.runJson(
			['status', '--json'],
			value => unwrap(decodeWorkspaceStatus(value)),
			{ cwd: this.workspaceRoot() },
		);

		if (!result.ok) {
			this.display = { kind: 'error', detail: result.detail };
			this.options.statusBar.show(this.display);
			return;
		}

		this.display = toDisplay(result.value, this.effectiveSettings());
		this.options.statusBar.show(this.display);
		this.beginSession();
	}

	/**
	 * Reports the start of a session, once per workspace.
	 *
	 * A session only exists in a workspace that Entire is tracking, and it
	 * only starts once: the events that follow it belong to it.
	 */
	private beginSession(): void {
		if (this.sessionStarted || !this.options.hooks) {
			return;
		}

		if (this.display?.kind !== 'tracked') {
			return;
		}

		this.sessionStarted = true;
		const cwd = this.workspaceRoot();
		if (!cwd) {
			return;
		}

		this.options.hooks.post('SessionStart', { cwd });
	}

	/**
	 * What clicking the status bar item should do.
	 *
	 * The action depends on the state: a tracked workspace opens the view,
	 * a workspace that could be tracked offers to set it up, and a
	 * workspace that cannot explains why.
	 */
	async handleClick(): Promise<void> {
		const display = this.display;

		switch (clickAction(display)) {
			case 'set-up':
				await this.offerToSetUp();
				return;

			case 'explain-not-a-repository':
				await vscode.window.showInformationMessage(
					'This workspace is not a git repository, so Entire cannot track it.',
				);
				return;

			case 'show-error': {
				const detail = display?.kind === 'error' ? display.detail : 'unknown error';
				const choice = await vscode.window.showErrorMessage(
					`Entirely could not read the Entire CLI: ${detail}`,
					'Show Logs',
				);
				if (choice === 'Show Logs') {
					this.options.output.show(true);
				}
				return;
			}

			case 'show-sessions':
				await vscode.commands.executeCommand('entirely.showSessions');
		}
	}

	/** Offers to set Entire up for the workspace. */
	async offerToSetUp(): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			'Set up Entire for this workspace? It installs hooks so agent sessions are recorded.',
			'Set Up',
		);

		if (choice !== 'Set Up') {
			return;
		}

		await this.setUp();
	}

	/**
	 * Runs the CLI's own setup command.
	 *
	 * The flags are read from the CLI's help rather than assumed, because
	 * the CLI is the source of truth for its own behaviour and may not
	 * support every flag on every version.
	 */
	async setUp(): Promise<void> {
		const setUp = await enableEntire(
			this.options.runner,
			this.workspaceRoot(),
			this.options.output,
		);

		if (setUp) {
			await this.refresh();
		}
	}

	/** The path the user configured for the CLI, if any. */
	private configuredPath(): string | undefined {
		return readExtensionSettings().cliPath;
	}

	/**
	 * The settings that are in effect for this workspace.
	 *
	 * These are Entire's own settings, read through the same layering the
	 * CLI reads them through, so the tooltip says what the CLI would do.
	 */
	private effectiveSettings(): readonly string[] {
		return summariseSettings(readEntireSettings(this.workspaceRoot()));
	}

	/** The directory the CLI should run in. */
	private workspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	/** Starts, stops or restarts the polling timer. */
	private schedulePolling(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		const seconds = vscode.workspace.getConfiguration('entirely').get<number>('refreshInterval', 30);
		if (seconds > 0) {
			this.timer = setInterval(() => {
				void this.refresh();
			}, seconds * 1000);
		}
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}
}
