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
	  }
	/** The workspace is tracked and no agent session is running. */
	| {
			readonly kind: 'tracked';
			readonly settings?: readonly string[];
			readonly checkpointDestination?: string;
			/** What is wrong with where the checkpoints are going. */
			readonly checkpointProblem?: string;
	  }
	/** The workspace is a git repository Entire has not been set up for. */
	| { readonly kind: 'not-set-up'; readonly settings?: readonly string[] }
	/** The workspace is not a git repository, so it cannot be tracked. */
	| { readonly kind: 'not-a-repository' }
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
 * The warning mark, when there is something to warn about.
 *
 * The mark goes after the state rather than in front of it, so that the
 * state can still be read without hovering.
 */
function warningMark(problem: string | undefined): string {
	return problem ? ' $(warning)' : '';
}

/**
 * The priority the item is shown at.
 *
 * The source control widget sits on the left of the status bar. Matching
 * its priority puts Entirely next to it rather than at the far right of the
 * window, where nobody looks.
 */
const PRIORITY = 100;

/** The command the item runs when it is clicked. */
const CLICK_COMMAND = 'entirely.statusBar';

/** The text and tooltip for a state. */
function render(display: StatusDisplay): Rendering {
	switch (display.kind) {
		case 'active-session':
			return {
				// The warning is added to the state rather than replacing
				// it, so that a workspace with a problem can still be told
				// apart from one without by looking at the bar.
				text: `$(pulse) Entire${warningMark(display.checkpointProblem)}`,
				tooltip:
					(display.agent
						? `Entire is tracking this workspace. ${display.agent} is running.`
						: 'Entire is tracking this workspace. An agent session is running.') +
					problemLine(display.checkpointProblem) +
					destinationLine(display.checkpointDestination) +
					settingsLine(display.settings),
			};
		case 'tracked':
			return {
				text: `$(circle-filled) Entire${warningMark(display.checkpointProblem)}`,
				tooltip:
					'Entire is tracking this workspace. No agent session is running.' +
					problemLine(display.checkpointProblem) +
					destinationLine(display.checkpointDestination) +
					settingsLine(display.settings),
			};
		case 'not-set-up':
			return {
				text: '$(circle-slash) Entire',
				tooltip:
					'Entire is not set up for this workspace. Click to set it up.' +
					settingsLine(display.settings),
			};
		case 'not-a-repository':
			return {
				text: '$(circle-outline) Entire',
				tooltip: 'This workspace is not a git repository, so Entire cannot track it.',
			};
		case 'error':
			return {
				text: '$(warning) Entire',
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
