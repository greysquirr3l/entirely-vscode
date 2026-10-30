import * as vscode from 'vscode';

import { DETAIL_COMMANDS, describeViewerTitle, renderDetailHtml, type ViewerState } from '../lib/entire';

/** The view type of the panel, which is also what the editor calls it in `activeWebviewPanelId`. */
export const DETAIL_VIEW_TYPE = 'entirely.detail';

/** The part of a webview panel this class uses. */
export interface DetailPanelSurface {
	title: string;
	iconPath?: vscode.WebviewPanel['iconPath'];
	readonly webview: { html: string };
	readonly viewColumn: vscode.ViewColumn | undefined;
	readonly visible: boolean;
	readonly onDidDispose: vscode.Event<void>;
	reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
	dispose(): void;
}

/** Makes the panel. Defaults to the editor's `createWebviewPanel`. */
export type CreateDetailPanel = (
	viewType: string,
	title: string,
	showOptions: { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus: boolean },
	options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
) => DetailPanelSurface;

export interface DetailPanelOptions {
	/** The icon on the panel's tab. */
	readonly iconPath?: vscode.Uri;
	readonly create?: CreateDetailPanel;
}

/**
 * The one editor panel that shows what was last selected in Sessions,
 * Trails or Activity.
 *
 * It is made the first time something is selected, beside the code and
 * without taking focus. After that the same panel is updated for every
 * selection, so choosing rows never piles up tabs. Closing it disposes it,
 * and the next selection makes a new one. It has no script: it shows
 * escaped text and links that run a fixed list of commands.
 */
export class DetailPanel implements vscode.Disposable {
	private panel: DetailPanelSurface | undefined;
	private shown: string | undefined;
	private html: string | undefined;
	private readonly opened = new vscode.EventEmitter<boolean>();

	/** Fires `true` when the panel is made and `false` when it is closed, by the user or by this class. */
	readonly onDidChangeOpen: vscode.Event<boolean> = this.opened.event;

	constructor(private readonly options: DetailPanelOptions = {}) {}

	/** Whether the panel exists. */
	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	/** Shows what the selection service published. */
	apply(state: ViewerState): void {
		if (state.kind === 'empty') {
			// The row the panel showed has gone from its view, so there is
			// nothing left that the panel could be about.
			this.panel?.dispose();
			return;
		}

		const key = state.kind === 'notice' ? `notice:${state.message}` : state.model.key;
		const html = renderDetailHtml(state);
		const title = describeViewerTitle(state);

		const existing = this.panel;
		if (!existing) {
			this.open(title, html, key);
			return;
		}

		if (existing.title !== title) {
			existing.title = title;
		}
		if (html !== this.html) {
			// Not set when it is the same page: a new document puts the scroll back at the top.
			existing.webview.html = html;
			this.html = html;
		}
		if (key !== this.shown) {
			this.shown = key;
			// Revealing keeps the panel in the column it is in and never takes focus.
			if (!existing.visible && existing.viewColumn !== undefined) {
				existing.reveal(existing.viewColumn, true);
			}
		}
	}

	private open(title: string, html: string, key: string): void {
		const create: CreateDetailPanel =
			this.options.create ??
			((viewType, name, showOptions, panelOptions) =>
				vscode.window.createWebviewPanel(viewType, name, showOptions, panelOptions));

		const panel = create(
			DETAIL_VIEW_TYPE,
			title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: false,
				enableCommandUris: [...DETAIL_COMMANDS],
				localResourceRoots: [],
				retainContextWhenHidden: false,
			},
		);
		if (this.options.iconPath) {
			panel.iconPath = this.options.iconPath;
		}
		panel.webview.html = html;
		this.panel = panel;
		this.shown = key;
		this.html = html;
		panel.onDidDispose(() => {
			// A panel made after this one was closed is not touched.
			if (this.panel === panel) {
				this.panel = undefined;
				this.shown = undefined;
				this.html = undefined;
				this.opened.fire(false);
			}
		});
		this.opened.fire(true);
	}

	/** Closes the panel, if it is open. */
	close(): void {
		this.panel?.dispose();
	}

	dispose(): void {
		this.panel?.dispose();
		this.opened.dispose();
	}
}
