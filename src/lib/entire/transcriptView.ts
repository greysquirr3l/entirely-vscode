import { humanizeStatus } from './text';
import type { SessionInfo } from './sessionInfo';
import { countToolCalls, type Transcript } from './transcript';

/** The longest message the document reproduces in full. */
export const MAX_MESSAGE_CHARACTERS = 20_000;

/**
 * The most the document holds before the rest is left out.
 *
 * The editor slows down on documents much past this, and a transcript of
 * tens of megabytes would otherwise be rendered in full.
 */
export const MAX_DOCUMENT_CHARACTERS = 4_000_000;

/** The most raw text shown when the transcript is in a format this reader does not know. */
export const MAX_RAW_CHARACTERS = 200_000;

/** What the document needs to say about how the transcript was read. */
export interface TranscriptSource {
	readonly transcript: Transcript;
	/** The raw text, kept for a format the reader does not recognise. */
	readonly raw: string;
	/** How many bytes the CLI sent. */
	readonly receivedBytes: number;
	/** Whether the extension kept less than the CLI sent. */
	readonly truncated: boolean;
}

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clip(text: string): string {
	return text.length <= MAX_MESSAGE_CHARACTERS
		? text
		: `${text.slice(0, MAX_MESSAGE_CHARACTERS)}\n[${text.length - MAX_MESSAGE_CHARACTERS} more characters not shown]`;
}

/** The attribution lines: which agent ran, on what, and when. */
function attribution(info: SessionInfo): string[] {
	const lines = [
		`- Agent: ${info.agent}`,
		`- Status: ${humanizeStatus(info.status)}`,
		`- Branch: ${info.branch ?? 'not on a branch'}`,
		`- Worktree: ${info.worktreePath}`,
		`- Session: ${info.id}`,
	];
	if (info.model) {
		lines.push(`- Model: ${info.model}`);
	}
	if (info.startedAt) {
		lines.push(`- Started: ${info.startedAt.raw}`);
	}
	if (info.endedAt) {
		lines.push(`- Ended: ${info.endedAt.raw}`);
	}
	if (info.lastCheckpointId) {
		lines.push(`- Last checkpoint: ${info.lastCheckpointId}`);
	}
	if (info.tokens?.total !== undefined) {
		lines.push(`- Tokens: ${info.tokens.total}`);
	}
	return lines;
}

/**
 * Renders a session as a document: its attribution, its tool calls and the
 * conversation.
 *
 * The result is opened in a read-only editor the user asked for. Nothing
 * here is sent to the output channel.
 */
export function renderTranscript(info: SessionInfo, source: TranscriptSource): string {
	const { transcript } = source;
	const out: string[] = [`# Session ${info.id}`, '', '## Attribution', '', ...attribution(info)];

	if (source.truncated) {
		out.push(
			'',
			`> Only the first ${formatMegabytes(source.receivedBytes)} of this transcript is shown here; the CLI sent more than the extension reads.`,
		);
	}

	if (transcript.items.length === 0) {
		out.push(
			'',
			'## Transcript',
			'',
			'The extension does not recognise this agent\'s transcript format, so the raw text follows.',
			'',
			source.raw.length > MAX_RAW_CHARACTERS
				? `${source.raw.slice(0, MAX_RAW_CHARACTERS)}\n[${source.raw.length - MAX_RAW_CHARACTERS} more characters not shown]`
				: source.raw,
		);
		return out.join('\n');
	}

	const counts = countToolCalls(transcript.items);
	out.push('', '## Tool calls', '');
	if (counts.length === 0) {
		out.push('No tool calls.');
	} else {
		for (const { name, count } of counts) {
			out.push(`- ${name}: ${count}`);
		}
	}

	out.push('', '## Transcript');
	let size = out.reduce((sum, line) => sum + line.length + 1, 0);
	for (let index = 0; index < transcript.items.length; index++) {
		if (size > MAX_DOCUMENT_CHARACTERS) {
			out.push('', `[${transcript.items.length - index} more entries not shown]`);
			break;
		}

		const item = transcript.items[index];
		const block =
			item.kind === 'message'
				? ['', `### ${item.role === 'user' ? 'User' : 'Assistant'}`, '', clip(item.text)]
				: ['', `- Tool: ${item.name}${item.hint ? ` — ${item.hint}` : ''}`];
		out.push(...block);
		size += block.reduce((sum, line) => sum + line.length + 1, 0);
	}

	return out.join('\n');
}
