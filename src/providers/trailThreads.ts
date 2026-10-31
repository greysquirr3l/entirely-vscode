import * as vscode from 'vscode';

import {
	describeDiscussion,
	describeFinding,
	describeWatchState,
	discussionContextValue,
	discussionLabel,
	findingContextValue,
	findingIcon,
	findingLabel,
	type Trail,
	type TrailComment,
	type TrailFinding,
	type WatchState,
} from '../lib/entire';
import type { ThreadSource } from '../services/trailThreadSource';
import type { ChangeNode } from './trailsProvider';

/** The two groups under a change. */
export type ThreadGroup = 'comments' | 'findings';

/** A group under a change: its discussions or its findings. Nothing is read until it is expanded. */
export interface ThreadGroupNode {
	readonly kind: 'threadGroup';
	readonly group: ThreadGroup;
	change: ChangeNode;
}

/** One discussion. */
export interface DiscussionNode {
	readonly kind: 'discussion';
	readonly change: ChangeNode;
	readonly discussion: TrailComment;
}

/** One finding. */
export interface FindingNode {
	readonly kind: 'finding';
	readonly change: ChangeNode;
	readonly finding: TrailFinding;
}

/** A line in a group: that it is empty, or that it could not be read, with the means to read it again. */
export interface ThreadNoteNode {
	readonly kind: 'threadNote';
	readonly text: string;
	readonly failed: boolean;
	readonly group: ThreadGroupNode;
}

/** A node under a change. */
export type ThreadNode = ThreadGroupNode | DiscussionNode | FindingNode | ThreadNoteNode;

/** The key a change's rows are cached and watched under: its repository and number. */
export function changeKeyOf(change: ChangeNode): string {
	return `${change.entry.change.repository}/${change.entry.change.number}`;
}

/** The line beside a change: its gate and watch state. */
export function describeChangeLine(base: string, watch: WatchState | undefined): string {
	const state = describeWatchState(watch);
	return state ? `${base} · ${state}` : base;
}

/** The context value of a change row, with `.watched` added while it is followed. */
export function changeContextValue(awaiting: boolean, watch: WatchState | undefined): string {
	const base = awaiting ? 'entirely.change.awaitingApproval' : 'entirely.change';
	return watch?.kind === 'watching' || watch?.kind === 'starting' ? `${base}.watched` : base;
}

/**
 * Builds and reads the Comments and Findings groups under changes.
 *
 * The rows of a group are read when the group is first expanded and then
 * kept, so the view's own refresh timer does not read them again. They are
 * read again after a refresh the person asked for, after one of their own
 * writes, after a retry and when a watch reports an event, each of which
 * clears what was kept for that change. A failed read is not kept.
 */
export class ThreadRows {
	private readonly groups = new Map<string, ThreadGroupNode>();
	private readonly kept = new Map<string, ThreadNode[]>();

	constructor(private readonly source: ThreadSource) {}

	private idOf(change: ChangeNode, group: ThreadGroup): string {
		return `${changeKeyOf(change)}:${group}`;
	}

	/** The two group rows of a change, the same objects each time so they can be redrawn. */
	groupsOf(change: ChangeNode): ThreadGroupNode[] {
		return (['comments', 'findings'] as const).map(group => {
			const id = this.idOf(change, group);
			const known = this.groups.get(id);
			if (known) {
				known.change = change;
				return known;
			}
			const node: ThreadGroupNode = { kind: 'threadGroup', group, change };
			this.groups.set(id, node);
			return node;
		});
	}

	/** The group rows of a change that have been drawn, for redrawing after a change. */
	drawn(key: string): ThreadGroupNode[] {
		return [...this.groups.entries()].filter(([id]) => id.startsWith(`${key}:`)).map(([, node]) => node);
	}

	/** Forgets what was read for a change, or for every change. */
	forget(key?: string): void {
		for (const id of [...this.kept.keys()]) {
			if (key === undefined || id.startsWith(`${key}:`)) {
				this.kept.delete(id);
			}
		}
	}

	/** The rows of a group, read now unless they were kept. */
	async read(node: ThreadGroupNode): Promise<ThreadNode[]> {
		const id = this.idOf(node.change, node.group);
		const held = this.kept.get(id);
		if (held) {
			return [...held];
		}
		const selector = node.change.entry.change;
		const key = { kind: 'change' as const, repository: selector.repository, number: selector.number };
		const note = (text: string, failed: boolean): ThreadNode[] => [{ kind: 'threadNote', text, failed, group: node }];

		if (node.group === 'comments') {
			const read = await this.source.discussions(key);
			if (read.kind === 'failed') {
				return note(`Could not read the discussions: ${read.detail}`, true);
			}
			const rows: ThreadNode[] =
				read.value.length === 0
					? note('No discussions', false)
					: read.value.map(discussion => ({ kind: 'discussion', change: node.change, discussion }));
			this.kept.set(id, rows);
			return [...rows];
		}

		const read = await this.source.findings(key);
		if (read.kind === 'failed') {
			return note(`Could not read the findings: ${read.detail}`, true);
		}
		const rows: ThreadNode[] =
			read.value.length === 0
				? note('No findings', false)
				: read.value.map(finding => ({ kind: 'finding', change: node.change, finding }));
		this.kept.set(id, rows);
		return [...rows];
	}
}

/** The tree item of a node under a change. */
export function threadTreeItem(node: ThreadNode): vscode.TreeItem {
	switch (node.kind) {
		case 'threadGroup': {
			const item = new vscode.TreeItem(node.group === 'comments' ? 'Comments' : 'Findings', vscode.TreeItemCollapsibleState.Collapsed);
			item.iconPath = new vscode.ThemeIcon(node.group === 'comments' ? 'comment-discussion' : 'search');
			item.contextValue = 'entirely.threadGroup';
			return item;
		}
		case 'discussion': {
			const item = new vscode.TreeItem(discussionLabel(node.discussion), vscode.TreeItemCollapsibleState.None);
			item.description = describeDiscussion(node.discussion);
			item.iconPath = new vscode.ThemeIcon(node.discussion.resolved ? 'pass' : 'comment-discussion');
			item.contextValue = discussionContextValue(node.discussion);
			return item;
		}
		case 'finding': {
			const item = new vscode.TreeItem(findingLabel(node.finding), vscode.TreeItemCollapsibleState.None);
			item.description = describeFinding(node.finding);
			item.iconPath = new vscode.ThemeIcon(findingIcon(node.finding));
			item.contextValue = findingContextValue(node.finding);
			return item;
		}
		case 'threadNote': {
			const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon(node.failed ? 'warning' : 'info');
			item.contextValue = node.failed ? 'entirely.threadFailed' : 'entirely.threadEmpty';
			item.tooltip = node.text;
			return item;
		}
	}
}

/** The trail a thread row belongs to, which a row's parent chain ends at. */
export function trailOfThread(node: ThreadNode): Trail {
	return node.kind === 'threadGroup' ? node.change.trail : node.kind === 'threadNote' ? node.group.change.trail : node.change.trail;
}
