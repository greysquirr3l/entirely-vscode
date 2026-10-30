import * as vscode from 'vscode';

/**
 * The states the status bar renders.
 *
 * Each one is a distinct treatment, because the user has to tell them
 * apart at a glance without hovering.
 */
export type StatusDisplay =
	/** The workspace is tracked and an agent session is live. */
	| {
			readonly kind: 'active-session';
			readonly agent?: string;
			readonly settings?: readonly string[];
			readonly checkpointDestination?: string;
			/** What is wrong with where the checkpoints are going. */
			readonly checkpointProblem?: string;
			/** The handle of the login the extension is acting as. */
			readonly context?: string;
	  }
	/** The workspace is tracked and no agent session is running. */
	| {
			readonly kind: 'tracked';
			readonly settings?: readonly string[];
			readonly checkpointDestination?: string;
			/** What is wrong with where the checkpoints are going. */
			readonly checkpointProblem?: string;
			/** The handle of the login the extension is acting as. */
			readonly context?: string;
	  }
	/** The workspace is a git repository Entire has not been set up for. */
	| { readonly kind: 'not-set-up'; readonly settings?: readonly string[] }
	/** The workspace is not a git repository, so it cannot be tracked. */
	| { readonly kind: 'not-a-repository' }
	/**
	 * The workspace is tracked, but the login being used cannot see it.
	 *
	 * This is not the same as a workspace that is not tracked: the
	 * workspace is set up, under a login the user is not currently
	 * acting as.
	 */
	| {
			readonly kind: 'invisible-to-context';
			/** The handle of the login the extension is acting as. */
			readonly context: string;
			/** The name that login is saved under. */
			readonly contextName?: string;
			/** What the CLI said about it. */
			readonly detail?: string;
	  }
	/**
	 * The login the user asked for is not one the CLI has.
	 *
	 * This is a mistake in the settings rather than a command that
	 * failed, and it is shown as one.
	 */
	| { readonly kind: 'context-error'; readonly detail: string }
	/** The CLI could not be read. */
	| { readonly kind: 'error'; readonly detail: string };

/** The text and tooltip for one state. */
interface Rendering {
	readonly text: string;
	readonly tooltip: string;
}

/**
 * The settings that are in effect, as a line for the tooltip.
 *
 * A setting nobody has set is not shown, so the line says what is
 * actually decided rather than what could be.
 */
function settingsLine(settings: readonly string[] | undefined): string {
	if (!settings || settings.length === 0) {
		return '';
	}

	return `\n\nEntire's settings here: ${settings.join(' · ')}`;
}

/**
 * Where the checkpoints are going, as a line for the tooltip.
 *
 * A checkpoint that stays on the machine is worth saying out loud: it is
 * the reason a dashboard can be empty while the extension says everything
 * is fine.
 */
function destinationLine(destination: string | undefined): string {
	if (!destination) {
		return '';
	}

	return `\n\nCheckpoints go to ${destination}.`;
}

/**
 * What is wrong with where the checkpoints are going, as a line for the
 * tooltip.
 *
 * The line comes first, because it is the thing the user has to act on.
 */
function problemLine(problem: string | undefined): string {
	if (!problem) {
		return '';
	}

	return `\n\n${problem}`;
}

/**
 * The login the extension is acting as, as a line for the tooltip.
 *
 * The handle is used rather than the name the login is saved under,
 * because the handle is how the account is known to the person who owns
 * it.
 */
function contextLine(context: string | undefined): string {
	if (!context) {
		return '';
	}

	return `\n\nActing as ${context}.`;
}

/**
 * The priority the item is shown at.
 *
 * The source control widget sits on the left of the status bar. Matching
 * its priority puts Entirely next to it rather than at the far right of the
 * window, where nobody looks.
 */
const PRIORITY = 100;

/**
 * Entire's logo, from the product icon font. It is Entire's official
 * symbol, shown unmodified; every state is a codicon beside it.
 */
const LOGO = '$(entire-logo)';

/** The command the item runs when it is clicked. */
const CLICK_COMMAND = 'entirely.statusBar';

