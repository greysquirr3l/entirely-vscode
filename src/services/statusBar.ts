import * as vscode from 'vscode';

/**
 * The Entirely status bar item.
 *
 * The item is always present so the user can tell whether Entire is
 * tracking the workspace at a glance. The content is deliberately kept to a
 * plain string pair: the tracked, untracked and error treatments are the
 * status controller's job, and it decides what to put here.
 */
export class StatusBar {
	private readonly item: vscode.StatusBarItem;
	private text: string;
	private tooltip: string;

	constructor() {
		this.text = '$(circle-outline) Entirely';
		this.tooltip = 'Entirely: the workspace state is not known yet';

		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.item.text = this.text;
		this.item.tooltip = this.tooltip;
		this.item.command = 'entirely.showSessions';
		this.item.show();
	}

	/** Replaces the visible state. */
	set(text: string, tooltip: string): void {
		this.text = text;
		this.tooltip = tooltip;
		this.item.text = text;
		this.item.tooltip = tooltip;
	}

	/** Re-applies the current state, e.g. after a configuration change. */
	refresh(): void {
		this.item.text = this.text;
		this.item.tooltip = this.tooltip;
	}

	dispose(): void {
		this.item.dispose();
	}
}
