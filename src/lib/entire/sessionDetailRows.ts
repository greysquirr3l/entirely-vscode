import type { Session } from './types';
import type { SessionInfo } from './sessionInfo';
import { describeTokenReport, type TokenReport } from './tokenUsage';
import type { ToolCallCount } from './transcript';
import { humanizeStatus, pluralise } from './text';

/** One row of a detail view. A row with `lines` opens into a block of text. */
export interface DetailRow {
	readonly label: string;
	/** The value beside the label, or the summary beside a block of text. */
	readonly value: string;
	readonly tooltip?: string;
	readonly lines?: readonly string[];
	/** An address the row opens. Only an https address is followed. */
	readonly link?: string;
	/** A command the row runs when it is chosen. */
	readonly command?: { readonly command: string; readonly arguments: readonly unknown[] };
}

/** Where the tool calls have got to. */
export type ToolCallState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly counts: readonly ToolCallCount[]; readonly truncated: boolean }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where the token usage has got to. */
export type UsageState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly report: TokenReport }
	| { readonly kind: 'failed'; readonly detail: string };

/** Everything the session detail has read so far. */
export interface SessionSnapshot {
	readonly session: Session;
	readonly info?: SessionInfo;
	readonly infoFailure?: string;
	readonly usage?: UsageState;
	readonly toolCalls?: ToolCallState;
}

/** The rows describing a session, as far as it has been read. */
export function sessionRows(snapshot: SessionSnapshot): DetailRow[] {
	const session = snapshot.session;

	const rows: DetailRow[] = [
		{ label: 'Agent', value: session.agent },
		{ label: 'Status', value: humanizeStatus(session.status) },
		{ label: 'Branch', value: session.branch ?? 'Not on a branch' },
		{ label: 'Worktree', value: session.worktreePath ?? 'None (imported)' },
		{ label: 'Session', value: session.id },
		{
			label: 'Turns',
			value: `${session.turns ?? 0}${session.pendingTurns ? ` (${session.pendingTurns} pending)` : ''}`,
		},
		{ label: 'Checkpoints', value: String(session.checkpoints ?? 0) },
	];

	if (session.model) {
		rows.push({ label: 'Model', value: session.model });
	}
	if (session.startedAt) {
		rows.push({ label: 'Started', value: session.startedAt.raw });
	}
	if (session.lastActive) {
		rows.push({ label: 'Last active', value: session.lastActive.raw });
	}
	if (session.lastPrompt) {
		rows.push({ label: 'Last prompt', value: '', lines: session.lastPrompt.split('\n') });
	}

	addInfoRows(rows, snapshot);
	addUsageRows(rows, snapshot);
	addTranscriptRows(rows, snapshot);
	return rows;
}

/** The rows only `session info` can fill in. */
function addInfoRows(rows: DetailRow[], snapshot: SessionSnapshot): void {
	if (snapshot.infoFailure) {
		rows.push({ label: 'Detail', value: 'Not available', tooltip: snapshot.infoFailure });
	}
	const info = snapshot.info;
	if (!info) {
		return;
	}

	if (info.endedAt) {
		rows.push({ label: 'Ended', value: info.endedAt.raw });
	}
	if (info.lastCheckpointId) {
		rows.push({
			label: 'Last checkpoint',
			value: info.lastCheckpointId,
			command: { command: 'entirely.explainCheckpoint', arguments: [info.lastCheckpointId] },
		});
	}
	if (info.filesTouched && info.filesTouched.length > 0) {
		rows.push({
			label: 'Files touched',
			value: pluralise(info.filesTouched.length, 'file'),
			lines: info.filesTouched,
		});
	}
}

/**
 * The token usage, from `session tokens`.
 *
 * The counts in `session info` are not used: they read zero when the
 * agent recorded nothing, and zero is a claim the CLI did not make.
 */
function addUsageRows(rows: DetailRow[], snapshot: SessionSnapshot): void {
	const usage = snapshot.usage;
	if (!usage) {
		return;
	}
	if (usage.kind === 'loading') {
		rows.push({ label: 'Tokens', value: 'Reading…' });
		return;
	}
	if (usage.kind === 'failed') {
		rows.push({ label: 'Tokens', value: 'Not available', tooltip: usage.detail });
		return;
	}

	const view = describeTokenReport(usage.report);
	if (!view.reported) {
		rows.push({
			label: 'Tokens',
			value: view.summary,
			tooltip: view.lines.map(line => line.value).join('\n') || undefined,
		});
		return;
	}
	rows.push({
		label: 'Tokens',
		value: view.summary,
		lines: view.lines.map(line => `${line.label}: ${line.value}`),
	});
}

/** The transcript link and the tool calls. The transcript itself never goes in a row. */
function addTranscriptRows(rows: DetailRow[], snapshot: SessionSnapshot): void {
	rows.push({
		label: 'Transcript',
		value: 'Open in editor',
		command: { command: 'entirely.openTranscript', arguments: [snapshot.session.id] },
	});

	const calls = snapshot.toolCalls;
	if (!calls) {
		return;
	}
	if (calls.kind === 'loading') {
		rows.push({ label: 'Tool calls', value: 'Reading…' });
	} else if (calls.kind === 'failed') {
		rows.push({ label: 'Tool calls', value: 'Not available', tooltip: calls.detail });
	} else {
		const total = calls.counts.reduce((sum, entry) => sum + entry.count, 0);
		rows.push({
			label: 'Tool calls',
			value: `${total}${calls.truncated ? ' (partial transcript)' : ''}`,
			lines: calls.counts.map(entry => `${entry.name} × ${entry.count}`),
		});
	}
}
