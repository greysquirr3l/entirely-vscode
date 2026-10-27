import * as vscode from 'vscode';

import { humanizeStatus, pluralise, truncatePrompt, type Session, type SessionSource } from '../lib/entire';

/** A group of sessions that share a status. */
export interface SessionGroupNode {
	readonly kind: 'group';
	/** The status the sessions in this group share. */
	readonly status: string;
	readonly items: readonly SessionItemNode[];
}

/** One session. */
export interface SessionItemNode {
	readonly kind: 'session';
	readonly session: Session;
}

/** A node in the sessions tree. */
export type SessionNode = SessionGroupNode | SessionItemNode;

/**
 * The statuses that come first, in this order.
 *
 * An active session is what the user is waiting on, so it goes to the top
 * of the tree. Everything else follows alphabetically.
 */
const LEADING_STATUSES = ['active'];

/** Orders two statuses, putting the leading ones first. */
function compareStatuses(left: string, right: string): number {
	const leftRank = LEADING_STATUSES.indexOf(left);
	const rightRank = LEADING_STATUSES.indexOf(right);

	if (leftRank !== rightRank) {
		if (leftRank === -1) {
			return 1;
		}
		if (rightRank === -1) {
			return -1;
		}
		return leftRank - rightRank;
	}

	return left.localeCompare(right);
}

/**
 * Groups sessions by status.
 *
 * The groups and the items in them are stable objects, so the tree can
 * report the parent of any item.
 */
export function buildGroups(sessions: readonly Session[]): SessionGroupNode[] {
	const byStatus = new Map<string, SessionItemNode[]>();

	for (const session of sessions) {
		const items = byStatus.get(session.status) ?? [];
		items.push({ kind: 'session', session });
		byStatus.set(session.status, items);
	}

	return [...byStatus.keys()].sort(compareStatuses).map(status => ({
		kind: 'group',
		status,
		items: byStatus.get(status) ?? [],
	}));
}

/** The one-line summary of a session shown beside its label. */
export function describeSession(session: Session): string {
	const parts = [
		humanizeStatus(session.status),
		session.branch ?? 'no branch',
		pluralise(session.turns ?? 0, 'turn'),
		pluralise(session.checkpoints ?? 0, 'checkpoint'),
	];

	return parts.join(' · ');
}

/** The full detail of a session, shown on hover. */
export function tooltipFor(session: Session): vscode.MarkdownString {
	const lines = [
		`**${session.agent}** — ${humanizeStatus(session.status)}`,
		'',
		`- Session: \`${session.id}\``,
		`- Branch: ${session.branch ?? 'not on a branch'}`,
		`- Worktree: \`${session.worktreePath}\``,
		`- Turns: ${session.turns ?? 0}${session.pendingTurns ? ` (${session.pendingTurns} pending)` : ''}`,
		`- Checkpoints: ${session.checkpoints ?? 0}`,
	];

	if (session.model) {
		lines.push(`- Model: \`${session.model}\``);
	}
	if (session.startedAt) {
		lines.push(`- Started: ${session.startedAt.raw}`);
	}
	if (session.lastActive) {
		lines.push(`- Last active: ${session.lastActive.raw}`);
	}
	if (session.lastPrompt) {
		lines.push('', '**Last prompt**', '', session.lastPrompt);
	}

	const tooltip = new vscode.MarkdownString(lines.join('\n'));
	tooltip.supportThemeIcons = true;
	return tooltip;
}

/**
 * The Sessions tree view.
 *
 * The provider owns the view's shape. The sessions themselves come from a
 * source it is given, so the view can be exercised without a CLI.
 */
export class SessionsProvider implements vscode.TreeDataProvider<SessionNode> {
	private readonly changed = new vscode.EventEmitter<SessionNode | undefined>();
	private groups: SessionGroupNode[] = [];
	private timer: NodeJS.Timeout | undefined;
	private selected: SessionItemNode | undefined;
	private emptyReasonText: string | undefined;

	readonly onDidChangeTreeData: vscode.Event<SessionNode | undefined> = this.changed.event;

	/** Fires when the selected session changes. */
	readonly onDidChangeSelection = new vscode.EventEmitter<SessionItemNode | undefined>();

	constructor(
		private readonly source: SessionSource,
		private readonly refreshIntervalSeconds: () => number = () => 30,
	) {
		this.schedulePolling();
	}

	/** The session the user has selected, if any. */
	get currentSelection(): SessionItemNode | undefined {
		return this.selected;
	}

	/** Why there is nothing to show, when there is nothing to show. */
	get emptyReason(): string | undefined {
		return this.emptyReasonText;
	}

	/** Re-reads the sessions and re-renders the tree. */
	async refresh(): Promise<void> {
		const listing = await this.source();
		this.groups = buildGroups(listing.sessions);
		this.emptyReasonText = listing.sessions.length === 0 ? listing.emptyReason : undefined;
		this.changed.fire(undefined);
	}

	/** Asks the view to re-read its children. */
	invalidate(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(element: SessionNode): vscode.TreeItem {
		if (element.kind === 'group') {
			const item = new vscode.TreeItem(
				humanizeStatus(element.status),
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.description = pluralise(element.items.length, 'session');
			item.contextValue = 'entirely.sessionGroup';
			item.iconPath = new vscode.ThemeIcon('folder');
			return item;
		}

		const session = element.session;
		const prompt = session.lastPrompt ? truncatePrompt(session.lastPrompt) : undefined;
		const item = new vscode.TreeItem(
			prompt ? `${session.agent} — ${prompt}` : session.agent,
			vscode.TreeItemCollapsibleState.None,
		);

		item.description = describeSession(session);
		item.tooltip = tooltipFor(session);
		item.contextValue = 'entirely.session';
		item.iconPath = new vscode.ThemeIcon(
			session.status === 'active' ? 'pulse' : 'history',
		);
		item.command = {
			command: 'entirely.selectSession',
			title: 'Show Session',
			arguments: [element],
		};

		return item;
	}

	getChildren(element?: SessionNode): SessionNode[] {
		if (!element) {
			return [...this.groups];
		}
		if (element.kind === 'group') {
			return [...element.items];
		}
		return [];
	}

	getParent(element: SessionNode): SessionNode | undefined {
		if (element.kind !== 'session') {
			return undefined;
		}
		return this.groups.find(group => group.items.includes(element));
	}

	/** Records the session the user is looking at. */
	select(element: SessionItemNode | undefined): void {
		this.selected = element;
		this.onDidChangeSelection.fire(element);
	}

	/** Starts, stops or restarts the polling timer. */
	private schedulePolling(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		const seconds = this.refreshIntervalSeconds();
		if (seconds > 0) {
			this.timer = setInterval(() => {
				void this.refresh();
			}, seconds * 1000);
		}
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.onDidChangeSelection.dispose();
		this.changed.dispose();
	}
}
