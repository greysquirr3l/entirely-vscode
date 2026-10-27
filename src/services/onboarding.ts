import * as vscode from 'vscode';

import type { WorkspaceStatus } from '../lib/entire';
import type { CliDiscovery } from './cli/types';

/**
 * What is wrong with a workspace, if anything is.
 *
 * The extension has exactly three things it can ask for: the CLI, a
 * repository that is set up for it, and a terminal that can see the CLI.
 * Each of those has one fix, and the fix is the only thing offered.
 */
export type WorkspaceFault =
	/** The CLI is not installed. */
	| { readonly kind: 'cli-absent' }
	/** The CLI is installed but this repository is not set up for it. */
	| { readonly kind: 'not-set-up' }
	/** The CLI is installed but the terminal cannot see it. */
	| { readonly kind: 'off-path'; readonly directory: string }
	/** Nothing needs fixing. */
	| { readonly kind: 'ok' };

/**
 * The one action that fixes a fault.
 *
 * There is deliberately no action to disable or uninstall the extension:
 * without the CLI it has nothing to preserve, so the useful thing to offer
 * is the fix.
 */
export type OnboardingAction =
	/** Show how to install the CLI. */
	| { readonly kind: 'install' }
	/** Set Entire up for this repository. */
	| { readonly kind: 'enable' }
	/** Put the CLI's directory on the terminal's PATH. */
	| { readonly kind: 'repair-path'; readonly directory: string };

/** What the extension needs in order to work out what is wrong. */
export interface FaultContext {
	/** Where the CLI was found, if it was found at all. */
	readonly cli: CliDiscovery;
	/** The workspace's tracking state, when the CLI could be asked for it. */
	readonly status?: WorkspaceStatus;
	/** Whether the folder is a git repository. */
	readonly isRepository: boolean;
	/**
	 * Whether the editor's terminal can see the CLI's directory.
	 *
	 * This is the terminal's PATH rather than the extension's own, because
	 * it is the terminal that has to run the CLI. A CLI the extension can
	 * reach but the terminal cannot is still a fault worth fixing.
	 */
	readonly onTerminalPath: boolean;
}

/**
 * Works out what is wrong with a workspace.
 *
 * The order matters. A missing CLI comes first because nothing else can be
 * checked without it. A repository that is not set up comes next, because
 * that is the fault the user has to clear before anything else will work.
 * Only then does the terminal's PATH matter.
 */
export function detectFault(context: FaultContext): WorkspaceFault {
	if (context.cli.state === 'absent') {
		return { kind: 'cli-absent' };
	}

	// A CLI that was found but cannot be run is a different problem, and the
	// status bar already reports it. Prompting about it would be noise.
	if (context.cli.state === 'broken') {
		return { kind: 'ok' };
	}

	// Enabling Entire outside a repository would create one, and create an
	// initial commit in it. That is not something to do behind the user's
	// back, so there is nothing to offer.
	if (!context.isRepository) {
		return { kind: 'ok' };
	}

	if (context.status?.kind === 'not-set-up') {
		return { kind: 'not-set-up' };
	}

	// A CLI the terminal cannot see is off the PATH the terminal inherits,
	// which is the common case: the CLI installs to `~/.local/bin`. The
	// extension can still run it, by absolute path, so this is the
	// terminal's problem rather than the extension's.
	if (!context.onTerminalPath) {
		return { kind: 'off-path', directory: context.cli.directory };
	}

	return { kind: 'ok' };
}

/** The action that fixes a fault, when there is one. */
export function actionFor(fault: WorkspaceFault): OnboardingAction | undefined {
	switch (fault.kind) {
		case 'cli-absent':
			return { kind: 'install' };
		case 'not-set-up':
			return { kind: 'enable' };
		case 'off-path':
			return { kind: 'repair-path', directory: fault.directory };
		case 'ok':
			return undefined;
	}
}

