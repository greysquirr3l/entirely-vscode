import type { BlameAnswer } from './blame';
import {
	lineState,
	UNATTRIBUTED_LABEL,
	UNSYNCED_LABEL,
	type LineState,
} from './lineState';
import { truncatePrompt } from './text';

/** What to draw beside one line of a blamed file. */
export interface BlameMark {
	/** Zero-based line in the editor. */
	readonly line: number;
	/** One-based line, as the CLI numbers it. */
	readonly lineNumber: number;
	readonly state: LineState;
	/** Short text drawn at the end of the line. */
	readonly label: string;
	/** Plain-text facts for the hover, one per entry. */
	readonly facts: readonly string[];
}

/** The outcome of planning marks for a file. */
export type BlamePlan =
	| { readonly kind: 'marks'; readonly marks: readonly BlameMark[] }
	/** The file is longer than the limit, so nothing is drawn in the editor. */
	| { readonly kind: 'too-long'; readonly lines: number; readonly limit: number };

/**
 * Plans the marks for a blamed file.
 *
 * Drawing is the cost on a large file, not the CLI, so a file over
 * `limit` lines gets no marks. The panel still shows its answer.
 */
export function planBlameMarks(answer: BlameAnswer, limit: number): BlamePlan {
	if (answer.lines.length > limit) {
		return { kind: 'too-long', lines: answer.lines.length, limit };
	}

	const marks: BlameMark[] = [];
	for (const line of answer.lines) {
		if (line.lineNumber < 1) {
			continue;
		}

		const state = lineState(line);
		const facts: string[] = [
			state === 'unattributed'
				? UNATTRIBUTED_LABEL
				: state === 'unsynced'
					? UNSYNCED_LABEL
					: line.attribution === 'commit'
						? 'Committed (no checkpoint recorded)'
						: 'Attributed to a recorded change',
		];
		if (line.author) {
			facts.push(`Author: ${line.author}`);
		}
		if (line.shortCommitSha) {
			facts.push(`Commit: ${line.shortCommitSha}`);
		}
		if (line.checkpointId) {
			facts.push(`Checkpoint: ${line.checkpointId}`);
		}
		if (line.agent) {
			facts.push(`Agent: ${line.agent}`);
		}
		if (line.prompt) {
			facts.push(`Asked: ${truncatePrompt(line.prompt, 160)}`);
		}

		marks.push({
			line: line.lineNumber - 1,
			lineNumber: line.lineNumber,
			state,
			label: labelFor(state, line.agent, line.shortCommitSha),
			facts,
		});
	}

	return { kind: 'marks', marks };
}

function labelFor(state: LineState, agent?: string, sha?: string): string {
	switch (state) {
		case 'unattributed':
			return 'not attributed';
		case 'unsynced':
			return 'not synced yet';
		case 'attributed':
			return [agent, sha].filter((part): part is string => !!part).join(' · ') || 'Recorded change';
	}
}
