import { END_OF_OPTIONS } from './operand';
import { readFlagTable, type HelpFlag } from './search';

/** The objects access can be granted on. Each is a command group of its own. */
export type GrantScope = 'repo' | 'project' | 'org';

/** What the extension needs from one flag, found by what the CLI's help says about it. */
export interface FlagWant {
	/** Matched against the flag's own name first. */
	readonly name?: RegExp;
	/** Matched against the help line when no name matched. */
	readonly description?: RegExp;
	readonly required?: boolean;
}

export type FlagPick<K extends string> =
	| { readonly ok: true; readonly flags: Readonly<Partial<Record<K, string>>>; readonly table: readonly HelpFlag[] }
	| { readonly ok: false; readonly detail: string };

/**
 * Picks the flags a command needs out of its help.
 *
 * No flag is named here as a literal. Each is found by a pattern over its
 * name or its help line, and only a flag the help lists can be picked, so
 * a CLI that renames one is followed and a CLI that drops a required one
 * is reported rather than sent a flag it would refuse. A flag already
 * picked is not picked again for another purpose.
 */
export function pickFlags<K extends string>(
	command: string,
	help: string,
	fallback: readonly HelpFlag[],
	wants: Readonly<Record<K, FlagWant>>,
): FlagPick<K> {
	const parsed = readFlagTable(help);
	const table = parsed.length > 0 ? parsed : fallback;
	const taken = new Set<string>();
	const flags: Partial<Record<K, string>> = {};

	for (const key of Object.keys(wants) as K[]) {
		const want = wants[key];
		const available = table.filter(flag => !taken.has(flag.name));
		const found =
			(want.name ? available.find(flag => want.name?.test(flag.name)) : undefined) ??
			(want.description ? available.find(flag => want.description?.test(flag.description)) : undefined);
		if (found) {
			taken.add(found.name);
			flags[key] = found.name;
		} else if (want.required) {
			return {
				ok: false,
				detail: `this version of the Entire CLI does not describe the ${key} flag of '${command}'; update the CLI`,
			};
		}
	}
	return { ok: true, flags, table };
}

/** The help line of a flag, by the name the help gave it. */
export function describeFlag(table: readonly HelpFlag[], name: string | undefined): string {
	return table.find(flag => flag.name === name)?.description ?? '';
}

const WORD = '[A-Za-z][A-Za-z0-9-]*';
const CHOICES = new RegExp(`(${WORD}(?:(?:\\s*,\\s*(?:or\\s+)?|\\s+or\\s+)${WORD})+)`);

/**
 * The values a flag's help line says it takes, such as `reader, writer, admin`.
 *
 * A list introduced by "one of" is preferred, then one after a colon. A
 * help line that names no list gives none, and the caller reports that
 * rather than guessing at values.
 */
export function readChoices(description: string): readonly string[] {
	const oneOf = /\bone of\s+/i.exec(description);
	const afterColon = description.indexOf(':');
	const start = oneOf ? oneOf.index + oneOf[0].length : afterColon >= 0 ? afterColon + 1 : -1;
	if (start < 0) {
		return [];
	}
	const match = CHOICES.exec(description.slice(start).trimStart());
	if (!match || match.index !== 0) {
		return [];
	}
	const values = match[1].split(/\s*,\s*(?:or\s+)?|\s+or\s+/).filter(value => value.length > 0);
	return [...new Set(values.filter(value => value !== 'or'))];
}

/** The flags a listing needs. */
export const LIST_WANTS = { json: { name: /json/i, description: /\bjson\b/i, required: true } } as const;

/** Flags of `repo list`. */
export const REPO_LIST_WANTS = {
	json: LIST_WANTS.json,
	project: { name: /project/i, description: /\bproject\b/i, required: true },
	all: { name: /^--all$/, description: /\bevery repositor/i },
} as const;

/** Flags of a delete. The CLI's own prompt needs a terminal, so the one that skips it is required. */
export const DELETE_WANTS = {
	skipPrompt: { description: /\bskip\b.*\bconfirm/i, required: true },
	cascade: { name: /cascade/i, description: /\balso delete\b.*\bmirror/i },
} as const;

