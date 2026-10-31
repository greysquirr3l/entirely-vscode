import { END_OF_OPTIONS } from './operand';
import { markdownText } from './text';
import type { FlagWant } from './controlPlaneFlags';

/**
 * The flags of `entire experts`.
 *
 * The interactive viewer's flag is picked first only so that no other
 * want can claim it. It is never passed: the extension is not a terminal.
 */
export const EXPERTS_WANTS = {
	viewer: { name: /tui/i, description: /\binteractive viewer\b|\bTTY\b/i },
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	limit: { name: /limit/i, description: /\bmaximum\b/i },
	branch: { name: /branch/i, description: /\bbranch to inspect\b/i },
	repo: { name: /^--repo$/, description: /\bowner\/repo\b/i },
	staged: { name: /staged/i, description: /\bstaged\b/i },
} as const satisfies Record<string, FlagWant>;

export type ExpertsFlags = Readonly<Partial<Record<keyof typeof EXPERTS_WANTS, string>>>;

/** What the person asked Entire. */
export type ExpertsRequest =
	| { readonly kind: 'scope'; readonly scope: string }
	| { readonly kind: 'query'; readonly text: string }
	| { readonly kind: 'staged' };

/** The bounds of the result limit, as the CLI's help states them. */
export const MIN_EXPERTS_LIMIT = 1;
export const MAX_EXPERTS_LIMIT = 20;

/** The longest question that is sent. */
export const MAX_EXPERTS_QUESTION = 500;

/**
 * The arguments of an experts lookup.
 *
 * The scope or question is the only operand and goes after the end-of-options
 * separator, so one that begins with a dash is a question and not a flag.
 * Values of flags are attached with `=`. The staged lookup takes no operand.
 */
export function expertsArguments(
	flags: ExpertsFlags,
	request: ExpertsRequest,
	options: { readonly limit?: number; readonly branch?: string } = {},
): readonly string[] | undefined {
	if (!flags.json) {
		return undefined;
	}
	const args = ['experts', flags.json];
	if (flags.limit && options.limit !== undefined) {
		const limit = Math.min(MAX_EXPERTS_LIMIT, Math.max(MIN_EXPERTS_LIMIT, Math.floor(options.limit)));
		args.push(`${flags.limit}=${limit}`);
	}
	if (flags.branch && options.branch) {
		args.push(`${flags.branch}=${options.branch}`);
	}
	switch (request.kind) {
		case 'staged':
			if (!flags.staged) {
				return undefined;
			}
			args.push(flags.staged);
			return args;
		case 'scope':
			return request.scope.length > 0 ? [...args, END_OF_OPTIONS, request.scope] : undefined;
		case 'query':
			return request.text.length > 0 ? [...args, END_OF_OPTIONS, request.text] : undefined;
	}
}

/** One agent, skill or tool Entire ranked, with every field it sent. */
export interface ExpertEntry {
	readonly name: string;
	readonly kind?: string;
	readonly score?: number;
	/** The other fields of the entry, as the CLI wrote them. */
	readonly details: readonly { readonly label: string; readonly value: string }[];
}

export type ExpertsReading =
	| { readonly kind: 'entries'; readonly entries: readonly ExpertEntry[] }
	| { readonly kind: 'empty' }
	| { readonly kind: 'unreadable' };

const LIST_KEYS = ['profiles', 'experts', 'results', 'entries'] as const;
const NAME_KEYS = ['name', 'agent', 'skill', 'tool', 'id'] as const;
const KIND_KEYS = ['kind', 'type'] as const;
const SCORE_KEYS = ['score', 'count', 'rank'] as const;
const MAX_DETAIL_CHARACTERS = 500;

function scalar(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return undefined;
}

function show(value: unknown): string {
	const text = scalar(value) ?? JSON.stringify(value) ?? '';
	return text.length > MAX_DETAIL_CHARACTERS ? `${text.slice(0, MAX_DETAIL_CHARACTERS - 1)}…` : text;
}

function readEntry(value: unknown, index: number): ExpertEntry {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { name: scalar(value) ?? `Entry ${index + 1}`, details: scalar(value) === undefined ? [{ label: 'value', value: show(value) }] : [] };
	}
	const record = value as Record<string, unknown>;
	const used = new Set<string>();
	const firstString = (keys: readonly string[]): string | undefined => {
		for (const key of keys) {
			const found = record[key];
			if (typeof found === 'string' && found.length > 0) {
				used.add(key);
				return found;
			}
		}
		return undefined;
	};
	const name = firstString(NAME_KEYS) ?? `Entry ${index + 1}`;
	const kind = firstString(KIND_KEYS);
	let score: number | undefined;
	for (const key of SCORE_KEYS) {
		const found = record[key];
		if (typeof found === 'number' && Number.isFinite(found)) {
			score = found;
			used.add(key);
			break;
		}
	}
	const details = Object.keys(record)
		.filter(key => !used.has(key) && record[key] !== null && record[key] !== undefined)
		.map(key => ({ label: key, value: show(record[key]) }));
	return { name, kind, score, details };
}