/** The message that explains the fault. */
export function messageFor(fault: WorkspaceFault): string {
	switch (fault.kind) {
		case 'cli-absent':
			return 'Entirely needs the Entire CLI, which is not installed.';
		case 'not-set-up':
			return 'Entire is not set up for this repository.';
		case 'off-path':
			return (
				`Entire is installed in ${fault.directory}, which the integrated terminal cannot see. ` +
				'Entirely itself can still use it, and the repair only changes the terminal.'
			);
		case 'ok':
			return '';
	}
}

/** The label of the one action button. */
export function labelFor(action: OnboardingAction): string {
	switch (action.kind) {
		case 'install':
			return 'Show Install Instructions';
		case 'enable':
			return 'Enable Entire';
		case 'repair-path':
			return 'Fix the Terminal PATH';
	}
}

/** The documented way to install the CLI. */
export const INSTALL_COMMAND = 'curl -fsSL https://entire.com/install.sh | bash';

/** Where the install instructions live. */
export const INSTALL_DOCS = 'https://docs.entire.com/installation';

/** The key the dismissed folders are recorded under. */
const DISMISSED_KEY = 'entirely.onboarding.dismissed';

/**
 * Shows a message with some actions, and reports which was chosen.
 *
 * The same shape as `vscode.window.showInformationMessage`, kept as a type
 * of its own so the prompt can be exercised without putting notifications
 * in front of whoever is running the tests.
 */
export type Notifier = (
	message: string,
	...actions: string[]
) => Promise<string | undefined>;

/** What the onboarding prompt needs to do its job. */
export interface OnboardingOptions {
	/** Where the dismissed folders are remembered. */
	readonly state: vscode.Memento;
	/** Works out what is wrong with the workspace. */
	readonly detect: (folder: string) => Promise<WorkspaceFault>;
	/** The folders the prompt is about. */
	readonly folders: () => readonly string[];
	/** Runs the action the user chose. */
	readonly run: (action: OnboardingAction, folder: string) => Promise<void>;
	/** Shows the prompt. */
	readonly notify?: Notifier;
}

/**
 * Offers a workspace the one thing it needs, once.
 *
 * The prompt is a notification, not a dialog: a workspace the user may not
 * even use Entire in should not have a modal dialog in its face. Each
 * folder is asked once and never again, and the answer is remembered
 * across restarts.
 */
export class OnboardingPrompt {
	constructor(private readonly options: OnboardingOptions) {}

	/**
	 * Offers the prompt for every folder that needs it.
	 *
	 * Returns true when a prompt was shown.
	 */
	async offer(): Promise<boolean> {
		let shown = false;

		for (const folder of this.options.folders()) {
			if (await this.offerFor(folder)) {
				shown = true;
			}
		}

		return shown;
	}

	/**
	 * Offers the prompt for one folder, if it needs it and has not been
	 * asked before.
	 */
	async offerFor(folder: string): Promise<boolean> {
		if (this.isDismissed(folder)) {
			return false;
		}

		const fault = await this.options.detect(folder);
		const action = actionFor(fault);
		if (!action) {
			return false;
		}

		// The folder is marked before the notification is shown, so a
		// notification the user ignores is still asked only once.
		await this.dismiss(folder);

		const message = messageFor(fault);
		const label = labelFor(action);
		const notify = this.options.notify ?? vscode.window.showInformationMessage;
		const choice = await notify(message, label);

		if (choice === label) {
			await this.options.run(action, folder);
		}

		return true;
	}

	/** Whether a folder has already been asked. */
	isDismissed(folder: string): boolean {
		const dismissed = this.options.state.get<readonly string[]>(DISMISSED_KEY, []);
		return dismissed.includes(folder);
	}

	/** Records that a folder has been asked. */
	async dismiss(folder: string): Promise<void> {
		const dismissed = this.options.state.get<readonly string[]>(DISMISSED_KEY, []);
		if (dismissed.includes(folder)) {
			return;
		}
		await this.options.state.update(DISMISSED_KEY, [...dismissed, folder]);
	}
}
