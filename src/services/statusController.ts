import * as vscode from 'vscode';
import { summariseSettings } from '../lib/entire';
import { readExtensionSettings } from './configuration';
import { readEntireSettings } from './settingsSource';

import {
	decodeWorkspaceStatus,
	describeCheckpointProblem,
	describeDestination,
	describeUnexpectedPayload,
	resolveCheckpointDestination,
	unwrap,
	type CheckpointDestination,
	type EntireSettings,
	type WorkspaceStatus,
} from '../lib/entire';
import { CliRunner } from './cli';
import type { AccountContextService } from './accountContext';
import {
	inspectCheckpointDestination,
	type CheckpointDestinationReport,
} from './checkpointDestination';
import { watchHeadChanges } from './headWatcher';
import type { HookBridge } from './hookBridge';
import { enableEntire } from './setup';
import type { StatusBar, StatusDisplay } from './statusBar';

/** What the controller needs to do its job. */
export interface StatusControllerOptions {
	readonly statusBar: StatusBar;
	readonly runner: CliRunner;
	readonly output: Pick<vscode.OutputChannel, 'show'>;
	/**
	 * Which login the CLI is acting as.
	 *
	 * The controller reads the saved logins before anything else, because
	 * every command after that has to act as the right one.
	 */
	readonly accounts: AccountContextService;
	/**
	 * Where the workspace's agent activity is reported.
	 *
	 * The controller is the one thing that knows whether the workspace is
	 * tracked, and a session only begins in a tracked workspace.
	 */
	readonly hooks?: HookBridge;
}

/**
 * The login the extension is acting as, as the status bar needs it.
 *
 * A workspace that the acting login cannot see is a different thing from
 * a workspace that is not tracked, and the difference has to survive the
 * trip to the status bar.
 */
export interface ActingContext {
	/** The handle of the login, which is how a person knows it. */
	readonly handle: string;
	/** The name the login is saved under. */
	readonly name?: string;
	/** Whether the login cannot see this workspace. */
	readonly invisible?: boolean;
	/** What the CLI said about the workspace. */
	readonly detail?: string;
}

/** What clicking the status bar item does. */
export type ClickAction =
	/** Open the Entire view. */
	| 'show-sessions'
	/** Offer to set Entire up for the workspace. */
	| 'set-up'
	/** Explain that the workspace cannot be tracked. */
	| 'explain-not-a-repository'
	/** Explain that the login cannot see the workspace. */
	| 'explain-invisible-to-context'
	/** Explain that the login in the settings is not one the CLI has. */
	| 'explain-context-error'
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
		case 'invisible-to-context':
			return 'explain-invisible-to-context';
		case 'context-error':
			return 'explain-context-error';
		case 'error':
			return 'show-error';
		default:
			return 'show-sessions';
	}
}

