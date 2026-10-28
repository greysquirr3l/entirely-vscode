import * as vscode from 'vscode';

import {
	humanizeStatus,
	pluralise,
	truncatePrompt,
	type Checkpoint,
	type CheckpointDetail,
} from '../lib/entire';
import type { CheckpointSource } from '../services/checkpointSource';
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

/** A node in the checkpoints tree. */
export type CheckpointTreeNode = CheckpointNode | CheckpointFileNode;

/** The one-line summary of a checkpoint shown beside its label. */
export function describeCheckpoint(checkpoint: Checkpoint): string {
	const parts: string[] = [];

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
export function tooltipForCheckpoint(checkpoint: Checkpoint): vscode.MarkdownString {
	const tooltip = new Tooltip();

	tooltip.markdown('Checkpoint ').text(checkpoint.id);
	tooltip.markdown('\n\n');

	tooltip.item('Agent', checkpoint.agent ?? 'unknown');
	tooltip.item('Recorded', checkpoint.date?.raw ?? 'unknown');
	tooltip.item('Sessions', `${checkpoint.sessionCount}`);

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
	private checkpoints: readonly Checkpoint[] = [];
	private timer: NodeJS.Timeout | undefined;

	readonly onDidChangeTreeData: vscode.Event<CheckpointTreeNode | undefined> = this.changed.event;

	constructor(
		private readonly source: CheckpointSource,
		private readonly detailSource: (id: string) => Promise<CheckpointDetail | undefined>,
		private readonly refreshIntervalSeconds: () => number = () => 30,
	) {
		this.schedulePolling();
	}

	/** Why there is nothing to show, when there is nothing to show. */
	get emptyReason(): string | undefined {
		return this.emptyReasonText;
	}

	private emptyReasonText: string | undefined;

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
			item.description = describeCheckpoint(checkpoint);
			item.tooltip = tooltipForCheckpoint(checkpoint);
			item.contextValue = 'entirely.checkpoint';
			item.iconPath = new vscode.ThemeIcon('git-commit');
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
			return this.checkpoints.map(checkpoint => ({ kind: 'checkpoint', checkpoint }));
		}

		if (element.kind !== 'checkpoint') {
			return [];
		}

		const detail = this.details.get(element.checkpoint.id);
		if (!detail) {
			if (!this.attempted.has(element.checkpoint.id)) {
				this.loadDetail(element.checkpoint);
			}
			return [];
		}

		return detail.filesTouched.map(path => ({
			kind: 'file',
			checkpoint: element.checkpoint,
			path,
		}));
	}

	getParent(element: CheckpointTreeNode): CheckpointTreeNode | undefined {
		if (element.kind !== 'file') {
			return undefined;
		}
		return this.checkpoints
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
			const detail = await this.detailSource(checkpoint.id);
			if (detail) {
				this.details.set(checkpoint.id, detail);
			}
		} finally {
			this.loading.delete(checkpoint.id);
			this.changed.fire(undefined);
		}
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
