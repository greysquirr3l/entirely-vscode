import * as vscode from 'vscode';

import {
	describeGate,
	pendingApprovals,
	pluralise,
	selectionKey,
	type GatedChange,
	type GatedTrail,
	type Selection,
	type Trail,
} from '../lib/entire';
import type { TrailListingSource } from '../services/trailListing';
import { rowUri } from './selectedMark';

/** One trail. */
export interface TrailNode {
	readonly kind: 'trail';
	readonly entry: GatedTrail;
	readonly changes: readonly ChangeNode[];
}

/** One change on a trail, with the state of its gate. */
export interface ChangeNode {
	readonly kind: 'change';
	readonly entry: GatedChange;
	/** The trail the change is on, which the review actions and the viewer need. */
	readonly trail: Trail;
}

/** A node in the trails tree. */
export type TrailsNode = TrailNode | ChangeNode;

/** Builds the nodes for a set of trails. */
export function buildTrailNodes(trails: readonly GatedTrail[]): TrailNode[] {
	return trails.map(entry => ({
		kind: 'trail',
		entry,
		changes: entry.changes.map(change => ({ kind: 'change', entry: change, trail: entry.trail })),
	}));
}

/** What selecting a trails row means. */
export function selectionOfTrailsNode(node: TrailsNode): Selection {
	return node.kind === 'trail'
		? { kind: 'trail', entry: node.entry }
		: { kind: 'change', trail: node.trail, entry: node.entry };
}

/** The line beside a trail: its state and how many changes wait. */
export function describeTrail(entry: GatedTrail): string {
	const waiting = entry.changes.filter(change => change.gate.kind === 'awaiting-approval').length;
	const parts: string[] = [entry.trail.status, pluralise(entry.trail.changes.length, 'change')];

	if (waiting > 0) {
		parts.push(`${waiting} awaiting approval`);
	}

	return parts.join(' · ');
}

/**
 * The Trails tree view.
 *
 * The provider owns the view's shape. The trails come from a source it
 * is given, so the view can be exercised without a CLI. Changes that wait
 * on an approval are counted in the view's badge, which the caller reads
 * from `pendingCount`.
 */
export class TrailsProvider implements vscode.TreeDataProvider<TrailsNode> {
	private readonly changed = new vscode.EventEmitter<TrailsNode | undefined>();
	private nodes: TrailNode[] = [];
	private pending = 0;
	private timer: NodeJS.Timeout | undefined;
	private refreshing = false;
	private emptyReasonText: string | undefined;

	readonly onDidChangeTreeData: vscode.Event<TrailsNode | undefined> = this.changed.event;

	constructor(
		private readonly source: TrailListingSource,
		private readonly refreshIntervalSeconds: () => number = () => 30,
	) {
		this.schedulePolling();
	}

	/** How many changes are waiting on an approval. */
	get pendingCount(): number {
		return this.pending;
	}

	/** Why there is nothing to show, when there is nothing to show. */
	get emptyReason(): string | undefined {
		return this.emptyReasonText;
	}

	/** The selection for a key, when the row is listed. */
	find(key: string): Selection | undefined {
		const node = this.findNode(key);
		return node ? selectionOfTrailsNode(node) : undefined;
	}

	private findNode(key: string): TrailsNode | undefined {
		for (const trail of this.nodes) {
			if (selectionKey(selectionOfTrailsNode(trail)) === key) {
				return trail;
			}
			const change = trail.changes.find(node => selectionKey(selectionOfTrailsNode(node)) === key);
			if (change) {
				return change;
			}
		}
		return undefined;
	}

	private selectCommand(node: TrailsNode): vscode.Command {
		return {
			command: 'entirely.selectItem',
			title: 'Show Details',
			arguments: [selectionOfTrailsNode(node), 'trails'],
		};
	}

	/** Re-reads the trails and re-renders the tree. */
	async refresh(): Promise<void> {
		// A listing costs several CLI calls per change, so a tick that
		// arrives while the last one is still running is dropped.
		if (this.refreshing) {
			return;
		}

		this.refreshing = true;
		try {
			await this.reload();
		} finally {
			this.refreshing = false;
		}
	}

	private async reload(): Promise<void> {
		const listing = await this.source();
		this.nodes = buildTrailNodes(listing.trails);
		this.pending = pendingApprovals(listing.trails).length;
		this.emptyReasonText = listing.trails.length === 0 ? listing.emptyReason : undefined;
		this.changed.fire(undefined);
	}

	getTreeItem(element: TrailsNode): vscode.TreeItem {
		if (element.kind === 'trail') {
			const trail = element.entry.trail;
			const item = new vscode.TreeItem(
				`#${trail.number} ${trail.title ?? 'Untitled trail'}`,
				element.changes.length > 0
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.None,
			);
			item.description = describeTrail(element.entry);
			item.contextValue = 'entirely.trail';
			item.iconPath = new vscode.ThemeIcon(
				trail.status === 'closed' ? 'archive' : 'git-pull-request',
			);
			item.resourceUri = rowUri(selectionKey(selectionOfTrailsNode(element)));
			item.tooltip = trail.url ?? item.label?.toString();
			item.command = this.selectCommand(element);
			return item;
		}

		const { change, gate } = element.entry;
		const item = new vscode.TreeItem(
			change.title ?? change.branch,
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = `${change.repository}/${change.number} · ${describeGate(gate)}`;
		item.contextValue =
			gate.kind === 'awaiting-approval' ? 'entirely.change.awaitingApproval' : 'entirely.change';
		item.iconPath = new vscode.ThemeIcon(
			gate.kind === 'awaiting-approval'
				? 'bell'
				: gate.kind === 'open'
					? 'check'
					: gate.kind === 'blocked'
						? 'error'
						: 'question',
		);
		item.resourceUri = rowUri(selectionKey(selectionOfTrailsNode(element)));
		item.command = this.selectCommand(element);
		item.tooltip =
			gate.kind === 'awaiting-approval' || gate.kind === 'blocked'
				? [`Branch ${change.branch}`, ...gate.blockers].join('\n')
				: `Branch ${change.branch}`;
		return item;
	}

	getChildren(element?: TrailsNode): TrailsNode[] {
		if (!element) {
			return [...this.nodes];
		}
		return element.kind === 'trail' ? [...element.changes] : [];
	}

	getParent(element: TrailsNode): TrailsNode | undefined {
		if (element.kind !== 'change') {
			return undefined;
		}
		return this.nodes.find(node => node.changes.includes(element));
	}

	/** Restarts the polling timer after the interval setting changes. */
	reschedule(): void {
		this.schedulePolling();
	}

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
		this.changed.dispose();
	}
}
