import * as vscode from 'vscode';

/**
 * The Sessions tree view.
 *
 * The provider owns the view's shape, not its data: the sessions themselves
 * come from the CLI runner, which is not wired up yet. Until it is, the view
 * renders empty and the `viewsWelcome` contribution explains why.
 */
export class SessionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();

	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this.changed.event;

	/** Asks the view to re-read its children. */
	refresh(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(_element?: vscode.TreeItem): vscode.TreeItem[] {
		return [];
	}

	dispose(): void {
		this.changed.dispose();
	}
}
