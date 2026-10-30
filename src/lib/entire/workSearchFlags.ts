import { END_OF_OPTIONS } from './operand';
import { SEARCH_RESULT_LIMIT, planSearchFlags, readFlagTable, type HelpFlag } from './search';

/** The flags of `entire search` that the extension uses, as the CLI's help names them. */
export interface WorkSearchPlan {
	/** The flags that ask for JSON, and the trimmed shape when the help offers it. */
	readonly listing: readonly string[];
	/** The flag that asks for JSON alone, which is what code search accepts. */
	readonly jsonOnly: string;
	readonly limitFlag?: string;
	/** The flag that widens the search beyond the current repository. */
	readonly allReposFlag?: string;
	/** The flag that searches file contents. Absent when this CLI cannot. */
	readonly codeFlag?: string;
	/** The repository the CLI says it detected, such as `gh/owner/name`. */
	readonly currentRepo?: string;
}

export type WorkSearchPlanResult =
	| { readonly ok: true; readonly plan: WorkSearchPlan }
	| { readonly ok: false; readonly detail: string };

function describesFlag(flag: HelpFlag, pattern: RegExp): boolean {
	return pattern.test(flag.description);
}

/** Reads the repository the CLI says it searches by default out of its help text. */
export function readCurrentRepo(help: string): string | undefined {
	const match = /^\s*Current repo:\s+(\S+)/m.exec(help);
	return match?.[1];
}

/**
 * Works out which flags to pass to `entire search` from what its help says.
 *
 * No flag is named here: each one is picked by what its help line says it
 * does. The code search needs the plain JSON flag only, because the CLI
 * refuses the trimmed shape together with it.
 */
export function planWorkSearch(help: string, fallback: readonly HelpFlag[] = []): WorkSearchPlanResult {
	const base = planSearchFlags(help, fallback);
	if (!base.ok) {
		return { ok: false, detail: 'this version of the Entire CLI cannot print search results as JSON; update the CLI' };
	}

	const table = readFlagTable(help);
	const flags = table.length > 0 ? table : fallback;

	return {
		ok: true,
		plan: {
			listing: base.flags,
			jsonOnly: base.flags[0],
			limitFlag: base.limitFlag,
			allReposFlag: flags.find(flag => describesFlag(flag, /^search all\b.*\brepos/i))?.name,
			codeFlag: flags.find(flag => describesFlag(flag, /^search code\b/i))?.name,
			currentRepo: readCurrentRepo(help),
		},
	};
}

/** Whether a search covers the current repository or everything the login can see. */
export type RepositoryReach = 'current' | 'all';

function reachFlags(plan: WorkSearchPlan, reach: RepositoryReach): string[] {
	return reach === 'all' && plan.allReposFlag ? [plan.allReposFlag] : [];
}

function limitFlags(plan: WorkSearchPlan, limit: number): string[] {
	return plan.limitFlag ? [plan.limitFlag, String(limit)] : [];
}

/** Arguments for the search over sessions, commits and checkpoints. */
export function workSearchArguments(
	plan: WorkSearchPlan,
	query: string,
	reach: RepositoryReach,
	limit: number = SEARCH_RESULT_LIMIT,
): readonly string[] {
	return [
		'search',
		...plan.listing,
		...reachFlags(plan, reach),
		...limitFlags(plan, limit),
		END_OF_OPTIONS,
		query,
	];
}

/** Arguments for the search over file contents, or undefined when the CLI has none. */
export function codeSearchArguments(
	plan: WorkSearchPlan,
	query: string,
	reach: RepositoryReach,
	limit: number = SEARCH_RESULT_LIMIT,
): readonly string[] | undefined {
	if (!plan.codeFlag) {
		return undefined;
	}
	return [
		'search',
		plan.jsonOnly,
		plan.codeFlag,
		...reachFlags(plan, reach),
		...limitFlags(plan, limit),
		END_OF_OPTIONS,
		query,
	];
}
