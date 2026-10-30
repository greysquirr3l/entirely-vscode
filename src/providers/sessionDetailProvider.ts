import * as vscode from 'vscode';

import {
	buildSessionDetail,
	describeViewerNote,
	pluralise,
	type DetailModel,
	type DetailRow,
	type Selection,
	type Session,
	type TrailPick,
	type ViewerState,
} from '../lib/entire';

/** One field of the selected item. */
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

/** The row that names the selected item. Review actions on a trail change attach here. */
export interface DetailHeaderNode {
	readonly kind: 'header';
	readonly label: string;
	readonly description: string;
	readonly icon: string;
	readonly pick?: TrailPick;
}

/** Says what is happening to the item: loading, failed, gone, or not refreshed. */
export interface DetailStatusNode {
	readonly kind: 'status';
	readonly label: string;
	readonly icon: string;
	readonly role: 'loading' | 'failed' | 'gone' | 'refresh-failed' | 'notice';
}

/** A node in the Details tree. */
export type DetailNode =
	| DetailFieldNode
	| DetailTextNode
	| DetailLineNode
	| DetailHeaderNode
	| DetailStatusNode;

const KIND_WORDS: Record<DetailModel['kind'], { readonly word: string; readonly icon: string }> = {
	session: { word: 'Session', icon: 'pulse' },
	trail: { word: 'Trail', icon: 'git-pull-request' },
	change: { word: 'Change', icon: 'git-pull-request-draft' },
	commit: { word: 'Commit', icon: 'git-commit' },
	'activity-session': { word: 'Session line', icon: 'comment-discussion' },
	repository: { word: 'Repository', icon: 'repo' },
};

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

function statusNodes(state: ViewerState): DetailStatusNode[] {
	const note = describeViewerNote(state);
	switch (state.kind) {
		case 'loading':
			return [{ kind: 'status', label: note ?? '', icon: 'loading~spin', role: 'loading' }];
		case 'failed':
			return [{ kind: 'status', label: note ?? '', icon: 'error', role: 'failed' }];
		case 'gone':
			return [{ kind: 'status', label: note ?? '', icon: 'info', role: 'gone' }];
		case 'ready':
			return state.refreshFailure
				? [{ kind: 'status', label: note ?? '', icon: 'warning', role: 'refresh-failed' }]
				: [];
		case 'empty':
		case 'notice':
			return [];
	}
}

/** The nodes that show a state. A session's rows are the rows it always had. */
export function buildDetailNodes(state: ViewerState): DetailNode[] {
	if (state.kind === 'empty') {
		return [];
	}
	if (state.kind === 'notice') {
		return [{ kind: 'status', label: state.message, icon: 'info', role: 'notice' }];
	}
	const nodes: DetailNode[] = [];
	const { model } = state;
	if (model.heading) {
		const kind = KIND_WORDS[model.kind];
		nodes.push({
			kind: 'header',
			label: model.heading,
			description: kind.word,
			icon: kind.icon,
			pick: model.pick,
		});
	}
	nodes.push(...statusNodes(state), ...model.rows.map(rowNode));
	return nodes;
}

/**
 * The details of the item the user has selected.
 *
 * The detail is a tree rather than a panel so the Entire view stays a
 * single place, and so a long prompt can be expanded rather than cut off.
 * The tree shows whatever the selection service last published and keeps
 * its nodes between reads, because the editor can only reveal a node it
 * has been given before.
 */
export class SessionDetailProvider implements vscode.TreeDataProvider<DetailNode> {
	private readonly changed = new vscode.EventEmitter<DetailNode | undefined>();
	private shown: ViewerState = { kind: 'empty' };
	private roots: DetailNode[] = [];
	private readonly parents = new Map<DetailLineNode, DetailTextNode>();

	readonly onDidChangeTreeData: vscode.Event<DetailNode | undefined> = this.changed.event;

	/** Shows what the selection service published. */
	render(state: ViewerState): void {
		this.shown = state;
		this.roots = buildDetailNodes(state);
		this.parents.clear();
		for (const node of this.roots) {
			if (node.kind === 'text') {
				for (const line of node.children) {
					this.parents.set(line, node);
				}
			}
		}
		this.changed.fire(undefined);
	}

	/** Shows a session as listed, with nothing read yet. Used when only the list row is known. */
	show(session: Session | undefined): void {
		if (!session) {
			this.render({ kind: 'empty' });
			return;
		}
		const selection: Selection = { kind: 'session', session };
		this.render({ kind: 'ready', selection, model: buildSessionDetail(selection) });
	}

	/** The state on show. */
	get state(): ViewerState {
		return this.shown;
	}

	/** The session currently on show, if a session is. */
	get current(): Session | undefined {
		return this.shown.kind === 'empty' || this.shown.kind === 'notice' ? undefined : this.shown.model.session?.session;
	}

	/** The first row, which is what the viewer reveals. */
	get firstNode(): DetailNode | undefined {
		return this.roots[0];
	}

	getTreeItem(element: DetailNode): vscode.TreeItem {
		switch (element.kind) {
			case 'field': {
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
			case 'text': {
				const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
				item.description = element.summary ?? pluralise(element.lines.length, 'line');
				item.contextValue = 'entirely.detailText';
				return item;
			}
			case 'header': {
				const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
				item.description = element.description;
				item.iconPath = new vscode.ThemeIcon(element.icon);
				item.contextValue =
					element.pick?.kind === 'change'
						? 'entirely.detail.change'
						: element.pick?.kind === 'trail'
							? 'entirely.detail.trail'
							: 'entirely.detail.header';
				return item;
			}
			case 'status': {
				const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon(element.icon);
				item.contextValue = `entirely.detail.${element.role}`;
				item.tooltip = element.label;
				if (element.role === 'gone') {
					item.description = 'Refresh';
					item.command = { command: 'entirely.refresh', title: 'Refresh' };
				}
				return item;
			}
			case 'line': {
				const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
				item.contextValue = 'entirely.detailLine';
				return item;
			}
		}
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