/** Flags of `repo create`. */
export const REPO_CREATE_WANTS = {
	project: { name: /project/i, description: /\bowning project\b/i, required: true },
	visibility: { name: /visibility/i },
} as const;

/** Flags of `repo edit`. */
export const REPO_EDIT_WANTS = {
	visibility: { name: /visibility/i, required: true },
} as const;

/** The role flag of a grant. Required, because the confirmation names the role being given. */
export const GRANT_WANTS = {
	role: { name: /role/i, description: /\brole\b/i, required: true },
} as const;

/** Flags of `api`. */
export const API_WANTS = {
	method: { name: /method/i, description: /\bhttp method\b/i, required: true },
	backend: { name: /^--to$/, description: /\bwhich backend\b/i },
} as const;

/** The standard HTTP methods an API call can use. Not a flag list: these are the protocol's verbs. */
export const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Whether a method only reads. Anything else needs the person to agree first. */
export function isReadMethod(method: string): boolean {
	return method.toUpperCase() === 'GET';
}

function withValue(flag: string, value: string): string {
	return `${flag}=${value}`;
}

/** `entire repo list`. */
export function repoListArguments(
	flags: { readonly json: string; readonly project: string; readonly all?: string },
	project: string,
): readonly string[] {
	return ['repo', 'list', flags.json, ...(flags.all ? [flags.all] : []), withValue(flags.project, project)];
}

/** `entire org list`, `entire project list` or `entire cluster list`. */
export function listArguments(group: 'org' | 'project' | 'cluster', json: string): readonly string[] {
	return [group, 'list', json];
}

/** `entire <scope> grant list`. */
export function grantListArguments(scope: GrantScope, json: string, target: string): readonly string[] {
	return [scope, 'grant', 'list', json, END_OF_OPTIONS, target];
}

/** `entire <group> delete`, past the CLI's prompt, with the mirrors cascade only when asked for. */
export function deleteArguments(group: GrantScope, skipPrompt: string, cascade: string | undefined, target: string): readonly string[] {
	return [group, 'delete', skipPrompt, ...(cascade ? [cascade] : []), END_OF_OPTIONS, target];
}

/** `entire repo create`. */
export function createRepositoryArguments(
	flags: { readonly project: string; readonly visibility?: string },
	project: string,
	name: string,
	visibility: string | undefined,
): readonly string[] {
	return [
		'repo',
		'create',
		withValue(flags.project, project),
		...(flags.visibility && visibility ? [withValue(flags.visibility, visibility)] : []),
		END_OF_OPTIONS,
		name,
	];
}

/** `entire repo edit`. */
export function editVisibilityArguments(visibilityFlag: string, visibility: string, path: string): readonly string[] {
	return ['repo', 'edit', withValue(visibilityFlag, visibility), END_OF_OPTIONS, path];
}

/** `entire <scope> grant add`. */
export function grantAddArguments(scope: GrantScope, roleFlag: string | undefined, role: string, target: string, grantee: string): readonly string[] {
	return [scope, 'grant', 'add', ...(roleFlag ? [withValue(roleFlag, role)] : []), END_OF_OPTIONS, target, grantee];
}

/** `entire <scope> grant remove`. */
export function grantRemoveArguments(scope: GrantScope, target: string, grantee: string): readonly string[] {
	return [scope, 'grant', 'remove', END_OF_OPTIONS, target, grantee];
}

/** `entire api`. The path is the one operand, after the end of options. */
export function apiArguments(
	flags: { readonly method: string; readonly backend?: string },
	call: { readonly method: string; readonly path: string; readonly backend?: string },
): readonly string[] {
	return [
		'api',
		...(isReadMethod(call.method) ? [] : [withValue(flags.method, call.method.toUpperCase())]),
		...(flags.backend && call.backend ? [withValue(flags.backend, call.backend)] : []),
		END_OF_OPTIONS,
		call.path,
	];
}
