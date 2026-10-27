import {
	decodeArray,
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalString,
	optionalStringArray,
	requireString,
	type DecodeResult,
} from './decode';

/** What a line can be attributed to. */
export type LineAttribution = 'commit' | 'checkpoint' | 'uncommitted';

/** One checkpoint that could own a line. */
export interface WhyCandidate {
	readonly checkpointId: string;
	readonly sessionId?: string;
	readonly agent?: string;
	readonly prompt?: string;
	readonly filesTouched?: readonly string[];
}

/** The explanation of one line. */
export interface WhyLine {
	readonly lineNumber: number;
	readonly attribution: LineAttribution;
	readonly commitSha?: string;
	readonly shortCommitSha?: string;
	readonly author?: string;
	readonly authorTime?: string;
	readonly content?: string;
	/** The checkpoint that owns the line, when a checkpoint does. */
	readonly checkpointId?: string;
	/** The session the checkpoint belongs to. */
	readonly sessionId?: string;
	/** The agent that made the change. */
	readonly agent?: string;
	/** What the agent was asked to do. */
	readonly prompt?: string;
	/**
	 * Whether the checkpoint's body is missing locally.
	 *
	 * This is the normal state when the CLI has the commit but not the
	 * checkpoint, and it is not a failure.
	 */
	readonly metadataMissing?: boolean;
	/** Why the body is missing. */
	readonly metadataMissingReason?: string;
	/** The checkpoints that could own the line, when more than one could. */
	readonly candidates: readonly WhyCandidate[];
}

/** How a file's lines are distributed between the three kinds. */
export interface WhySummary {
	readonly totalLines: number;
	readonly checkpointLines: number;
	readonly commitLines: number;
	readonly uncommittedLines: number;
	readonly checkpointPercentage: number;
	readonly commitPercentage: number;
}

/** The answer to a question about a line or a file. */
export type WhyAnswer =
	| {
			readonly kind: 'line';
			readonly file: string;
			readonly line: WhyLine;
	  }
	| {
			readonly kind: 'file';
			readonly file: string;
			readonly lines: readonly WhyLine[];
			readonly summary: WhySummary;
	  };

/**
 * Reads the attribution of a line.
 *
 * The CLI names the three things a line can belong to. Anything else is
 * read as unattributed rather than guessed at.
 */
function attributionOf(value: string | undefined): LineAttribution {
	switch (value) {
		case 'commit':
		case 'checkpoint':
		case 'uncommitted':
			return value;
		default:
			return 'uncommitted';
	}
}

/** Decodes one candidate. */
function decodeCandidate(value: unknown, path: string): DecodeResult<WhyCandidate> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const checkpointId = requireString(read, 'checkpoint_id');
	if (!checkpointId.ok) {
		return checkpointId;
	}

	const sessionId = optionalString(read, 'session_id');
	if (!sessionId.ok) {
		return sessionId;
	}

	const agent = optionalString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const prompt = optionalString(read, 'prompt');
	if (!prompt.ok) {
		return prompt;
	}

	const filesTouched = optionalStringArray(read, 'files_touched');
	if (!filesTouched.ok) {
		return filesTouched;
	}

	return {
		ok: true,
		value: {
			checkpointId: checkpointId.value,
			sessionId: sessionId.value,
			agent: agent.value,
			prompt: prompt.value,
			filesTouched: filesTouched.value,
		},
	};
}