/**
 * Reads the answer of `entire experts --json`.
 *
 * The shape was not observed: the command sends the question to Entire's
 * servers and the extension has not been allowed to ask one. The reading is
 * therefore tolerant. A list is found at the root or under one of a few
 * likely keys (or the first key that holds a list); each entry keeps a
 * display name, a kind and a score when it has them, and every other field
 * is carried along as it was written. Nothing is dropped and nothing is made
 * up. A payload with no list in it is `unreadable`, so the caller can say so
 * and offer the raw body.
 */
export function decodeExperts(value: unknown): ExpertsReading {
	let list: unknown;
	if (Array.isArray(value)) {
		list = value;
	} else if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>;
		const key = LIST_KEYS.find(candidate => candidate in record) ?? Object.keys(record).find(candidate => Array.isArray(record[candidate]));
		if (key === undefined) {
			return { kind: 'unreadable' };
		}
		list = record[key];
		if (list === null) {
			return { kind: 'empty' };
		}
	}
	if (!Array.isArray(list)) {
		return { kind: 'unreadable' };
	}
	return list.length === 0 ? { kind: 'empty' } : { kind: 'entries', entries: list.map((entry, index) => readEntry(entry, index)) };
}

/** Whether the CLI's refusal reads as a repository that Entire does not hold. */
export type ExpertsFailure = 'not-mirrored' | 'other';

/**
 * Chooses the message for a failed lookup.
 *
 * The CLI's wording for a repository that is not mirrored was not observed,
 * so this matches loosely, and only to choose which message to show. The CLI's
 * own text is always shown with it.
 */
export function classifyExpertsFailure(output: string): ExpertsFailure {
	return /mirror|publish|no such repo|(?:repo|repository|project)\b[^\n]{0,40}\bnot found|not found\b[^\n]{0,40}\b(?:repo|repository)\b/i.test(output)
		? 'not-mirrored'
		: 'other';
}

/** What the answer is about, for the document's heading and the messages. */
export interface ExpertsContext {
	readonly repository?: string;
	readonly branch?: string;
	readonly login: string;
	readonly limit?: number;
}

/** The scope in words. */
export function describeExpertsRequest(request: ExpertsRequest): string {
	switch (request.kind) {
		case 'scope':
			return `the path ${request.scope}`;
		case 'query':
			return 'the question you typed';
		case 'staged':
			return 'the staged files';
	}
}

/** Why the lookup went to Entire, in words that name the servers. */
export const EXPERTS_SERVER_NOTICE =
	"The scope or question is sent to Entire's servers, which answer from the provenance they hold for the repository. The local clone is not read.";

function contextLines(context: ExpertsContext): string[] {
	return [
		`- Repository: ${context.repository ? markdownText(context.repository) : 'the repository of this folder, as the CLI resolves it'}`,
		`- Branch: ${context.branch ? markdownText(context.branch) : "the CLI's default"}`,
		`- Asked as: ${markdownText(context.login)}, on Entire`,
	];
}

/** The heading and context shared by every experts document. */
function head(request: ExpertsRequest, context: ExpertsContext): string[] {
	const scope = request.kind === 'scope' ? `Scope: ${markdownText(request.scope)}` : `Scope: ${describeExpertsRequest(request)}`;
	return ['# Who has touched this code', '', EXPERTS_SERVER_NOTICE, '', scope, ...contextLines(context), ''];
}

function line(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The ranking as a Markdown document. The question typed is not repeated in it. */
export function describeExperts(entries: readonly ExpertEntry[], request: ExpertsRequest, context: ExpertsContext): string {
	const out = head(request, context);
	out.push(`## Ranked (${entries.length})`, '');
	entries.forEach((entry, index) => {
		const kind = entry.kind ? ` (${markdownText(entry.kind)})` : '';
		const score = entry.score !== undefined ? ` — ${entry.score}` : '';
		out.push(`${index + 1}. **${markdownText(entry.name)}**${kind}${score}`);
		for (const detail of entry.details) {
			out.push(`   - ${markdownText(detail.label)}: ${markdownText(detail.value)}`);
		}
	});
	return `${out.join('\n').trimEnd()}\n`;
}

/** The note shown when Entire holds no provenance for the scope. */
export function describeEmptyExperts(request: ExpertsRequest, context: ExpertsContext): string {
	const out = head(request, context);
	out.push(
		'## Nothing found',
		'',
		`Entire has no recorded provenance for ${markdownText(describeExpertsRequest(request))}. This is an answer, not a failure.`,
		'',
		'A recent push can take a couple of minutes to appear. Try again shortly, or ask about another path.',
		...(context.branch ? ['', `Branch ${markdownText(context.branch)} may not be pushed to Entire; Entire answers only for what it holds.`] : []),
	);
	return `${out.join('\n')}\n`;
}

/** What to say when the repository is not on Entire. The CLI's own text follows it. */
export function describeNotMirrored(cliText: string): string {
	const said = line(cliText);
	return (
		'Entire does not hold this repository, so it could not answer. Create it on Entire or mirror it there ' +
		'(use "Entirely: Create Repository" or the Control Plane view), push it, then ask again.' +
		(said.length > 0 ? ` The CLI said: ${said}` : '')
	);
}

/** What to say when the answer parsed but held no list of entries. */
export const UNREADABLE_EXPERTS =
	'Entire answered in a shape this version of the extension cannot read. Use "Entirely: Show Raw Experts Reply" to open it.';
