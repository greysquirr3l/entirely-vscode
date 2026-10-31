import * as vscode from 'vscode';

import {
	branchLabel,
	describeGate,
	pendingApprovals,
	pluralise,
	selectionKey,
	type GatedChange,
	type GatedTrail,
	type Selection,
	type Trail,
} from '../lib/entire';
import type { BadgeCoverage, TrailChangesService } from '../services/trailChanges';
import type { TrailListingSource } from '../services/trailListing';
import { rowUri } from './selectedMark';
import type { ThreadSource } from '../services/trailThreadSource';
import { ThreadRows, changeContextValue, changeKeyOf, describeChangeLine, threadTreeItem, type ThreadGroupNode, type ThreadNode } from './trailThreads';

/** One trail. */
export interface TrailNode {
	readonly kind: 'trail';
	/** The trail. Its changes are known only once `changes` is. */
	entry: GatedTrail;
	/** The change rows, or `undefined` while the trail's changes have not been read. */
	changes: readonly ChangeNode[] | undefined;
}

/** One change on a trail, with the state of its gate. */
export interface ChangeNode {
	readonly kind: 'change';
	readonly entry: GatedChange;
	/** The trail the change is on, which the review actions and the detail panel need. */
	readonly trail: Trail;
}

/** A line under a trail that says why its changes are not shown. */
export interface NoteNode {
	readonly kind: 'note';
	readonly text: string;
}

/** A node in the trails tree. */
export type TrailsNode = TrailNode | ChangeNode | NoteNode | ThreadNode;

/** The nodes of a trail's changes. */
export function buildChangeNodes(entry: GatedTrail): ChangeNode[] {
	return entry.changes.map(change => ({ kind: 'change', entry: change, trail: entry.trail }));
}

/** Builds the nodes for a set of trails, with changes only for the trails whose changes were read. */
export function buildTrailNodes(
	trails: readonly GatedTrail[],
	loaded: (number: number) => GatedTrail | undefined = () => undefined,
): TrailNode[] {
	return trails.map(listed => {
		const known = loaded(listed.trail.number);
		return known
			? { kind: 'trail', entry: known, changes: buildChangeNodes(known) }
			: { kind: 'trail', entry: listed, changes: undefined };
	});
}

/** What selecting a trails row means. */
export function selectionOfRow(node: TrailNode | ChangeNode): Selection {
	return node.kind === 'trail'
		? { kind: 'trail', entry: node.entry }
		: { kind: 'change', trail: node.trail, entry: node.entry };
}

/** What selecting any row of the tree means; a line that is only a note selects nothing. */
export function selectionOfTrailsNode(node: TrailsNode): Selection | undefined {
	return node.kind === 'trail' || node.kind === 'change' ? selectionOfRow(node) : undefined;
}

/** The line beside a trail: its state and how many changes wait. */
export function describeTrail(entry: GatedTrail, loaded: boolean): string {
	const parts: string[] = [entry.trail.status];

	if (!loaded) {
		parts.push('changes not loaded');
		return parts.join(' · ');
	}

	parts.push(pluralise(entry.changes.length, 'change'));
	const waiting = entry.changes.filter(change => change.gate.kind === 'awaiting-approval').length;
	if (waiting > 0) {
		parts.push(`${waiting} awaiting approval`);
	}

	return parts.join(' · ');
}

/** What a trail's changes are read through, and how many trails the badge reads. */
export interface TrailsReading {
	readonly changes: Pick<TrailChangesService, 'changesOf' | 'peek' | 'clear' | 'readBadge'>;
	readonly badgeLimit: () => number;
}

/** What asks for a refresh: a person or an action, or the background timer. */
export type RefreshTrigger = 'user' | 'background';

/** The words under the badge, saying which trails it counted. */
export function describeBadge(awaiting: number, coverage: BadgeCoverage | undefined, loadedTrails: number): string {
	const head = `${awaiting} ${awaiting === 1 ? 'change' : 'changes'} not yet approved`;
	if (!coverage) {
		return `${head}, counted from the ${pluralise(loadedTrails, 'trail')} whose changes were read`;
	}
	const rest = coverage.open - coverage.read;
	const tail = rest > 0 ? `; ${pluralise(rest, 'open trail')} not read, expand one to read it` : '';
	return `${head}, counted from ${coverage.read} of ${pluralise(coverage.open, 'open trail')}${tail}`;
}

/**
 * The Trails tree view.
 *
 * The provider owns the view's shape. The trails come from a source it is
 * given, so the view can be exercised without a CLI. The CLI's list carries
 * no changes, so a trail starts as "changes not loaded" and its changes are
 * read, with their gates, when it is expanded. The badge counts the changes
 * awaiting an approval among the trails that have been read: once per
 * refresh a person or an action asks for, up to a limit the user sets, and
 * never from the background timer.
 */
export class TrailsProvider implements vscode.TreeDataProvider<TrailsNode> {
	private readonly changed = new vscode.EventEmitter<TrailsNode | undefined>();
	private nodes: TrailNode[] = [];
	private timer: NodeJS.Timeout | undefined;
	private refreshing = false;
	private emptyReasonText: string | undefined;
	private coverage: BadgeCoverage | undefined;
	private disposed = false;
	private readonly threadRows: ThreadRows | undefined;
	private readonly watchListener: { dispose(): void } | undefined;

