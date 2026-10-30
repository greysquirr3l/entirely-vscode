import * as vscode from 'vscode';

import {
	describeSearchOutcome,
	describeTokenReport,
	IMPORTED_LABEL,
	humanizeStatus,
	isImportedCheckpoint,
	pluralise,
	truncatePrompt,
	type Checkpoint,
	type CheckpointDetail,
	type TokenReport,
} from '../lib/entire';
import type { FilterState } from '../services/checkpointFilter';
import type { CheckpointSource } from '../services/checkpointSource';
import type { TokenUsageSource } from '../services/tokenUsage';
import { Tooltip } from './markdown';

/** A checkpoint in the tree. */
export interface CheckpointNode {
	readonly kind: 'checkpoint';
	readonly checkpoint: Checkpoint;
}

/** A file a checkpoint touched. */
export interface CheckpointFileNode {
	readonly kind: 'file';
	readonly checkpoint: Checkpoint;
	readonly path: string;
}

/** Where a checkpoint's token usage has got to. */
export type CheckpointUsageState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly report: TokenReport }
	| { readonly kind: 'failed'; readonly detail: string };

/** The token usage of a checkpoint. */
export interface CheckpointUsageNode {
	readonly kind: 'usage';
	readonly checkpoint: Checkpoint;
	readonly state: CheckpointUsageState;
}

/** A node in the checkpoints tree. */
export type CheckpointTreeNode = CheckpointNode | CheckpointFileNode | CheckpointUsageNode;

/** The row and tooltip for a checkpoint's usage. */
export function describeCheckpointUsage(state: CheckpointUsageState): {
	readonly description: string;
	readonly tooltip?: string;
} {
	if (state.kind === 'loading') {
		return { description: 'Reading…' };
	}
	if (state.kind === 'failed') {
		return { description: 'Not available', tooltip: state.detail };
	}

	const view = describeTokenReport(state.report);
	return {
		description: view.summary,
		tooltip: view.lines.map(line => `${line.label}: ${line.value}`).join('\n') || undefined,
	};
}

/** The one-line summary of a checkpoint shown beside its label. */
export function describeCheckpoint(checkpoint: Checkpoint, imported = checkpoint.imported === true): string {
	const parts: string[] = imported ? [IMPORTED_LABEL] : [];

	if (checkpoint.agent) {
		parts.push(checkpoint.agent);
	}
	if (checkpoint.date) {
		parts.push(checkpoint.date.raw);
	}
	if (checkpoint.sessionCount > 0) {
		parts.push(pluralise(checkpoint.sessionCount, 'session'));
	}

	return parts.join(' · ');
}

/** The full detail of a checkpoint, shown on hover. */
export function tooltipForCheckpoint(
	checkpoint: Checkpoint,
	imported = checkpoint.imported === true,
): vscode.MarkdownString {
	const tooltip = new Tooltip();

	tooltip.markdown('Checkpoint ').text(checkpoint.id);
	tooltip.markdown('\n\n');

	tooltip.item('Agent', checkpoint.agent ?? 'unknown');
	tooltip.item('Recorded', checkpoint.date?.raw ?? 'unknown');
	tooltip.item('Sessions', `${checkpoint.sessionCount}`);
	if (imported) {
		tooltip.item('Origin', 'Imported from past agent history. Read-only: it cannot be changed or resumed.');
	}

	if (checkpoint.message) {
		// The message is on the line after the heading rather than in a
		// paragraph of its own, so that a line of it cannot be read as
		// the start of a block — a quote, or a piece of indented code.
		tooltip.markdown('\n**Message**\\\n').text(checkpoint.message);
	}

	return tooltip.build();
}

/**
 * The Checkpoints tree view.
 *
 * The list comes from the CLI and says what each checkpoint is. The files a
 * checkpoint touched are fetched only when the checkpoint is opened, because
 * the CLI needs a separate call for each one.
 */
export class CheckpointsProvider implements vscode.TreeDataProvider<CheckpointTreeNode> {
	private readonly changed = new vscode.EventEmitter<CheckpointTreeNode | undefined>();
	private readonly details = new Map<string, CheckpointDetail>();
	private readonly loading = new Set<string>();
	private readonly attempted = new Set<string>();
	private readonly usages = new Map<string, CheckpointUsageState>();
	private checkpoints: readonly Checkpoint[] = [];
	private filter: FilterState = { kind: 'idle' };
	private matches: readonly Checkpoint[] = [];
	private timer: NodeJS.Timeout | undefined;

	readonly onDidChangeTreeData: vscode.Event<CheckpointTreeNode | undefined> = this.changed.event;

	constructor(
		private readonly source: CheckpointSource,
		private readonly detailSource: (id: string) => Promise<CheckpointDetail | undefined>,
		private readonly refreshIntervalSeconds: () => number = () => 30,
		private readonly usageSource?: Pick<TokenUsageSource, 'checkpoint'>,
	) {
		this.schedulePolling();
	}

	/** Why there is nothing to show, when there is nothing to show. */
	get emptyReason(): string | undefined {
		return this.emptyReasonText;
	}

	private emptyReasonText: string | undefined;

	/**
	 * What the view says above its rows.
	 *
	 * With a filter applied it says what the search found: that it is
	 * running, that nothing matched, or that it failed. Those are three
	 * different messages, because a failed search says nothing about
	 * whether anything matches.
	 */
	get viewMessage(): string | undefined {
		if (this.filter.kind === 'searching') {
			return 'Searching checkpoints…';
		}
		if (this.filter.kind === 'done') {
			const outcome = this.filter.outcome;
			if (outcome.kind === 'matches') {
				return `${pluralise(outcome.checkpoints.length, 'checkpoint')} matched.`;
			}
			return describeSearchOutcome(outcome);
		}
		return this.emptyReasonText;
	}

