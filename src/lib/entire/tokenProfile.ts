import { decodeRecord, fields, optionalString, type DecodeResult, type Fields } from './decode';
import { isCheckpointId } from './checkpoint';
import { markdownText } from './text';
import { checkpointLink } from './generatedLinks';
import { NOT_REPORTED, decodeTokenUsage, type TokenUsage } from './tokenUsage';
import type { FlagWant } from './controlPlaneFlags';

/** One repeated pattern the CLI found across the analysed checkpoints. */
export interface ProfileSignal {
	readonly id: string;
	readonly label: string;
	readonly count?: number;
	readonly percent?: number;
	readonly checkpointIds: readonly string[];
}

export interface ProfileRecommendation {
	readonly id?: string;
	readonly severity?: string;
	/** The CLI's words, unchanged. */
	readonly message: string;
	readonly signals: readonly string[];
}

/**
 * What `entire tokens profile --json` reported.
 *
 * Every number is optional: one the CLI left out is undefined, and is shown
 * as not reported, never as zero.
 */
export interface TokenProfile {
	readonly source?: string;
	readonly usageScope?: string;
	readonly checkpointsAvailable?: number;
	readonly checkpointsAnalyzed?: number;
	readonly checkpointsWithTokenData?: number;
	readonly missingTokenData?: number;
	readonly usage?: TokenUsage;
	readonly signals: readonly ProfileSignal[];
	readonly recommendations: readonly ProfileRecommendation[];
	/** The CLI's own statements of what the profile cannot tell, verbatim. */
	readonly limitations: readonly string[];
}

/** The flags of `entire tokens profile`. */
export const PROFILE_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	all: { name: /^--all$/, description: /\ball\b.*\bcheckpoints\b/i },
	limit: { name: /limit|max/i, description: /\bmaximum\b.*\bcheckpoints\b/i },
} as const satisfies Record<string, FlagWant>;

export type ProfileFlags = Readonly<Partial<Record<keyof typeof PROFILE_WANTS, string>>>;

/** How much history the profile covers. */
export type ProfileScope =
	| { readonly kind: 'default' }
	| { readonly kind: 'all' }
	| { readonly kind: 'limit'; readonly count: number };

/** The arguments of the profile, or undefined when the help does not describe the flag the scope needs. */
export function profileArguments(flags: ProfileFlags, scope: ProfileScope): readonly string[] | undefined {
	if (!flags.json) {
		return undefined;
	}
	const args = ['tokens', 'profile', flags.json];
	if (scope.kind === 'all') {
		if (!flags.all) {
			return undefined;
		}
		args.push(flags.all);
	} else if (scope.kind === 'limit') {
		if (!flags.limit || !Number.isInteger(scope.count) || scope.count < 1) {
			return undefined;
		}
		args.push(`${flags.limit}=${scope.count}`);
	}
	return args;
}

/** The scope in words, for the document's heading. */
export function describeProfileScope(scope: ProfileScope): string {
	switch (scope.kind) {
		case 'all':
			return 'all committed checkpoints';
		case 'limit':
			return `the latest ${scope.count} committed checkpoints`;
		case 'default':
			return "the CLI's default number of committed checkpoints";
	}
}

/** A number the CLI sent. A value of another kind counts as not sent. */
function number(read: Fields, key: string): number | undefined {
	const value = read.record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): readonly string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function decodeSignal(value: unknown, index: number): ProfileSignal | undefined {
	const record = decodeRecord(value, `signals[${index}]`);
	if (!record.ok) {
		return undefined;
	}
	const read = fields(record.value, `signals[${index}]`);
	const id = optionalString(read, 'id');
	const label = optionalString(read, 'label');
	const name = (label.ok ? label.value : undefined) ?? (id.ok ? id.value : undefined);
	if (name === undefined) {
		return undefined;
	}
	return {
		id: (id.ok ? id.value : undefined) ?? name,
		label: name,
		count: number(read, 'count'),
		percent: number(read, 'percent'),
		checkpointIds: strings(record.value.checkpoint_ids),
	};
}

function decodeRecommendation(value: unknown, index: number): ProfileRecommendation | undefined {
	const record = decodeRecord(value, `recommendations[${index}]`);
	if (!record.ok) {
		return undefined;
	}
	const read = fields(record.value, `recommendations[${index}]`);
	const message = optionalString(read, 'message');
	if (!message.ok || message.value === undefined || message.value.trim().length === 0) {
		return undefined;
	}
	const id = optionalString(read, 'id');
	const severity = optionalString(read, 'severity');
	return {
		id: id.ok ? id.value : undefined,
		severity: severity.ok ? severity.value : undefined,
		message: message.value,
		signals: strings(record.value.signals),
	};
}

/**
 * Reads the profile.
 *
 * Reading is tolerant: an entry that cannot be read is left out of its list
 * rather than failing the whole profile, and a count that is not a number is
 * not reported. Only a payload that is not an object is refused.
 */