/** The text and tooltip for a state. */
function render(display: StatusDisplay): Rendering {
	switch (display.kind) {
		case 'active-session':
			return {
				// The logo is never altered: the state is a codicon beside it.
				// A checkpoint problem adds a warning after the pulse, so a
				// workspace with a problem can be told apart from one
				// without by looking at the bar.
				text: `${LOGO} Entire $(pulse)${display.checkpointProblem ? ' $(warning)' : ''}`,
				tooltip:
					(display.agent
						? `Entire is tracking this workspace. ${display.agent} is running.`
						: 'Entire is tracking this workspace. An agent session is running.') +
					problemLine(display.checkpointProblem) +
					destinationLine(display.checkpointDestination) +
					contextLine(display.context) +
					settingsLine(display.settings),
			};
		case 'tracked':
			return {
				text: `${LOGO} Entire${display.checkpointProblem ? ' $(warning)' : ''}`,
				tooltip:
					'Entire is tracking this workspace. No agent session is running.' +
					problemLine(display.checkpointProblem) +
					destinationLine(display.checkpointDestination) +
					contextLine(display.context) +
					settingsLine(display.settings),
			};
		case 'not-set-up':
			return {
				text: `${LOGO} Entire $(circle-slash)`,
				tooltip:
					'Entire is not set up for this workspace. Click to set it up.' +
					settingsLine(display.settings),
			};
		case 'not-a-repository':
			return {
				text: `${LOGO} Entire $(circle-outline)`,
				tooltip: 'This workspace is not a git repository, so Entire cannot track it.',
			};
		case 'invisible-to-context':
			return {
				text: `${LOGO} Entire $(eye-closed)`,
				tooltip:
					`Entire is tracking this workspace, but the login it is acting as ("${display.context}") cannot see ${
						display.detail ?? 'where its checkpoints are'
					}.` +
					(display.contextName
						? ` Set \`entirely.cliContext\` to the login that tracks it.`
						: ''),
			};
		case 'context-error':
			return {
				text: `${LOGO} Entire $(error)`,
				tooltip: `Entirely is set to use a login the Entire CLI does not have. ${display.detail}`,
			};
		case 'error':
			return {
				text: `${LOGO} Entire $(warning)`,
				tooltip: `Entirely could not read the Entire CLI: ${display.detail}`,
			};
	}
}

/**
 * The Entirely status bar item.
 *
 * The item is a thin view: it renders a state and nothing else. Deciding
 * which state applies, and what clicking should do, belongs to the
 * controller that owns the CLI.
 */
export class StatusBar {
	private readonly item: vscode.StatusBarItem;
	private display: StatusDisplay | undefined;
	private isVisible = false;

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, PRIORITY);
		this.item.command = CLICK_COMMAND;
		this.item.hide();
	}

	/** The state currently on show, if the item is visible. */
	get current(): StatusDisplay | undefined {
		return this.display;
	}

	/** The text shown on the item. */
	get text(): string {
		return this.item.text;
	}

	/** The tooltip shown on the item. */
	get tooltip(): string {
		return typeof this.item.tooltip === 'string' ? this.item.tooltip : '';
	}

	/** Whether the item is on show. */
	get visible(): boolean {
		return this.isVisible;
	}

	/** The command the item runs when it is clicked. */
	get command(): string | undefined {
		return typeof this.item.command === 'string' ? this.item.command : undefined;
	}

	/** Shows a state. */
	show(display: StatusDisplay): void {
		this.display = display;
		const rendering = render(display);
		this.item.text = rendering.text;
		this.item.tooltip = rendering.tooltip;
		this.item.show();
		this.isVisible = true;
	}

	/**
	 * Hides the item.
	 *
	 * The extension stays out of the way in a workspace that does not use
	 * Entire, so an absent CLI means no item at all rather than a permanent
	 * error.
	 */
	hide(): void {
		this.display = undefined;
		this.item.hide();
		this.isVisible = false;
	}

	dispose(): void {
		this.item.dispose();
	}
}
