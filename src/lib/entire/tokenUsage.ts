import {
	decodeArray,
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalRaw,
	optionalString,
	requireString,
	type DecodeResult,
} from './decode';

/**
 * The token counts the CLI reported. Every count is optional: a count the
 * CLI left out is undefined, and is never read as zero.
 */
export interface TokenUsage {
	readonly total?: number;
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly apiCalls?: number;
	readonly subagentTokens?: number;
	/** Whether the subagent figure covers every subagent. */
	readonly subagentTokensComplete?: boolean;
}

/**
 * What `entire session tokens --json` or `entire checkpoint tokens --json`
 * reported about one session or checkpoint.
 *
 * `usage` is undefined when the CLI sent no `tokens` block, which is how it
 * says it has no usage recorded. Models are opaque strings, kept as the CLI
 * wrote them.
 */
export interface TokenReport {
	readonly id: string;
	readonly agent?: string;
	readonly model?: string;
	readonly models: readonly string[];
	readonly usage?: TokenUsage;
	/** The CLI's own statements of what it could not report. */
	readonly limitations: readonly string[];
}

/** Reads the `tokens` block. A count that is not a number counts as not reported. */
function decodeUsage(value: unknown): TokenUsage | undefined {
	const record = decodeRecord(value, 'tokens');
	if (!record.ok) {
		return undefined;
	}

	const read = fields(record.value, 'tokens');
	const count = (...keys: string[]): number | undefined => {
		for (const key of keys) {
			const result = optionalNumber(read, key);
			if (result.ok && result.value !== undefined) {
				return result.value;
			}
		}
		return undefined;
	};

	const usage: TokenUsage = {
		total: count('total'),
		input: count('input'),
		output: count('output'),
		cacheRead: count('cache_read'),
		cacheWrite: count('cache_write'),
		apiCalls: count('api_calls', 'api_call_count'),
		subagentTokens: count('subagent_tokens'),
		subagentTokensComplete: optionalBoolean(read, 'subagent_tokens_complete'),
	};

	// A block with nothing readable in it reports nothing.
	return Object.values(usage).every(entry => entry === undefined) ? undefined : usage;
}

function decodeStringList(value: unknown): readonly string[] {
	const array = decodeArray(value ?? [], 'list');
	return array.ok ? array.value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Decodes the report of a tokens command.
 *
 * `idKey` is the field that names the subject: `session_id` for a session,
 * `checkpoint_id` for a checkpoint.
 */
export function decodeTokenReport(
	value: unknown,
	idKey: 'session_id' | 'checkpoint_id',
): DecodeResult<TokenReport> {
	const record = decodeRecord(value, 'tokens report');
	if (!record.ok) {
		return record;
	}
	const read = fields(record.value, 'tokens report');

	const id = requireString(read, idKey);
	if (!id.ok) {
		return id;
	}
	const agent = optionalString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}
	const model = optionalString(read, 'model');
	if (!model.ok) {
		return model;
	}

	const models = decodeStringList(optionalRaw(read, 'models'));

	return {
		ok: true,
		value: {
			id: id.value,
			agent: agent.value,
			model: model.value,
			models: models.length > 0 ? models : model.value ? [model.value] : [],
			usage: decodeUsage(optionalRaw(read, 'tokens')),
			limitations: decodeStringList(optionalRaw(read, 'limitations')),
		},
	};
}

/** What is shown where a count is missing. It is words, never a zero. */
export const NOT_REPORTED = 'Not reported';

/** One line of a usage breakdown. */
export interface UsageLine {
	readonly label: string;
	readonly value: string;
}

/** A usage summary ready to show. */
export interface UsageView {
	/** One line for a row's description. */
	readonly summary: string;
	readonly lines: readonly UsageLine[];
	/** Whether the CLI reported any count at all. */
	readonly reported: boolean;
}

function count(value: number | undefined): string {
	return value === undefined ? NOT_REPORTED : value.toLocaleString('en-US');
}

/**
 * Lays out a report for display.
 *
 * Every count the CLI left out reads "Not reported". When the CLI sent no
 * usage at all, the whole summary says so, and the CLI's own limitations
 * are carried along so the user can see why.
 */
export function describeTokenReport(report: TokenReport): UsageView {
	const usage = report.usage;
	if (!usage) {
		return {
			summary: NOT_REPORTED,
			reported: false,
			lines: report.limitations.map(text => ({ label: 'Note', value: text })),
		};
	}

	const lines: UsageLine[] = [
		{ label: 'Total', value: count(usage.total) },
		{ label: 'Input', value: count(usage.input) },
		{ label: 'Output', value: count(usage.output) },
		{ label: 'Cache read', value: count(usage.cacheRead) },
		{ label: 'Cache write', value: count(usage.cacheWrite) },
		{ label: 'API calls', value: count(usage.apiCalls) },
	];
	if (usage.subagentTokens !== undefined) {
		const partial = usage.subagentTokensComplete === false ? ' (incomplete)' : '';
		lines.push({ label: 'Subagents', value: `${count(usage.subagentTokens)}${partial}` });
	}
	if (report.models.length > 0) {
		lines.push({ label: 'Models', value: report.models.join(', ') });
	}

	const summary =
		usage.total !== undefined
			? `${count(usage.total)} tokens`
			: `Total ${NOT_REPORTED.toLowerCase()}`;

	return { summary, lines, reported: true };
}