export function decodeTokenProfile(value: unknown): DecodeResult<TokenProfile> {
	const record = decodeRecord(value, 'token profile');
	if (!record.ok) {
		return record;
	}
	const read = fields(record.value, 'token profile');
	const source = optionalString(read, 'source');
	const scope = optionalString(read, 'usage_scope');
	const list = (key: string): unknown[] => {
		const entries = record.value[key];
		return Array.isArray(entries) ? entries : [];
	};
	return {
		ok: true,
		value: {
			source: source.ok ? source.value : undefined,
			usageScope: scope.ok ? scope.value : undefined,
			checkpointsAvailable: number(read, 'checkpoints_available'),
			checkpointsAnalyzed: number(read, 'checkpoints_analyzed'),
			checkpointsWithTokenData: number(read, 'checkpoints_with_token_data'),
			missingTokenData: number(read, 'missing_token_data'),
			usage: decodeTokenUsage(record.value.tokens),
			signals: list('signals').flatMap((entry, index) => decodeSignal(entry, index) ?? []),
			recommendations: list('recommendations').flatMap((entry, index) => decodeRecommendation(entry, index) ?? []),
			limitations: strings(record.value.limitations),
		},
	};
}

/** Whether the CLI had no checkpoint history to profile. */
export function isEmptyProfile(profile: TokenProfile): boolean {
	if (profile.checkpointsAnalyzed !== undefined) {
		return profile.checkpointsAnalyzed === 0;
	}
	return profile.usage === undefined && profile.signals.length === 0;
}

/** The sentence shown where there is nothing to profile. */
export const EMPTY_PROFILE_TEXT =
	'There is no checkpoint history to profile. The Entire CLI analysed no committed checkpoints in this repository. Checkpoints appear after an agent session is recorded and committed.';

function formatCount(value: number | undefined): string {
	return value === undefined ? NOT_REPORTED : value.toLocaleString('en-US');
}

/** One line of a signal heading: how many checkpoints, and what share of those analysed. */
function signalSummary(signal: ProfileSignal, analyzed: number | undefined): string {
	const parts: string[] = [];
	if (signal.count !== undefined) {
		parts.push(analyzed !== undefined ? `${signal.count} of ${analyzed} checkpoints` : `${signal.count} checkpoints`);
	}
	if (signal.percent !== undefined) {
		parts.push(`${signal.percent}%`);
	}
	return parts.join(', ');
}

/**
 * The profile as a Markdown document.
 *
 * The totals are the CLI's checkpoint-observed counts. They are tokens, not
 * money, and are not turned into a cost. Signals, recommendations and
 * limitations keep the CLI's words. A checkpoint id that the CLI could have
 * issued is a link that opens the checkpoint; anything else stays text.
 */
export function describeProfile(profile: TokenProfile, scopeNote: string): string {
	const out: string[] = ['# Token profile', ''];
	out.push(`Read from the Entire CLI over ${scopeNote}. Only committed checkpoint metadata was read; no transcript was opened and no model was called.`, '');

	out.push('## Checkpoints', '');
	out.push(`- Available: ${formatCount(profile.checkpointsAvailable)}`);
	out.push(`- Analysed: ${formatCount(profile.checkpointsAnalyzed)}`);
	out.push(`- With token data: ${formatCount(profile.checkpointsWithTokenData)}`);
	out.push(`- Without token data: ${formatCount(profile.missingTokenData)}`, '');

	const usage = profile.usage;
	out.push('## Token usage', '');
	if (profile.usageScope) {
		out.push(`Scope reported by the CLI: ${markdownText(profile.usageScope)}.`, '');
	}
	out.push('| Count | Tokens |', '| --- | ---: |');
	out.push(`| Total | ${formatCount(usage?.total)} |`);
	out.push(`| Input | ${formatCount(usage?.input)} |`);
	out.push(`| Output | ${formatCount(usage?.output)} |`);
	out.push(`| Cache read | ${formatCount(usage?.cacheRead)} |`);
	out.push(`| Cache write | ${formatCount(usage?.cacheWrite)} |`);
	out.push(`| API calls | ${formatCount(usage?.apiCalls)} |`);
	out.push(`| Subagents | ${formatCount(usage?.subagentTokens)} |`, '');

	out.push('## Repeated signals', '');
	if (profile.signals.length === 0) {
		out.push('The CLI reported no repeated signals.', '');
	}
	for (const signal of profile.signals) {
		const summary = signalSummary(signal, profile.checkpointsAnalyzed);
		out.push(`### ${markdownText(signal.label)}${summary ? ` (${summary})` : ''}`, '');
		if (signal.checkpointIds.length === 0) {
			out.push('No checkpoint ids were given.', '');
			continue;
		}
		for (const id of signal.checkpointIds) {
			out.push(`- ${isCheckpointId(id) ? checkpointLink(id) : markdownText(id)}`);
		}
		out.push('');
	}

	out.push('## Recommendations', '');
	if (profile.recommendations.length === 0) {
		out.push('The CLI made no recommendations.', '');
	}
	for (const recommendation of profile.recommendations) {
		const severity = recommendation.severity ? `**${markdownText(recommendation.severity)}**: ` : '';
		out.push(`- ${severity}${markdownText(recommendation.message)}`);
	}
	if (profile.recommendations.length > 0) {
		out.push('');
	}

	out.push('## Limitations', '');
	if (profile.limitations.length === 0) {
		out.push('The CLI stated no limitations.', '');
	}
	for (const limitation of profile.limitations) {
		out.push(`- ${markdownText(limitation)}`);
	}
	return `${out.join('\n').trimEnd()}\n`;
}
