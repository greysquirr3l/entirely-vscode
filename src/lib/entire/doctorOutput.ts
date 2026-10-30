/** Which end of a long output is kept. A log keeps its newest lines (the last), a trace its first. */
export type KeepEnd = 'last' | 'first';

/** What was kept of an output, and what was left out. */
export interface BoundedOutput {
	readonly shown: string;
	readonly omittedBytes: number;
	/** Lines that are not in `shown`, wholly or in part. */
	readonly omittedLines: number;
	readonly totalLines: number;
	readonly shownLines: number;
	readonly totalBytes: number;
}

/** The UTF-8 size of a string, without a platform buffer. */
export function utf8Length(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
				continue;
			}
			bytes += 3;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/** The part of one line that fits in `maxBytes`, from the start or the end, never splitting a surrogate pair. */
function cutLine(line: string, maxBytes: number, keep: KeepEnd): string {
	if (keep === 'first') {
		let end = 0;
		let bytes = 0;
		while (end < line.length) {
			const step = isHighSurrogate(line.charCodeAt(end)) && end + 1 < line.length && isLowSurrogate(line.charCodeAt(end + 1)) ? 2 : 1;
			const size = utf8Length(line.slice(end, end + step));
			if (bytes + size > maxBytes) {
				break;
			}
			bytes += size;
			end += step;
		}
		return line.slice(0, end);
	}
	let start = line.length;
	let bytes = 0;
	while (start > 0) {
		const step = isLowSurrogate(line.charCodeAt(start - 1)) && start - 2 >= 0 && isHighSurrogate(line.charCodeAt(start - 2)) ? 2 : 1;
		const size = utf8Length(line.slice(start - step, start));
		if (bytes + size > maxBytes) {
			break;
		}
		bytes += size;
		start -= step;
	}
	return line.slice(start);
}

/**
 * Keeps at most `maxBytes` of an output, cut on a line boundary.
 *
 * A line that is longer than the whole allowance is cut inside the line, so
 * something is always shown. A pair of UTF-16 code units that make one
 * character is never split.
 */
export function boundOutput(text: string, maxBytes: number, keep: KeepEnd): BoundedOutput {
	const body = text.endsWith('\n') ? text.slice(0, -1) : text;
	const totalBytes = utf8Length(body);
	if (body.length === 0) {
		return { shown: '', omittedBytes: 0, omittedLines: 0, totalLines: 0, shownLines: 0, totalBytes: 0 };
	}
	const lines = body.split('\n');
	if (totalBytes <= maxBytes) {
		return { shown: body, omittedBytes: 0, omittedLines: 0, totalLines: lines.length, shownLines: lines.length, totalBytes };
	}

	const kept: string[] = [];
	let used = 0;
	const order = keep === 'last' ? [...lines].reverse() : lines;
	for (const line of order) {
		const size = utf8Length(line) + (kept.length > 0 ? 1 : 0);
		if (used + size > maxBytes) {
			break;
		}
		used += size;
		kept.push(line);
	}

	let shown: string;
	let shownLines = kept.length;
	if (kept.length === 0) {
		const partial = cutLine(order[0], Math.max(0, maxBytes), keep);
		shown = partial;
		shownLines = 0;
		used = utf8Length(partial);
	} else {
		shown = (keep === 'last' ? kept.reverse() : kept).join('\n');
	}

	return {
		shown,
		omittedBytes: totalBytes - used,
		omittedLines: lines.length - shownLines,
		totalLines: lines.length,
		shownLines,
		totalBytes,
	};
}

/** A size in words a person reads: bytes under a kilobyte, kilobytes under a megabyte, then megabytes. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The most the extension reads from one command, as said to the person. */
const READER_LIMIT = '16 MB';

/** The line at the top of a document whose text was cut, or undefined when nothing was left out. */
export function describeBound(bound: BoundedOutput, keep: KeepEnd, readerTruncated: boolean): string | undefined {
	const parts: string[] = [];
	if (bound.omittedBytes > 0) {
		const which = keep === 'last' ? 'last' : 'first';
		const count =
			bound.shownLines === 0
				? `Showing part of one very long line, the ${which} ${formatSize(bound.totalBytes - bound.omittedBytes)}`
				: `Showing the ${which} ${bound.shownLines} line${bound.shownLines === 1 ? '' : 's'} of ${bound.totalLines}`;
		parts.push(`${count}. ${formatSize(bound.omittedBytes)} left out. Use Save the whole output to write all of it to a file.`);
		if (keep === 'first') {
			parts.push("The start is kept on the assumption that the newest trace is printed first; the CLI's order was not checked.");
		}
	}
	if (readerTruncated) {
		parts.push(`The CLI printed more than the extension reads (${READER_LIMIT}), so even the saved output stops there.`);
	}
	return parts.length > 0 ? parts.join(' ') : undefined;
}

/** What kind of document is being put together. */
export type DepthDocumentKind = 'log' | 'trace' | 'dry-run' | 'migration';

const NOTES: Record<DepthDocumentKind, string> = {
	log: 'The CLI log can name files, branches and sessions. Entirely did not copy it anywhere; to follow it live, run `entire doctor logs --follow` in a terminal.',
	trace: 'Hook traces can name files and branches. Entirely did not copy them anywhere. Only hooks of 1.5 s or longer are traced unless the CLI log level was raised.',
	'dry-run': 'Dry run: nothing was written. This is what the CLI says it would do.',
	migration: 'This is what the CLI printed while it created the refs. Entirely did not copy it anywhere.',
};

/** The document text: a note, the banner when the output was cut, and the output. */
export function renderDepthDocument(kind: DepthDocumentKind, shown: string, banner: string | undefined): string {
	return [NOTES[kind], ...(banner ? ['', banner] : []), '', shown, ''].join('\n');
}
