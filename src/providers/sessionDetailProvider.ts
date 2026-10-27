import * as vscode from 'vscode';

import { humanizeStatus, pluralise, type Session } from '../lib/entire';

/** One field of the selected session. */
export interface DetailFieldNode {
	readonly kind: 'field';
	readonly label: string;
	readonly value: string;
	readonly tooltip?: string;
}

/** A block of text, such as the last prompt. */
export interface DetailTextNode {
	readonly kind: 'text';
	readonly label: string;
	readonly lines: readonly string[];
}

/** One line of a block of text. */
export interface DetailLineNode {
	readonly kind: 'line';
	readonly text: string;
}

/** A node in the session detail tree. */
export type DetailNode = DetailFieldNode | DetailTextNode | DetailLineNode;

/**
 * The details of the session the user has selected.
 *
 * The detail is a tree rather than a panel so the Entire view stays a
 * single place, and so a long prompt can be expanded rather than cut off.
 */
export class SessionDetailProvider implements vscode.TreeDataProvider<DetailNode> {
	private readonly changed = new vscode.EventEmitter<DetailNode | undefined>();
	private session: Session | undefined;

	readonly onDidChangeTreeData: vscode.Event<DetailNode | undefined> = this.changed.event;

	/** Shows the details of a session. */
	show(session: Session | undefined): void {
		this.session = session;
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
			return item;
		}

		if (element.kind === 'text') {
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.description = pluralise(element.lines.length, 'line');
			item.contextValue = 'entirely.detailText';
			return item;
		}

		const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
		item.contextValue = 'entirely.detailLine';
		return item;
	}

	getChildren(element?: DetailNode): DetailNode[] {
		if (!element) {
			return this.fields();
		}
		if (element.kind === 'text') {
			return element.lines.map(text => ({ kind: 'line', text } as DetailLineNode));
		}
		return [];
	}

	getParent(element: DetailNode): DetailNode | undefined {
		if (element.kind !== 'line') {
			return undefined;
		}
		return this.fields().find(
			node => node.kind === 'text' && node.lines.includes(element.text),
		);
	}

	/** The rows describing the selected session. */
	private fields(): DetailNode[] {
		const session = this.session;
		if (!session) {
			return [];
		}

		const rows: DetailNode[] = [
			{ kind: 'field', label: 'Agent', value: session.agent },
			{ kind: 'field', label: 'Status', value: humanizeStatus(session.status) },
			{ kind: 'field', label: 'Branch', value: session.branch ?? 'Not on a branch' },
			{ kind: 'field', label: 'Worktree', value: session.worktreePath },
			{ kind: 'field', label: 'Session', value: session.id },
			{
				kind: 'field',
				label: 'Turns',
				value: `${session.turns ?? 0}${
					session.pendingTurns ? ` (${session.pendingTurns} pending)` : ''
				}`,
			},
			{
				kind: 'field',
				label: 'Checkpoints',
				value: String(session.checkpoints ?? 0),
			},
		];

		if (session.model) {
			rows.push({ kind: 'field', label: 'Model', value: session.model });
		}
		if (session.startedAt) {
			rows.push({ kind: 'field', label: 'Started', value: session.startedAt.raw });
		}
		if (session.lastActive) {
			rows.push({ kind: 'field', label: 'Last active', value: session.lastActive.raw });
		}
		if (session.lastPrompt) {
			rows.push({
				kind: 'text',
				label: 'Last prompt',
				lines: session.lastPrompt.split('\n'),
			});
		}

		return rows;
	}

	dispose(): void {
		this.changed.dispose();
	}
}