	readonly onDidChangeTreeData: vscode.Event<TrailsNode | undefined> = this.changed.event;

	constructor(
		private readonly source: TrailListingSource,
		private readonly refreshIntervalSeconds: () => number = () => 30,
		private readonly reading?: TrailsReading,
		private readonly threads?: ThreadSource,
	) {
		this.threadRows = threads ? new ThreadRows(threads) : undefined;
		// A change's row shows whether it is watched, so it is redrawn when that changes.
		this.watchListener = threads?.onWatchChanged(key => this.redrawChange(key));
		this.schedulePolling();
	}

	/** How many changes are waiting on an approval, among the trails whose changes were read. */
	get pendingCount(): number {
		return pendingApprovals(this.nodes.filter(node => node.changes !== undefined).map(node => node.entry)).length;
	}

	/** The count for the view's badge, with words saying what it covers, or nothing when nothing waits. */
	get badge(): { readonly value: number; readonly tooltip: string } | undefined {
		const waiting = this.pendingCount;
		if (waiting === 0) {
			return undefined;
		}
		const loaded = this.nodes.filter(node => node.changes !== undefined).length;
		return { value: waiting, tooltip: describeBadge(waiting, this.coverage, loaded) };
	}

	/** Why there is nothing to show, when there is nothing to show. */
	get emptyReason(): string | undefined {
		return this.emptyReasonText;
	}

	/** The selection for a key, when the row is listed. */
	find(key: string): Selection | undefined {
		const node = this.findNode(key);
		return node ? selectionOfRow(node) : undefined;
	}

	/**
	 * Whether a row is listed: `true` or `false`, or `undefined` when it
	 * cannot be told yet because it may be a change of a trail not read.
	 */
	has(key: string): boolean | undefined {
		if (this.findNode(key)) {
			return true;
		}
		return key.startsWith('change:') && this.nodes.some(node => node.changes === undefined) ? undefined : false;
	}

	private findNode(key: string): TrailNode | ChangeNode | undefined {
		for (const trail of this.nodes) {
			if (selectionKey(selectionOfRow(trail)) === key) {
				return trail;
			}
			const change = trail.changes?.find(node => selectionKey(selectionOfRow(node)) === key);
			if (change) {
				return change;
			}
		}
		return undefined;
	}

	private selectCommand(node: TrailNode | ChangeNode): vscode.Command {
		return {
			command: 'entirely.selectItem',
			title: 'Show Details',
			arguments: [selectionOfRow(node), 'trails'],
		};
	}

	/**
	 * Re-reads the trails and re-renders the tree.
	 *
	 * A refresh a person or an action asks for forgets what was read, and
	 * then reads the changes of the open trails for the badge. The
	 * background refresh reads the list alone and keeps the changes it has
	 * already read.
	 */
	async refresh(trigger: RefreshTrigger = 'user'): Promise<void> {
		// A listing is several CLI calls, so a tick that arrives while the
		// last one is still running is dropped.
		if (this.refreshing || this.disposed) {
			return;
		}

		this.refreshing = true;
		try {
			await this.reload(trigger);
		} finally {
			this.refreshing = false;
		}
	}

	private async reload(trigger: RefreshTrigger): Promise<void> {
		const listing = await this.source();
		if (this.disposed) {
			return;
		}
		const reading = this.reading;
		if (trigger === 'user') {
			reading?.changes.clear();
			this.threadRows?.forget();
			this.coverage = undefined;
		}
		const carried = new Map(
			this.nodes.filter(node => node.changes !== undefined).map(node => [node.entry.trail.number, node.entry] as const),
		);
		this.nodes = buildTrailNodes(listing.trails, number =>
			trigger === 'background' ? (carried.get(number) ?? reading?.changes.peek(number)) : reading?.changes.peek(number),
		);
		this.emptyReasonText = listing.trails.length === 0 ? listing.emptyReason : undefined;
		this.changed.fire(undefined);

		const limit = reading?.badgeLimit() ?? 0;
		if (trigger !== 'user' || !reading || limit <= 0) {
			return;
		}
		this.coverage = await reading.changes.readBadge(
			listing.trails.map(entry => entry.trail),
			limit,
		);
		if (this.disposed) {
			return;
		}
		// Rows that were read for the badge now show their changes.
		this.nodes = buildTrailNodes(listing.trails, number => reading.changes.peek(number));
		this.changed.fire(undefined);
	}

	/**
	 * Reads a change's Comments and Findings again.
	 *
	 * What was kept for the change is forgotten and the rows already drawn
	 * are redrawn, which makes the view ask for them again. Called after the
	 * person's own writes, after a retry and when a watch reports an event.
	 */
	invalidateThreads(key: string): void {
		if (!this.threadRows || this.disposed) {
			return;
		}
		this.threadRows.forget(key);
		for (const group of this.threadRows.drawn(key)) {
			this.changed.fire(group);
		}
	}