/** Decodes one line's explanation. */
function decodeLine(value: unknown, path: string): DecodeResult<WhyLine> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const lineNumber = optionalNumber(read, 'line_number');
	if (!lineNumber.ok) {
		return lineNumber;
	}

	const status = optionalString(read, 'status');
	if (!status.ok) {
		return status;
	}

	const commitSha = optionalString(read, 'commit_sha');
	if (!commitSha.ok) {
		return commitSha;
	}

	const shortCommitSha = optionalString(read, 'short_commit_sha');
	if (!shortCommitSha.ok) {
		return shortCommitSha;
	}

	const author = optionalString(read, 'author');
	if (!author.ok) {
		return author;
	}

	const authorTime = optionalString(read, 'author_time');
	if (!authorTime.ok) {
		return authorTime;
	}

	const content = optionalString(read, 'content');
	if (!content.ok) {
		return content;
	}

	const checkpointId = optionalString(read, 'checkpoint_id');
	if (!checkpointId.ok) {
		return checkpointId;
	}

	const sessionId = optionalString(read, 'session_id');
	if (!sessionId.ok) {
		return sessionId;
	}

	const agent = optionalString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const prompt = optionalString(read, 'prompt');
	if (!prompt.ok) {
		return prompt;
	}

	const metadataMissing = optionalBoolean(read, 'metadata_missing');
	const metadataMissingReason = optionalString(read, 'metadata_missing_reason');
	if (!metadataMissingReason.ok) {
		return metadataMissingReason;
	}

	let candidates: readonly WhyCandidate[] = [];
	if (read.record['candidates'] !== undefined) {
		const decoded = decodeArray(read.record['candidates'], `${path}.candidates`);
		if (!decoded.ok) {
			return decoded;
		}

		const collected: WhyCandidate[] = [];
		for (const [index, entry] of decoded.value.entries()) {
			const candidate = decodeCandidate(entry, `${path}.candidates[${index}]`);
			if (!candidate.ok) {
				return candidate;
			}
			collected.push(candidate.value);
		}
		candidates = collected;
	}

	return {
		ok: true,
		value: {
			lineNumber: lineNumber.value ?? 0,
			attribution: attributionOf(status.value),
			commitSha: commitSha.value,
			shortCommitSha: shortCommitSha.value,
			author: author.value,
			authorTime: authorTime.value,
			content: content.value,
			checkpointId: checkpointId.value,
			sessionId: sessionId.value,
			agent: agent.value,
			prompt: prompt.value,
			metadataMissing,
			metadataMissingReason: metadataMissingReason.value,
			candidates,
		},
	};
}

/** Decodes the distribution of a whole file. */
function decodeSummary(value: unknown, path: string): DecodeResult<WhySummary> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const totalLines = optionalNumber(read, 'total_lines');
	if (!totalLines.ok) {
		return totalLines;
	}

	const checkpointLines = optionalNumber(read, 'checkpoint_lines');
	if (!checkpointLines.ok) {
		return checkpointLines;
	}

	const commitLines = optionalNumber(read, 'commit_lines');
	if (!commitLines.ok) {
		return commitLines;
	}

	const uncommittedLines = optionalNumber(read, 'uncommitted_lines');
	if (!uncommittedLines.ok) {
		return uncommittedLines;
	}

	const checkpointPercentage = optionalNumber(read, 'checkpoint_percentage');
	if (!checkpointPercentage.ok) {
		return checkpointPercentage;
	}

	const commitPercentage = optionalNumber(read, 'commit_percentage');
	if (!commitPercentage.ok) {
		return commitPercentage;
	}

	return {
		ok: true,
		value: {
			totalLines: totalLines.value ?? 0,
			checkpointLines: checkpointLines.value ?? 0,
			commitLines: commitLines.value ?? 0,
			uncommittedLines: uncommittedLines.value ?? 0,
			checkpointPercentage: checkpointPercentage.value ?? 0,
			commitPercentage: commitPercentage.value ?? 0,
		},
	};
}

/**
 * Decodes the CLI's answer about a line or a file.
 *
 * The CLI answers in one of two shapes. A question about a single line
 * gives one line; a question about a whole file gives every line and a
 * summary of how they are distributed. Both are decoded here, so the
 * caller never has to know which one it got.
 */
export function decodeWhyAnswer(value: unknown): DecodeResult<WhyAnswer> {
	const record = decodeRecord(value, 'why');
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, 'why');

	const file = requireString(read, 'file');
	if (!file.ok) {
		return file;
	}

	if (read.record['line'] !== undefined) {
		const line = decodeLine(read.record['line'], 'why.line');
		if (!line.ok) {
			return line;
		}

		return { ok: true, value: { kind: 'line', file: file.value, line: line.value } };
	}

	const lines = decodeArray(read.record['lines'] ?? [], 'why.lines');
	if (!lines.ok) {
		return lines;
	}

	const decoded: WhyLine[] = [];
	for (const [index, entry] of lines.value.entries()) {
		const line = decodeLine(entry, `why.lines[${index}]`);
		if (!line.ok) {
			return line;
		}
		decoded.push(line.value);
	}

	let summary: WhySummary = {
		totalLines: decoded.length,
		checkpointLines: 0,
		commitLines: 0,
		uncommittedLines: 0,
		checkpointPercentage: 0,
		commitPercentage: 0,
	};

	if (read.record['summary'] !== undefined) {
		const decodedSummary = decodeSummary(read.record['summary'], 'why.summary');
		if (!decodedSummary.ok) {
			return decodedSummary;
		}
		summary = decodedSummary.value;
	}

	return { ok: true, value: { kind: 'file', file: file.value, lines: decoded, summary } };
}

/**
 * Whether a line was left by an agent.
 *
 * A line the CLI cannot account for is reported as such, rather than
 * guessed at.
 */
export function isAttributed(line: WhyLine): boolean {
	return line.attribution === 'commit' || line.attribution === 'checkpoint';
}
