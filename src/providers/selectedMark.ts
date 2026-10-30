import * as vscode from 'vscode';

/** The colour that marks the row the detail panel is about. */
export const SELECTED_COLOUR = 'charts.blue';

/** The address scheme a row's decoration is looked up under. */
export const SELECTED_SCHEME = 'entirely-selected';

/** The address a selectable row carries, so its mark can change without the row being redrawn. */
export function rowUri(key: string): vscode.Uri {
	return vscode.Uri.from({ scheme: SELECTED_SCHEME, path: `/${key}` });
}

/**
 * Marks the one row the detail panel is about, across Sessions, Trails and
 * Activity.
 *
 * The editor keeps its own highlight on the row last chosen in each tree
 * and an extension cannot clear it, so this mark is the one thing that says
 * which row the viewer shows. It is a decoration rather than a redrawn row
 * on purpose: redrawing a row discards the command the editor is about to
 * run for the click that selected it, and the click then fails with "Actual
 * command not found". A decoration changes the colour and a badge in place.
 * One key is marked at a time, so selecting in one view clears the mark in
 * the others.
 */
export class SelectedRows implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	private marked: string | undefined;

	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this.changed.event;

	/** The key of the marked row, if any. */
	get key(): string | undefined {
		return this.marked;
	}

	/** Marks a row, or marks none. */
	mark(key: string | undefined): void {
		if (key === this.marked) {
			return;
		}
		const touched = [this.marked, key].filter((value): value is string => value !== undefined).map(rowUri);
		this.marked = key;
		if (touched.length > 0) {
			this.changed.fire(touched);
		}
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== SELECTED_SCHEME || this.marked === undefined || uri.toString() !== rowUri(this.marked).toString()) {
			return undefined;
		}
		const decoration = new vscode.FileDecoration('●', 'Shown in the detail panel', new vscode.ThemeColor(SELECTED_COLOUR));
		decoration.propagate = false;
		return decoration;
	}

	dispose(): void {
		this.changed.dispose();
	}
}
