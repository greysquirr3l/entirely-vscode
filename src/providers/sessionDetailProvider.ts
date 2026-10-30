import * as vscode from 'vscode';

import { buildSessionDetail, pluralise, type DetailRow, type Selection, type Session, type ViewerState } from '../lib/entire';

/** One field of the selected session. */
export interface DetailFieldNode {
	readonly kind: 'field';
	readonly label: string;
	readonly value: string;
	readonly tooltip?: string;
	/** Run when the row is clicked. */
	readonly command?: { readonly command: string; readonly arguments: readonly unknown[] };
}

/** A block of text, such as the last prompt. */
export interface DetailTextNode {
	readonly kind: 'text';
	readonly label: string;
	readonly lines: readonly string[];
	/** Shown beside the label in place of the line count. */
	readonly summary?: string;
	readonly children: readonly DetailLineNode[];
}

/** One line of a block of text. */
export interface DetailLineNode {
	readonly kind: 'line';
	readonly text: string;
}

/** A node in the session detail tree. */
export type DetailNode = DetailFieldNode | DetailTextNode | DetailLineNode;

function rowNode(row: DetailRow): DetailNode {
	if (row.lines) {
		return {
			kind: 'text',
			label: row.label,
			lines: row.lines,
			summary: row.value.length > 0 ? row.value : undefined,
			children: row.lines.map(text => ({ kind: 'line', text })),
		};
	}
	// Only an https address is followed, whatever the CLI printed.
	const command =
		row.link && /^https:\/\//i.test(row.link)
			? { command: 'vscode.open', arguments: [vscode.Uri.parse(row.link)] }
			: row.command;
	return { kind: 'field', label: row.label, value: row.value, tooltip: row.tooltip, command };
}

/**
 * The rows of the session the user has selected.
 *
 * This is the Session view: it shows a session and nothing else. What it
 * shows comes from the selection service, so the session is read once for
 * this view and the detail panel together. Selecting a trail change or an
 * Activity entry leaves it as it was; those open in the detail panel.
 */
export class SessionDetailProvider implements vscode.TreeDataProvider<DetailNode> {
	private readonly changed = new vscode.EventEmitter<DetailNode | undefined>();
	private session: Session | undefined;
	private roots: DetailNode[] = [];
	private readonly parents = new Map<DetailLineNode, DetailTextNode>();

	readonly onDidChangeTreeData: vscode.Event<DetailNode | undefined> = this.changed.event;

	/** Shows what the selection service published, when it is a session. */
	render(state: ViewerState): void {
		if (state.kind === 'empty') {
			this.set(undefined, []);
			return;
		}
		if (state.kind === 'notice' || state.model.kind !== 'session') {
			return;
		}

		const rows = state.model.rows.map(rowNode);
		if (state.kind === 'failed' || state.kind === 'gone') {
			rows.push({ kind: 'field', label: 'Detail', value: 'Not available', tooltip: state.reason });
		}
		this.set(state.model.session?.session ?? (state.selection.kind === 'session' ? state.selection.session : undefined), rows);
	}

	/** Shows a session as listed, with nothing read yet. */
	show(session: Session | undefined): void {
		if (!session) {
			this.render({ kind: 'empty' });
			return;
		}
		const selection: Selection = { kind: 'session', session };
		this.render({ kind: 'ready', selection, model: buildSessionDetail(selection) });
	}

	private set(session: Session | undefined, nodes: DetailNode[]): void {
		this.session = session;
		this.roots = nodes;
		this.parents.clear();
		for (const node of nodes) {
			if (node.kind === 'text') {
				for (const line of node.children) {
					this.parents.set(line, node);
				}
			}
		}
		this.changed.fire(undefined);
	}

	/** The session currently on show. */
	get current(): Session | undefined {
		return this.session;
	}

	getTreeItem(element: DetailNode): vscode.TreeItem {
		if (element.kind === 'field') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
			item.description = element.value;
			if (element.tooltip) {
				item.tooltip = element.tooltip;
			}
			item.contextValue = 'entirely.detailField';
			if (element.command) {
				item.command = {
					command: element.command.command,
					title: element.label,
					arguments: [...element.command.arguments],
				};
			}
			return item;
		}

		if (element.kind === 'text') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = element.summary ?? pluralise(element.lines.length, 'line');
			item.contextValue = 'entirely.detailText';
			return item;
		}

		const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
		item.contextValue = 'entirely.detailLine';
		return item;
	}

	getChildren(element?: DetailNode): DetailNode[] {
		if (!element) {
			return [...this.roots];
		}
		return element.kind === 'text' ? [...element.children] : [];
	}

	getParent(element: DetailNode): DetailNode | undefined {
		return element.kind === 'line' ? this.parents.get(element) : undefined;
	}

	dispose(): void {
		this.changed.dispose();
	}
}
