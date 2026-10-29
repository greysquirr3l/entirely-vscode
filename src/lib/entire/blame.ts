import type { DecodeResult } from './decode';
import { fileArguments } from './operand';
import { decodeWhyAnswer, type WhyAnswer, type WhyLine } from './why';

/** The answer to a question about a whole file. */
export type BlameAnswer = Extract<WhyAnswer, { kind: 'file' }>;

/**
 * The arguments for `entire blame` on one file.
 *
 * The file goes after the end-of-options separator, so the CLI cannot
 * read it as a flag or as `<file>:<line>`.
 */
export function blameArguments(file: string): readonly string[] {
	return fileArguments(['blame'], file, undefined, ['--json']);
}

/**
 * Decodes `entire blame --json`.
 *
 * The CLI gives blame and why the same line payload, so the answer is
 * decoded by the why decoder and the lines are the why lines. Blame is
 * asked about a whole file, so an answer about one line is refused.
 */
export function decodeBlameAnswer(value: unknown): DecodeResult<BlameAnswer> {
	const decoded = decodeWhyAnswer(value);
	if (!decoded.ok) {
		return decoded;
	}
	if (decoded.value.kind !== 'file') {
		return {
			ok: false,
			issue: {
				kind: 'wrong-type',
				path: 'blame',
				detail: 'expected the lines of a file, got a single line',
			},
		};
	}
	return { ok: true, value: decoded.value };
}

/**
 * The single-line answer for one line of a blamed file.
 *
 * It has the same shape as the answer `why` gives for that line, so it
 * renders through the same code.
 */
export function lineAnswerFrom(answer: BlameAnswer, lineNumber: number): WhyAnswer | undefined {
	const line: WhyLine | undefined = answer.lines.find(entry => entry.lineNumber === lineNumber);
	if (!line) {
		return undefined;
	}
	return { kind: 'line', file: answer.file, line };
}
