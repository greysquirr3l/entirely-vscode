import * as vscode from 'vscode';

import type { CreateDetailPanel, DetailPanelSurface } from '../../providers/detailPanel';

/** A stand-in for the editor's webview panel that records what was done to it. */
export class FakeWebviewPanel implements DetailPanelSurface {
	title: string;
	iconPath: DetailPanelSurface['iconPath'];
	readonly webview = { html: '' };
	viewColumn: vscode.ViewColumn | undefined = vscode.ViewColumn.Two;
	visible = true;
	disposed = false;
	readonly reveals: { viewColumn: vscode.ViewColumn | undefined; preserveFocus: boolean | undefined }[] = [];
	private readonly closed = new vscode.EventEmitter<void>();
	readonly onDidDispose = this.closed.event;

	constructor(
		readonly viewType: string,
		title: string,
		readonly showOptions: { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus: boolean },
		readonly options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
	) {
		this.title = title;
	}

	reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
		this.reveals.push({ viewColumn, preserveFocus });
		this.visible = true;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.closed.fire();
		this.closed.dispose();
	}
}

/** Makes fake panels and keeps them, so a test can look at every one that was made. */
export function fakePanels(): { readonly create: CreateDetailPanel; readonly made: FakeWebviewPanel[] } {
	const made: FakeWebviewPanel[] = [];
	return {
		made,
		create: (viewType, title, showOptions, options) => {
			const panel = new FakeWebviewPanel(viewType, title, showOptions, options);
			made.push(panel);
			return panel;
		},
	};
}
