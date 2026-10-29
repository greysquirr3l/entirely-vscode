import * as vscode from 'vscode';

import {
	describeTokenReport,
	humanizeStatus,
	pluralise,
	type Session,
	type SessionInfo,
	type TokenReport,
	type ToolCallCount,
} from '../lib/entire';

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
}

/** One line of a block of text. */
export interface DetailLineNode {
	readonly kind: 'line';
	readonly text: string;
}

/** A node in the session detail tree. */
export type DetailNode = DetailFieldNode | DetailTextNode | DetailLineNode;

/** Where the tool calls have got to. */
type ToolCallState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly counts: readonly ToolCallCount[]; readonly truncated: boolean }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where the token usage has got to. */
type UsageState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly report: TokenReport }
	| { readonly kind: 'failed'; readonly detail: string };

/**
 * The details of the session the user has selected.
 *
 * The detail is a tree rather than a panel so the Entire view stays a
 * single place, and so a long prompt can be expanded rather than cut off.
 */
export class SessionDetailProvider implements vscode.TreeDataProvider<DetailNode> {
	private readonly changed = new vscode.EventEmitter<DetailNode | undefined>();
	private session: Session | undefined;
	private info: SessionInfo | undefined;
	private infoFailure: string | undefined;
	private toolCalls: ToolCallState | undefined;
	private usage: UsageState | undefined;

	readonly onDidChangeTreeData: vscode.Event<DetailNode | undefined> = this.changed.event;

	/** Shows the details of a session. */
	show(session: Session | undefined): void {
		this.session = session;
		this.info = undefined;
		this.infoFailure = undefined;
		this.toolCalls = undefined;
		this.usage = undefined;
		this.changed.fire(undefined);
	}

	/** Adds what `session info` reported to the session on show. */
	showInfo(info: SessionInfo): void {
		if (this.session?.id !== info.id) {
			return;
		}
		this.session = info;
		this.info = info;
		this.infoFailure = undefined;
		this.changed.fire(undefined);
	}

	/** Says why `session info` could not be read. */
	showInfoFailure(id: string, detail: string): void {
		if (this.session?.id !== id) {
			return;
		}
		this.infoFailure = detail;
		this.changed.fire(undefined);
	}

	/** Says the token usage is being read. */
	showUsageLoading(id: string): void {
		this.setUsage(id, { kind: 'loading' });
	}

	/** Shows the token usage the CLI reported. */
	showUsage(id: string, report: TokenReport): void {
		this.setUsage(id, { kind: 'ready', report });
	}

	/** Says why the token usage could not be read. */
	showUsageFailure(id: string, detail: string): void {
		this.setUsage(id, { kind: 'failed', detail });
	}

	private setUsage(id: string, state: UsageState): void {
		if (this.session?.id !== id) {
			return;
		}
		this.usage = state;
		this.changed.fire(undefined);
	}

	/** Says the tool calls are being read. */
	showToolCallsLoading(id: string): void {
		this.setToolCalls(id, { kind: 'loading' });
	}

	/** Shows how many times each tool was called. */
	showToolCalls(id: string, counts: readonly ToolCallCount[], truncated: boolean): void {
		this.setToolCalls(id, { kind: 'ready', counts, truncated });
	}

	/** Says why the tool calls could not be read. */
	showToolCallsFailure(id: string, detail: string): void {
		this.setToolCalls(id, { kind: 'failed', detail });
	}

	private setToolCalls(id: string, state: ToolCallState): void {
		if (this.session?.id !== id) {
			return;
		}
		this.toolCalls = state;
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
			const item = new vscode.TreeItem(
				element.label,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
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
			{ kind: 'field', label: 'Worktree', value: session.worktreePath ?? 'None (imported)' },
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

		this.addInfoRows(rows);
		this.addUsageRows(rows);
		this.addTranscriptRows(rows, session);

		return rows;
	}

	/** The rows only `session info` can fill in. */
	private addInfoRows(rows: DetailNode[]): void {
		const info = this.info;
		if (this.infoFailure) {
			rows.push({
				kind: 'field',
				label: 'Detail',
				value: 'Not available',
				tooltip: this.infoFailure,
			});
		}
		if (!info) {
			return;
		}

		if (info.endedAt) {
			rows.push({ kind: 'field', label: 'Ended', value: info.endedAt.raw });
		}
		if (info.lastCheckpointId) {
			rows.push({ kind: 'field', label: 'Last checkpoint', value: info.lastCheckpointId });
		}
		if (info.filesTouched && info.filesTouched.length > 0) {
			rows.push({
				kind: 'text',
				label: 'Files touched',
				lines: info.filesTouched,
				summary: pluralise(info.filesTouched.length, 'file'),
			});
		}
	}

	/**
	 * The token usage, from `session tokens`.
	 *
	 * The counts in `session info` are not used: they read zero when the
	 * agent recorded nothing, and zero is a claim the CLI did not make.
	 */
	private addUsageRows(rows: DetailNode[]): void {
		const usage = this.usage;
		if (!usage) {
			return;
		}
		if (usage.kind === 'loading') {
			rows.push({ kind: 'field', label: 'Tokens', value: 'Reading…' });
			return;
		}
		if (usage.kind === 'failed') {
			rows.push({ kind: 'field', label: 'Tokens', value: 'Not available', tooltip: usage.detail });
			return;
		}

		const view = describeTokenReport(usage.report);
		if (!view.reported) {
			rows.push({
				kind: 'field',
				label: 'Tokens',
				value: view.summary,
				tooltip: view.lines.map(line => line.value).join('\n') || undefined,
			});
			return;
		}
		rows.push({
			kind: 'text',
			label: 'Tokens',
			lines: view.lines.map(line => `${line.label}: ${line.value}`),
			summary: view.summary,
		});
	}

	/** The transcript link and the tool calls. The transcript itself never goes in the tree. */
	private addTranscriptRows(rows: DetailNode[], session: Session): void {
		rows.push({
			kind: 'field',
			label: 'Transcript',
			value: 'Open in editor',
			command: { command: 'entirely.openTranscript', arguments: [session.id] },
		});

		const calls = this.toolCalls;
		if (!calls) {
			return;
		}
		if (calls.kind === 'loading') {
			rows.push({ kind: 'field', label: 'Tool calls', value: 'Reading…' });
		} else if (calls.kind === 'failed') {
			rows.push({
				kind: 'field',
				label: 'Tool calls',
				value: 'Not available',
				tooltip: calls.detail,
			});
		} else {
			const total = calls.counts.reduce((sum, entry) => sum + entry.count, 0);
			rows.push({
				kind: 'text',
				label: 'Tool calls',
				lines: calls.counts.map(entry => `${entry.name} × ${entry.count}`),
				summary: `${total}${calls.truncated ? ' (partial transcript)' : ''}`,
			});
		}
	}

	dispose(): void {
		this.changed.dispose();
	}
}