	/** Reads the group a failed row belongs to again. */
	retryThreads(node: ThreadNode): void {
		const group: ThreadGroupNode = node.kind === 'threadGroup' ? node : node.kind === 'threadNote' ? node.group : { kind: 'threadGroup', group: node.kind === 'discussion' ? 'comments' : 'findings', change: node.change };
		this.invalidateThreads(changeKeyOf(group.change));
	}

	private redrawChange(key: string): void {
		if (this.disposed) {
			return;
		}
		for (const trail of this.nodes) {
			const change = trail.changes?.find(node => changeKeyOf(node) === key);
			if (change) {
				this.changed.fire(change);
			}
		}
	}

	getTreeItem(element: TrailsNode): vscode.TreeItem {
		if (element.kind === 'threadGroup' || element.kind === 'discussion' || element.kind === 'finding' || element.kind === 'threadNote') {
			return threadTreeItem(element);
		}
		if (element.kind === 'note') {
			const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon('warning');
			item.contextValue = 'entirely.trailNote';
			item.tooltip = element.text;
			return item;
		}

		if (element.kind === 'trail') {
			const trail = element.entry.trail;
			const item = new vscode.TreeItem(
				`#${trail.number} ${trail.title ?? 'Untitled trail'}`,
				element.changes !== undefined && element.changes.length === 0
					? vscode.TreeItemCollapsibleState.None
					: vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.description = describeTrail(element.entry, element.changes !== undefined);
			item.contextValue = 'entirely.trail';
			item.iconPath = new vscode.ThemeIcon(
				trail.status === 'closed' ? 'archive' : 'git-pull-request',
			);
			item.resourceUri = rowUri(selectionKey(selectionOfRow(element)));
			item.tooltip = trail.url ?? item.label?.toString();
			item.command = this.selectCommand(element);
			return item;
		}

		const { change, gate } = element.entry;
		const watch = this.threads?.watchState(changeKeyOf(element));
		const item = new vscode.TreeItem(
			change.title ?? (change.branch.length > 0 ? change.branch : `${change.repository}/${change.number}`),
			this.threadRows ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
		);
		item.description = describeChangeLine(`${change.repository}/${change.number} · ${describeGate(gate)}`, watch);
		item.contextValue = changeContextValue(gate.kind === 'awaiting-approval', watch);
		item.iconPath = new vscode.ThemeIcon(
			gate.kind === 'awaiting-approval'
				? 'bell'
				: gate.kind === 'open'
					? 'check'
					: gate.kind === 'blocked'
						? 'error'
						: 'question',
		);
		item.resourceUri = rowUri(selectionKey(selectionOfRow(element)));
		item.command = this.selectCommand(element);
		const branch = change.branch.length > 0 ? `Branch ${change.branch}` : 'No branch';
		item.tooltip =
			gate.kind === 'awaiting-approval' || gate.kind === 'blocked'
				? [branch, ...gate.blockers].join('\n')
				: branch;
		return item;
	}

	getChildren(element?: TrailsNode): TrailsNode[] | Promise<TrailsNode[]> {
		if (!element) {
			return [...this.nodes];
		}
		if (element.kind === 'change') {
			return this.threadRows ? this.threadRows.groupsOf(element) : [];
		}
		if (element.kind === 'threadGroup') {
			return this.threadRows ? this.threadRows.read(element) : [];
		}
		if (element.kind !== 'trail') {
			return [];
		}
		if (element.changes !== undefined) {
			return [...element.changes];
		}
		return this.reading ? this.loadChildren(element, this.reading) : [];
	}

	private async loadChildren(element: TrailNode, reading: TrailsReading): Promise<TrailsNode[]> {
		const read = await reading.changes.changesOf(element.entry.trail);
		if (read.kind === 'failed') {
			// Not kept on the node, so expanding again reads again.
			return [{ kind: 'note', text: `Could not load the changes of #${element.entry.trail.number}: ${read.detail}` }];
		}
		if (this.disposed) {
			return [];
		}
		// The node may have been replaced by a refresh while this was reading.
		const current = this.nodes.find(node => node.entry.trail.number === element.entry.trail.number) ?? element;
		if (current.changes === undefined) {
			current.entry = read.entry;
			current.changes = buildChangeNodes(read.entry);
			// The trail's own row now has a count to show. Redrawn after this
			// answer is returned, so the click that expanded it has already run.
			void Promise.resolve().then(() => {
				if (!this.disposed) {
					this.changed.fire(current);
				}
			});
		}
		return [...(current.changes ?? [])];
	}

	getParent(element: TrailsNode): TrailsNode | undefined {
		if (element.kind === 'discussion' || element.kind === 'finding') {
			return this.threadRows?.groupsOf(element.change)[element.kind === 'discussion' ? 0 : 1];
		}
		if (element.kind === 'threadNote') {
			return element.group;
		}
		if (element.kind === 'threadGroup') {
			return element.change;
		}
		if (element.kind !== 'change') {
			return undefined;
		}
		return this.nodes.find(node => node.changes?.includes(element));
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
				void this.refresh('background');
			}, seconds * 1000);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.watchListener?.dispose();
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.changed.dispose();
	}
}
