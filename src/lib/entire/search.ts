import {
	decodeArray,
	decodeRecord,
	fields,
	optionalNumber,
	optionalString,
	optionalTimestamp,
	requireString,
	type DecodeResult,
} from './decode';
import { isCheckpointId } from './checkpoint';
import { END_OF_OPTIONS } from './operand';
import type { Checkpoint } from './types';

/** A flag and the text the CLI gave for it. */
export interface HelpFlag {
	readonly name: string;
	readonly description: string;
}

/** The longest query the extension will hand to the CLI. */
export const MAX_QUERY_CHARACTERS = 500;

/** How many results one search asks for. */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * Reads the flag table out of the CLI's help text.
 *
 * The table rows are the lines that start with a flag, then an optional
 * value word, then a gap and the description. Prose that mentions a flag
 * mid-sentence is not a row, so it cannot stand in for the flag's own
 * description.
 */
export function readFlagTable(help: string): readonly HelpFlag[] {
	const rows: HelpFlag[] = [];
	const seen = new Set<string>();
	const row = /^\s+(?:-[A-Za-z0-9],\s+)?(--[A-Za-z0-9][A-Za-z0-9-]*)(?:\s+[A-Za-z]+)?\s{2,}(\S.*)$/;

	for (const line of help.split('\n')) {
		const match = row.exec(line);
		if (!match || seen.has(match[1])) {
			continue;
		}
		seen.add(match[1]);
		rows.push({ name: match[1], description: match[2].trim() });
	}
	return rows;
}

/** How the extension asks for the search it wants. */
export type SearchFlagPlan =
	| { readonly ok: true; readonly flags: readonly string[]; readonly limitFlag?: string }
	| { readonly ok: false; readonly detail: string };

function describes(flag: HelpFlag, pattern: RegExp): boolean {
	return pattern.test(flag.name) || pattern.test(flag.description);
}

/**
 * Works out which flags to pass, from what the CLI's help says about them.
 *
 * Nothing here names a flag. A flag is chosen by what its help line says it
 * does, so a CLI that renames one is followed rather than broken. The one
 * flag the search cannot do without is the one that asks for JSON; the
 * others are used when the help offers them.
 */
export function planSearchFlags(help: string, fallback: readonly HelpFlag[] = []): SearchFlagPlan {
	const table = readFlagTable(help);
	const flags = table.length > 0 ? table : fallback;

	// "Trimmed JSON output" also mentions JSON, so the flag whose own line
	// says it prints JSON, or is named for it, is preferred.
	const json =
		flags.find(flag => /\bas json\b|^json\b/i.test(flag.description) || /json/i.test(flag.name)) ??
		flags.find(flag => /json/i.test(flag.description));
	if (!json) {
		return {
			ok: false,
			detail: 'this version of the Entire CLI cannot print checkpoint search results as JSON; update the CLI',
		};
	}

	const chosen = [json.name];

	const compact = flags.find(flag => flag !== json && describes(flag, /compact|trimmed/i));
	if (compact) {
		chosen.push(compact.name);
	}

	const limit = flags.find(flag => describes(flag, /maximum (?:number )?of results/i));

	return { ok: true, flags: chosen, limitFlag: limit?.name };
}

/**
 * Builds the argument list for a search.
 *
 * The query goes after the end-of-options separator, so a query that begins
 * with a dash is searched for rather than read as a flag.
 */
export function searchArguments(
	plan: Extract<SearchFlagPlan, { ok: true }>,
	query: string,
	limit: number = SEARCH_RESULT_LIMIT,
): readonly string[] {
	const args = ['checkpoint', 'search', ...plan.flags];
	if (plan.limitFlag !== undefined) {
		args.push(plan.limitFlag, String(limit));
	}
	args.push(END_OF_OPTIONS, query);
	return args;
}

/** Trims a query and says whether there is anything to search for. */
export function normaliseQuery(text: string): string | undefined {
	const query = text.trim().slice(0, MAX_QUERY_CHARACTERS).trim();
	return query.length > 0 ? query : undefined;
}

/** What a search came back with. */
export interface SearchResults {
	/** The hits that are checkpoints, as the tree shows them. */
	readonly checkpoints: readonly Checkpoint[];
	/** How many hits were commits, sessions or anything else. */
	readonly otherHits: number;
	/** How many results the CLI says there are in all, when it says. */
	readonly total?: number;
}

function toCheckpoint(id: string, title: string | undefined, date: Checkpoint['date'], agent: string | undefined): Checkpoint {
	return {
		id,
		message: title,
		agent,
		date,
		sessionIds: [],
		sessionCount: 0,
		isTaskCheckpoint: false,
		isLogsOnly: false,
	};
}

/** Decodes the payload of `entire checkpoint search --json`. */
export function decodeSearchResults(value: unknown, path = 'search'): DecodeResult<SearchResults> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}
	const read = fields(record.value, path);

	const results = decodeArray(record.value['results'] ?? [], `${path}.results`);
	if (!results.ok) {
		return results;
	}

	const total = optionalNumber(read, 'total');
	if (!total.ok) {
		return total;
	}

	const checkpoints: Checkpoint[] = [];
	const seen = new Set<string>();
	let otherHits = 0;

	for (const [index, item] of results.value.entries()) {
		const hitPath = `${path}.results[${index}]`;
		const hit = decodeRecord(item, hitPath);
		if (!hit.ok) {
			return hit;
		}
		const hitFields = fields(hit.value, hitPath);

		const id = requireString(hitFields, 'id');
		if (!id.ok) {
			return id;
		}
		const type = optionalString(hitFields, 'type');
		if (!type.ok) {
			return type;
		}
		const title = optionalString(hitFields, 'title');
		if (!title.ok) {
			return title;
		}
		const date = optionalTimestamp(hitFields, 'date');
		if (!date.ok) {
			return date;
		}
		const agent = optionalString(hitFields, 'agent');
		if (!agent.ok) {
			return agent;
		}

		if (type.value !== 'checkpoint' || !isCheckpointId(id.value)) {
			otherHits += 1;
			continue;
		}
		if (seen.has(id.value)) {
			continue;
		}
		seen.add(id.value);
		checkpoints.push(toCheckpoint(id.value, title.value, date.value, agent.value));
	}

	return { ok: true, value: { checkpoints, otherHits, total: total.value } };
}

/** The outcome of a search, in the three ways it can end. */
export type SearchOutcome =
	| { readonly kind: 'matches'; readonly checkpoints: readonly Checkpoint[]; readonly otherHits: number }
	| { readonly kind: 'none'; readonly otherHits: number }
	| { readonly kind: 'failed'; readonly detail: string };

/** Sorts decoded results into matches or no match. */
export function outcomeOf(results: SearchResults): SearchOutcome {
	return results.checkpoints.length > 0
		? { kind: 'matches', checkpoints: results.checkpoints, otherHits: results.otherHits }
		: { kind: 'none', otherHits: results.otherHits };
}

/** The line a view shows for an outcome that lists nothing. */
export function describeSearchOutcome(outcome: SearchOutcome): string | undefined {
	if (outcome.kind === 'failed') {
		return `The search failed: ${outcome.detail}. This says nothing about whether any checkpoint matches.`;
	}
	if (outcome.kind === 'none') {
		return outcome.otherHits > 0
			? `No checkpoint matched. ${outcome.otherHits} other ${outcome.otherHits === 1 ? 'result was a commit or session' : 'results were commits or sessions'}.`
			: 'No checkpoint matched.';
	}
	return undefined;
}
