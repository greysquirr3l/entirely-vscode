import {
	codeSearchArguments,
	decodeFileHits,
	decodeWorkHits,
	outcomeOfReport,
	planWorkSearch,
	pluralise,
	unwrap,
	workSearchArguments,
	type FileHit,
	type RepositoryReach,
	type SearchScope,
	type WorkHit,
	type WorkSearchOutcome,
	type WorkSearchPlan,
} from '../lib/entire';
import type { CliRunner } from './cli';

/** Where editor search results come from. */
export interface WorkSearchSource {
	search(query: string): Promise<WorkSearchOutcome>;
}

export interface WorkSearchOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** Whether to search only the current repository or everything the login can see. */
	readonly reach: () => RepositoryReach;
	/** The login the CLI acts as, for the scope line. */
	readonly login: () => string | undefined;
	/** How long, in milliseconds, each CLI call may take. */
	readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Runs `entire search`: once for sessions, commits and checkpoints, and
 * once for file contents.
 *
 * The flags come from the CLI's own help on every search. The two calls
 * run side by side. If one fails, the other's results are still listed
 * and the failure is said alongside them. A missing CLI or one without
 * the command is a failure, never an empty result.
 */
export class WorkSearchService implements WorkSearchSource {
	constructor(private readonly options: WorkSearchOptions) {}

	async search(query: string): Promise<WorkSearchOutcome> {
		const cwd = this.options.workspaceRoot();
		const reach = this.options.reach();
		const login = this.options.login();
		const unknownScope: SearchScope = { reach, login };

		const usage = await this.options.runner.usage('search', { cwd });
		if (!usage.ok) {
			return { kind: 'failed', detail: explainSearchHelpFailure(usage.reason, usage.detail), query, scope: unknownScope };
		}
		const planned = planWorkSearch(usage.value.raw, usage.value.flags);
		if (!planned.ok) {
			return { kind: 'failed', detail: planned.detail, query, scope: unknownScope };
		}
		const { plan } = planned;
		const scope: SearchScope = {
			reach,
			repo: plan.currentRepo,
			login,
			widened: reach === 'all' ? plan.allReposFlag !== undefined : undefined,
		};

		const [listing, code] = await Promise.all([
			this.listing(plan, query, reach, cwd),
			this.code(plan, query, reach, cwd),
		]);

		if (!listing.ok && !code.ok) {
			return { kind: 'failed', detail: listing.detail, query, scope };
		}

		const notes: string[] = [];
		const hits: readonly WorkHit[] = listing.ok ? listing.items : [];
		const files: readonly FileHit[] = code.ok ? code.items : [];
		if (!listing.ok) {
			notes.push(`Sessions and commits could not be searched: ${listing.detail}.`);
		} else if (listing.total !== undefined && listing.total > hits.length) {
			notes.push(`Showing ${hits.length} of ${pluralise(listing.total, 'result')} for sessions and commits.`);
		}
		if (!code.ok) {
			notes.push(`Files could not be searched: ${code.detail}.`);
		} else if (code.total !== undefined && code.total > files.length) {
			notes.push(`Showing ${files.length} of ${pluralise(code.total, 'file match')}.`);
		}

		return outcomeOfReport({ query, scope, hits, files, notes });
	}

	private async listing(
		plan: WorkSearchPlan,
		query: string,
		reach: RepositoryReach,
		cwd: string | undefined,
	): Promise<Part<WorkHit>> {
		const result = await this.options.runner.runJson(
			workSearchArguments(plan, query, reach),
			value => unwrap(decodeWorkHits(value)),
			this.runOptions(cwd),
		);
		return result.ok
			? { ok: true, items: result.value.hits, total: result.value.total }
			: { ok: false, detail: result.detail };
	}

	private async code(
		plan: WorkSearchPlan,
		query: string,
		reach: RepositoryReach,
		cwd: string | undefined,
	): Promise<Part<FileHit>> {
		const args = codeSearchArguments(plan, query, reach);
		if (!args) {
			return { ok: false, detail: 'this version of the Entire CLI has no code search' };
		}
		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeFileHits(value)),
			this.runOptions(cwd),
		);
		return result.ok
			? { ok: true, items: result.value.files, total: result.value.total }
			: { ok: false, detail: result.detail };
	}

	// The query is the user's own words and the hits are their history and
	// source, so neither the command line nor the output reaches the log.
	private runOptions(cwd: string | undefined) {
		return {
			cwd,
			timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			redactOperands: true,
			withholdBodies: true,
		};
	}
}

type Part<T> =
	| { readonly ok: true; readonly items: readonly T[]; readonly total?: number }
	| { readonly ok: false; readonly detail: string };

function explainSearchHelpFailure(reason: string, detail: string): string {
	switch (reason) {
		case 'absent':
			return 'the Entire CLI is not installed; install it to search';
		case 'broken':
		case 'spawn-failed':
		case 'timeout':
			return detail;
		default:
			return 'this version of the Entire CLI has no search command; update the CLI';
	}
}