/** The status bar rendering for a workspace status. */
function toDisplay(
	status: WorkspaceStatus,
	settings: readonly string[],
	destination: string | undefined,
problem: string | undefined,
	context: ActingContext | undefined,
): StatusDisplay {
	switch (status.kind) {
		case 'tracked': {
			// A login that cannot see the workspace is not the same as a
			// workspace that is not tracked, so it is said in as many
			// words rather than left to be read as "not set up".
			if (context?.invisible) {
				return {
					kind: 'invisible-to-context',
					context: context.handle,
					contextName: context.name,
					detail: context.detail,
				};
			}

			const session = status.activeSessions[0];
			return session
				? {
						kind: 'active-session',
						agent: session.agent,
						settings,
						checkpointDestination: destination,
						checkpointProblem: problem,
						context: context?.handle,
					}
				: {
						kind: 'tracked',
						settings,
						checkpointDestination: destination,
						checkpointProblem: problem,
						context: context?.handle,
					};
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
	/** The last status the CLI reported, kept so it can be read again. */
	private lastStatus: WorkspaceStatus | undefined;
	/** The settings that were in effect when the status was read. */
	private lastSettings: EntireSettings = {};
	/** What the last reachability check found. */
	private checkpointReport: CheckpointDestinationReport | undefined;
	/** The destination the reachability check was made for. */
	private checkpointReportKey: string | undefined;

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

		// The login is read first, because every command after this has
		// to act as the right one.
		const accounts = await this.options.accounts.refresh(this.workspaceRoot());

		if (accounts.problem && accounts.pinned) {
			// The login in the settings is not one the CLI has. That is a
			// mistake in the settings, and it is shown as one rather than
			// as a command that failed.
			this.display = { kind: 'context-error', detail: accounts.problem };
			this.options.statusBar.show(this.display);
			return;
		}

		const result = await runner.runJson(
			['status', '--json'],
			value => unwrap(decodeWorkspaceStatus(value)),
			{ cwd: this.workspaceRoot() },
		);

		if (!result.ok) {
			this.display = { kind: 'error', detail: await this.explain(result.reason, result.detail) };
			this.options.statusBar.show(this.display);
			return;
		}

		this.lastStatus = result.value;
		this.lastSettings = readEntireSettings(this.workspaceRoot());

		this.render();
		this.beginSession();
		void this.refreshReachability();
	}

	/**
	 * Renders the state the controller last read.
	 *
	 * Rendering is separate from reading, because the reachability check
	 * finishes after the status does and changes what is shown.
	 */
	private render(): void {
		const status = this.lastStatus;
		if (!status) {
			return;
		}

		const destination = this.destination();

		this.display = toDisplay(
			status,
			this.effectiveSettings(),
			// An unknown destination has no destination to name, so the line
			// is left out rather than filled in with a phrase that says
			// nothing.
			destination && destination.kind !== 'unknown'
				? describeDestination(destination)
				: undefined,
			this.checkpointProblem(destination),
			this.actingContext(),
		);
		this.options.statusBar.show(this.display);
	}

	/**
	 * The login the extension is acting as, as the status bar needs it.
	 *
	 * A workspace the login cannot see is only said so once the CLI has
	 * been asked, so the answer is whatever the last check found.
	 */
	private actingContext(): ActingContext | undefined {
		const acting = this.options.accounts.current.acting;
		if (!acting) {
			return undefined;
		}

		const destination = this.destination();
		const invisible = this.checkpointReport?.visible === false;

		return {
			handle: acting.handle,
			name: acting.name,
			invisible,
			detail:
				invisible && destination && destination.kind !== 'unknown'
					? describeDestination(destination)
					: undefined,
		};
	}

	/**
	 * Says why a command failed.
	 *
	 * A payload the extension cannot read is worth naming the CLI's
	 * version for, because the first question about such a payload is
	 * which build produced it.
	 */
	private async explain(reason: string, detail: string): Promise<string> {
		if (reason !== 'invalid-output') {
			return detail;
		}

		const discovery = await this.options.runner.discover();
		const version = discovery.state === 'available' ? discovery.version : undefined;

		return `${describeUnexpectedPayload(version)} ${detail}`;
	}

	/**
	 * Where the checkpoints of this workspace are going.
	 *
	 * This is what the CLI said the last time it reported the workspace's
	 * status, so it costs nothing to show. Whether Entire can reach them
	 * is a different question, and one that takes another command to
	 * answer, so it is asked separately.
	 */
	private destination(): CheckpointDestination | undefined {
		const status = this.lastStatus;
		if (!status) {
			return undefined;
		}

		return resolveCheckpointDestination(status, this.lastSettings);
	}

	/**
	 * What is wrong with where the checkpoints are going.
	 *
	 * The destination may be the problem on its own: checkpoints that stay
	 * on this machine are known, and still never reach Entire. A
	 * checkpoint repository the App cannot read is a problem too, and
	 * that one is only known once the CLI has been asked.
	 */
	private checkpointProblem(destination: CheckpointDestination | undefined): string | undefined {
		if (!destination) {
			return undefined;
		}

		if (this.checkpointReport?.checkpointRepoVisible === false) {
			return this.checkpointReport.problem;
		}

		return describeCheckpointProblem(destination);
	}

	/**
	 * Asks where the checkpoints are going and whether the acting login
	 * can see them.
	 *
	 * Only a destination that puts the checkpoints on a server can be
	 * unreachable in a way worth reporting, and the answer costs a command
	 * that reaches the network, so it is asked once for each destination
	 * rather than on every refresh. The status bar is updated when the
	 * answer arrives.
	 */
	private async refreshReachability(): Promise<void> {
		const status = this.lastStatus;
		const destination = this.destination();

		if (
			!status ||
			!destination ||
			(destination.kind !== 'dedicated' && destination.kind !== 'same-repo')
		) {
			return;
		}

		const key = `${this.options.accounts.current.acting?.name ?? ''}|${describeDestination(destination)}`;
		if (this.checkpointReportKey === key) {
			return;
		}

		this.checkpointReportKey = key;

		try {
			this.checkpointReport = await inspectCheckpointDestination(
				this.options.runner,
				this.workspaceRoot(),
				status,
				this.lastSettings,
			);
		} catch {
			// The runner reports failures as values, so this is only here
			// for the case where something throws. A check that failed
			// says nothing, and saying nothing is honest.
			this.checkpointReport = undefined;
		}

		this.render();
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

		// A session is reported for a workspace Entire is tracking and one
		// that is not already running. The state on show is not asked
		// about, because a workspace the acting login cannot see is still
		// tracked.
		const status = this.lastStatus;
		if (!status || status.kind !== 'tracked' || status.activeSessions.length > 0) {
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

			case 'explain-invisible-to-context': {
				const context = display?.kind === 'invisible-to-context' ? display.context : 'unknown';
				await vscode.window.showInformationMessage(
					`Entire is tracking this workspace, but the login it is acting as ("${context}") cannot see it. Set \`entirely.cliContext\` to the login that tracks it.`,
				);
				return;
			}

			case 'explain-context-error': {
				const detail = display?.kind === 'context-error' ? display.detail : 'unknown error';
				await vscode.window.showErrorMessage(
					`Entirely is set to use a login the Entire CLI does not have. ${detail}`,
				);
				return;
			}

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
		const setUp = await enableEntire(this.options.runner, this.workspaceRoot());

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
		return summariseSettings(this.lastSettings);
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

		const seconds = readExtensionSettings().refreshInterval;
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