	/** Whether the list is narrowed by a search. */
	get filtered(): boolean {
		return this.filter.kind !== 'idle';
	}

	/** Narrows the list to a search's matches, or restores it. */
	applyFilter(state: FilterState): void {
		this.filter = state;
		if (state.kind === 'done') {
			this.matches = state.outcome.kind === 'matches' ? state.outcome.checkpoints : [];
		} else if (state.kind === 'idle') {
			this.matches = [];
		}
		this.changed.fire(undefined);
	}

	/** The checkpoints the tree lists now. */
	private get visible(): readonly Checkpoint[] {
		return this.filter.kind === 'idle' ? this.checkpoints : this.matches;
	}

	/** Re-reads the checkpoints and re-renders the tree. */
	async refresh(): Promise<void> {
		const listing = await this.source();
		this.checkpoints = listing.checkpoints;
		this.emptyReasonText =
			listing.checkpoints.length === 0 ? listing.emptyReason : undefined;
		this.changed.fire(undefined);
	}

	/** Asks the view to re-read its children. */
	invalidate(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(element: CheckpointTreeNode): vscode.TreeItem {
		if (element.kind === 'checkpoint') {
			const checkpoint = element.checkpoint;
			const label = checkpoint.message
				? truncatePrompt(checkpoint.message)
				: checkpoint.id;

			const item = new vscode.TreeItem(
				label,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
			// A search hit carries no marking of its own; the listed checkpoint does.
			const listed = this.checkpoints.find(candidate => candidate.id === checkpoint.id);
			const imported =
				listed?.imported === true || isImportedCheckpoint(checkpoint, this.details.get(checkpoint.id));
			item.description = describeCheckpoint(checkpoint, imported);
			item.tooltip = tooltipForCheckpoint(checkpoint, imported);
			// Imported checkpoints get a context of their own, so any command
			// that changes a checkpoint can be left off them in the manifest.
			item.contextValue = imported ? 'entirely.importedCheckpoint' : 'entirely.checkpoint';
			item.iconPath = new vscode.ThemeIcon(imported ? 'lock' : 'git-commit');
			return item;
		}

		if (element.kind === 'usage') {
			const view = describeCheckpointUsage(element.state);
			const item = new vscode.TreeItem('Tokens', vscode.TreeItemCollapsibleState.None);
			item.description = view.description;
			item.tooltip = view.tooltip;
			item.contextValue = 'entirely.checkpointUsage';
			item.iconPath = new vscode.ThemeIcon('pulse');
			return item;
		}

		const item = new vscode.TreeItem(
			element.path,
			vscode.TreeItemCollapsibleState.None,
		);
		item.contextValue = 'entirely.checkpointFile';
		item.iconPath = new vscode.ThemeIcon('file');
		item.command = {
			command: 'entirely.openCheckpointFile',
			title: 'Open Diff',
			arguments: [element],
		};
		return item;
	}

	getChildren(element?: CheckpointTreeNode): CheckpointTreeNode[] {
		if (!element) {
			return this.visible.map(checkpoint => ({ kind: 'checkpoint', checkpoint }));
		}

		if (element.kind !== 'checkpoint') {
			return [];
		}

		if (!this.attempted.has(element.checkpoint.id)) {
			void this.loadDetail(element.checkpoint);
		}

		const rows: CheckpointTreeNode[] = [];
		const usage = this.usages.get(element.checkpoint.id);
		if (usage) {
			rows.push({ kind: 'usage', checkpoint: element.checkpoint, state: usage });
		}

		const detail = this.details.get(element.checkpoint.id);
		if (detail) {
			for (const path of detail.filesTouched) {
				rows.push({ kind: 'file', checkpoint: element.checkpoint, path });
			}
		}
		return rows;
	}

	getParent(element: CheckpointTreeNode): CheckpointTreeNode | undefined {
		if (element.kind === 'checkpoint') {
			return undefined;
		}
		return this.visible
			.map((checkpoint): CheckpointNode => ({ kind: 'checkpoint', checkpoint }))
			.find(node => node.checkpoint.id === element.checkpoint.id);
	}

	/** The detail of a checkpoint, once it has been read. */
	detailFor(id: string): CheckpointDetail | undefined {
		return this.details.get(id);
	}

	/** Reads a checkpoint's detail, once. */
	private async loadDetail(checkpoint: Checkpoint): Promise<void> {
		if (this.loading.has(checkpoint.id)) {
			return;
		}
		this.loading.add(checkpoint.id);
		this.attempted.add(checkpoint.id);

		try {
			const [detail] = await Promise.all([
				this.detailSource(checkpoint.id),
				this.loadUsage(checkpoint),
			]);
			if (detail) {
				this.details.set(checkpoint.id, detail);
			}
		} finally {
			this.loading.delete(checkpoint.id);
			this.changed.fire(undefined);
		}
	}

	/** Reads a checkpoint's token usage from the CLI, when a source is wired in. */
	private async loadUsage(checkpoint: Checkpoint): Promise<void> {
		if (!this.usageSource) {
			return;
		}
		this.usages.set(checkpoint.id, { kind: 'loading' });
		const result = await this.usageSource.checkpoint(checkpoint.id);
		this.usages.set(
			checkpoint.id,
			result.kind === 'found'
				? { kind: 'ready', report: result.report }
				: { kind: 'failed', detail: result.detail },
		);
	}

	/**
	 * Restarts the polling timer.
	 *
	 * The interval is a setting, and a setting the user changes takes
	 * effect at once rather than at the next tick.
	 */
	reschedule(): void {
		this.schedulePolling();
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
		this.changed.dispose();
	}
}
