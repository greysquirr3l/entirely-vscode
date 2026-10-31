import { isCheckpointId } from './checkpoint';

/** The command a checkpoint id in a generated document opens. It is the drill-down the history view uses. */
export const OPEN_CHECKPOINT_COMMAND = 'entirely.explainCheckpoint';

/** The Markdown link that opens a checkpoint. */
export function checkpointLink(id: string): string {
	return `[${id}](command:${OPEN_CHECKPOINT_COMMAND}?${encodeURIComponent(JSON.stringify([id]))})`;
}

/** A checkpoint link found in a document, with the span of its target. */
export interface CheckpointLinkSpan {
	readonly id: string;
	/** Offset of the first character of the `command:` target. */
	readonly start: number;
	/** Offset just past the last character of the target. */
	readonly end: number;
}

const LINK = /\]\((command:entirely\.explainCheckpoint\?[^)\s]+)\)/g;

/**
 * The checkpoint links in a document.
 *
 * Only this one command with one valid checkpoint id is recognised. The text
 * of a generated document comes from the CLI, so a link that names another
 * command, or an id the CLI could not have issued, is left as text.
 */
export function findCheckpointLinks(text: string): readonly CheckpointLinkSpan[] {
	const spans: CheckpointLinkSpan[] = [];
	for (const match of text.matchAll(LINK)) {
		const target = match[1];
		const encoded = target.slice(target.indexOf('?') + 1);
		let parsed: unknown;
		try {
			parsed = JSON.parse(decodeURIComponent(encoded));
		} catch {
			continue;
		}
		if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'string' || !isCheckpointId(parsed[0])) {
			continue;
		}
		const start = (match.index ?? 0) + 2;
		spans.push({ id: parsed[0], start, end: start + target.length });
	}
	return spans;
}
