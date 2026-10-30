import {
	decodeArray,
	decodeRecord,
	fields,
	optionalNumber,
	optionalString,
	requireString,
	type DecodeResult,
} from './decode';
import { pluralise } from './text';

/** What a listed hit is. */
export type WorkHitKind = 'session' | 'commit' | 'checkpoint' | 'other';

/** A session, commit or checkpoint the search matched. */
export interface WorkHit {
	readonly kind: WorkHitKind;
	/** The type the CLI gave it, kept for hits that are none of the three. */
	readonly typeName: string;
	readonly id: string;
	readonly title?: string;
	readonly repo?: string;
	readonly branch?: string;
	readonly author?: string;
	readonly date?: string;
}

/** A line of a file the code search matched. */
export interface FileHit {
	readonly repo?: string;
	/** Relative to the repository root, with forward slashes. */
	readonly path: string;
	/** One-based. */
	readonly line?: number;
	/** One-based. */
	readonly column?: number;
	/** The matching line. */
	readonly text?: string;
}

export interface WorkHitPage {
	readonly hits: readonly WorkHit[];
	readonly total?: number;
}

export interface FileHitPage {
	readonly files: readonly FileHit[];
	readonly total?: number;
}

function kindOf(typeName: string): WorkHitKind {
	return typeName === 'session' || typeName === 'commit' || typeName === 'checkpoint' ? typeName : 'other';
}

/** Decodes `entire search --json`. */
export function decodeWorkHits(value: unknown, path = 'search'): DecodeResult<WorkHitPage> {
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

	const hits: WorkHit[] = [];
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
		const strings = (['type', 'title', 'repo', 'branch', 'author', 'date'] as const).map(key =>
			optionalString(hitFields, key),
		);
		for (const field of strings) {
			if (!field.ok) {
				return field;
			}
		}
		const [type, title, repo, branch, author, date] = strings.map(field => (field.ok ? field.value : undefined));
		const typeName = type ?? 'result';
		hits.push({ kind: kindOf(typeName), typeName, id: id.value, title, repo, branch, author, date });
	}
	return { ok: true, value: { hits, total: total.value } };
}

/** Decodes `entire search --code --json`. */
export function decodeFileHits(value: unknown, path = 'code search'): DecodeResult<FileHitPage> {
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

	const files: FileHit[] = [];
	for (const [index, item] of results.value.entries()) {
		const hitPath = `${path}.results[${index}]`;
		const hit = decodeRecord(item, hitPath);
		if (!hit.ok) {
			return hit;
		}
		const hitFields = fields(hit.value, hitPath);
		const file = requireString(hitFields, 'path');
		if (!file.ok) {
			return file;
		}
		const repo = optionalString(hitFields, 'repo');
		if (!repo.ok) {
			return repo;
		}
		const line = optionalNumber(hitFields, 'line');
		if (!line.ok) {
			return line;
		}
		const column = optionalNumber(hitFields, 'column');
		if (!column.ok) {
			return column;
		}
		const text = optionalString(hitFields, 'context_line');
		if (!text.ok) {
			return text;
		}
		files.push({ repo: repo.value, path: file.value, line: line.value, column: column.value, text: text.value });
	}
	return { ok: true, value: { files, total: total.value } };
}

/** Where a search looked. */
export interface SearchScope {
	readonly reach: 'current' | 'all';
	/** The repository the CLI detected, when it said. */
	readonly repo?: string;
	/** The login the search ran as, when known. */
	readonly login?: string;
	/** Whether the CLI could be asked to widen the search. False when `reach` was asked for but the flag is absent. */
	readonly widened?: boolean;
}

/** Says where a search looked and whose view of the data it had. */
export function describeScope(scope: SearchScope): string {
	const where =
		scope.reach === 'all' && scope.widened !== false
			? 'every repository this login can see'
			: scope.repo
				? `this repository (${scope.repo})`
				: 'this repository';
	const who = scope.login ? ` as ${scope.login}` : '';
	return `${where}${who}`;
}

/** What a finished search holds. */
export interface WorkSearchReport {
	readonly query: string;
	readonly scope: SearchScope;
	readonly hits: readonly WorkHit[];
	readonly files: readonly FileHit[];
	/** Parts of the search that did not complete, worded for the user. */
	readonly notes: readonly string[];
}

export type WorkSearchOutcome =
	| { readonly kind: 'results'; readonly report: WorkSearchReport }
	| { readonly kind: 'none'; readonly report: WorkSearchReport }
	| { readonly kind: 'failed'; readonly detail: string; readonly query: string; readonly scope: SearchScope };

/** Sorts a report into results or none. */
export function outcomeOfReport(report: WorkSearchReport): WorkSearchOutcome {
	return report.hits.length + report.files.length > 0 ? { kind: 'results', report } : { kind: 'none', report };
}

/** The line that states the scope above a list of results. */
export function scopeLine(scope: SearchScope): string {
	return `Searched ${describeScope(scope)}.`;
}

/**
 * The message a view shows when nothing is listed.
 *
 * An empty search says it found nothing and where it looked, so an
 * account that cannot see a repository is not mistaken for a repository
 * with nothing in it. A part of the search that failed is said apart from
 * the parts that found nothing.
 */
export function describeEmptyOutcome(outcome: WorkSearchOutcome): string | undefined {
	if (outcome.kind === 'failed') {
		return `The search failed: ${outcome.detail}. This says nothing about whether anything matches. It was meant to cover ${describeScope(outcome.scope)}.`;
	}
	if (outcome.kind === 'results') {
		return undefined;
	}
	const { report } = outcome;
	const notes = report.notes.length > 0 ? ` ${report.notes.join(' ')}` : '';
	return `The search for "${report.query}" found nothing in ${describeScope(report.scope)}.${notes}`;
}

/** A short count line for the top of a list, such as "2 sessions, 1 commit". */
export function summariseReport(report: WorkSearchReport): string {
	const count = (kind: WorkHitKind, noun: string): string | undefined => {
		const n = report.hits.filter(hit => hit.kind === kind).length;
		return n > 0 ? pluralise(n, noun) : undefined;
	};
	const parts = [
		count('session', 'session'),
		count('commit', 'commit'),
		count('checkpoint', 'checkpoint'),
		count('other', 'other result'),
		report.files.length > 0
			? `${report.files.length} file ${report.files.length === 1 ? 'match' : 'matches'}`
			: undefined,
	].filter((part): part is string => part !== undefined);
	return parts.join(', ');
}
