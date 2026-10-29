import {
	decodeSearchResults,
	outcomeOf,
	planSearchFlags,
	searchArguments,
	unwrap,
	type SearchFlagPlan,
	type SearchOutcome,
} from '../lib/entire';
import type { CliRunner } from './cli';

/** Where checkpoint search results come from. */
export interface CheckpointSearchSource {
	search(query: string): Promise<SearchOutcome>;
}

/** What the service needs to do its job. */
export interface CheckpointSearchOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in milliseconds, the search may take. The CLI asks a server. */
	readonly timeoutMs?: number;
}

const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;

/**
 * Runs `entire checkpoint search`.
 *
 * The CLI does the matching. This reads the command's flags from its own
 * help, passes the query as an operand, and reports one of three
 * outcomes: matches, no match, or a failure with the reason. A missing
 * CLI and a CLI too old to have the command are failures, never an empty
 * result.
 */
export class CheckpointSearchService implements CheckpointSearchSource {
	private plan: Extract<SearchFlagPlan, { ok: true }> | undefined;

	constructor(private readonly options: CheckpointSearchOptions) {}

	/** Forgets the flags read from the help, for when the CLI changes. */
	reset(): void {
		this.plan = undefined;
	}

	async search(query: string): Promise<SearchOutcome> {
		const cwd = this.options.workspaceRoot();

		const plan = await this.flags(cwd);
		if (!plan.ok) {
			return { kind: 'failed', detail: plan.detail };
		}

		// The query is the user's own words about their history, so the
		// recorded command line and the output are kept out of the log.
		const result = await this.options.runner.runJson(
			searchArguments(plan, query),
			value => unwrap(decodeSearchResults(value)),
			{
				cwd,
				timeoutMs: this.options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
				redactOperands: true,
				withholdBodies: true,
			},
		);

		if (!result.ok) {
			return { kind: 'failed', detail: result.detail };
		}
		return outcomeOf(result.value);
	}

	/** Reads the flags from the CLI's own help, once it has answered. */
	private async flags(cwd: string | undefined): Promise<SearchFlagPlan> {
		if (this.plan) {
			return this.plan;
		}

		const usage = await this.options.runner.usage('checkpoint search', { cwd });
		if (!usage.ok) {
			return { ok: false, detail: explainHelpFailure(usage.reason, usage.detail) };
		}

		const plan = planSearchFlags(usage.value.raw, usage.value.flags);
		if (plan.ok) {
			this.plan = plan;
		}
		return plan;
	}
}

/** Says why the help could not be read, with something the user can do. */
function explainHelpFailure(reason: string, detail: string): string {
	switch (reason) {
		case 'absent':
			return 'the Entire CLI is not installed; install it to search checkpoints';
		case 'broken':
		case 'spawn-failed':
		case 'timeout':
			return detail;
		default:
			return 'this version of the Entire CLI has no checkpoint search; update the CLI';
	}
}
