import {
	EXPERTS_WANTS,
	classifyExpertsFailure,
	decodeExperts,
	expertsArguments,
	failureDetail,
	staticEnvironment,
	withSignInHint,
	type AccountContext,
	type ExpertEntry,
	type ExpertsContext,
	type ExpertsRequest,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { readCommandHelp, type Unavailable } from './commandHelp';
import { readTrailWorkspace } from './trailService';

/** What a lookup came to. */
export type ExpertsOutcome =
	| { readonly kind: 'found'; readonly entries: readonly ExpertEntry[]; readonly context: ExpertsContext }
	/** Entire holds no provenance for the scope. An answer, not a failure. */
	| { readonly kind: 'empty'; readonly context: ExpertsContext }
	/** The repository is not on Entire. Neither empty nor an ordinary failure. */
	| { readonly kind: 'notMirrored'; readonly cliText: string }
	/** Entire answered with JSON that holds no list of entries. */
	| { readonly kind: 'unreadable'; readonly context: ExpertsContext }
	| { readonly kind: 'cancelled' }
	| Unavailable;

export interface ExpertsSource {
	ask(request: ExpertsRequest, acting: AccountContext, signal?: AbortSignal): Promise<ExpertsOutcome>;
	/** The last reply, held in memory only, for the explicit command that opens it. */
	lastReply(): string | undefined;
}

export interface ExpertsOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	readonly timeoutSeconds: () => number;
	readonly limit: () => number;
	/** The branch checked out now, when it is known. */
	readonly branch: () => string | undefined;
}

const PURPOSE = 'ask who has touched code';

/**
 * Asks Entire which agents, skills and tools have provenance over a scope.
 *
 * `entire experts` sends the scope or question to Entire's servers, so the
 * lookup runs as the login the caller names and the result carries that
 * login, the repository and the branch. The question is an operand after
 * `--`, is kept out of the invocation record, and the reply is held in
 * memory only. The interactive viewer is never asked for.
 */
export class ExpertsService implements ExpertsSource {
	private reply: string | undefined;

	constructor(private readonly options: ExpertsOptions) {}

	lastReply(): string | undefined {
		return this.reply;
	}

	async ask(request: ExpertsRequest, acting: AccountContext, signal?: AbortSignal): Promise<ExpertsOutcome> {
		const cwd = this.options.workspaceRoot();
		const timeoutMs = this.options.timeoutSeconds() * 1000;
		const help = await readCommandHelp(this.options.runner, 'experts', PURPOSE, EXPERTS_WANTS, { cwd, timeoutMs });
		if (!help.ok) {
			return help;
		}
		const branch = this.options.branch();
		const limit = this.options.limit();
		const args = expertsArguments(help.flags, request, { limit, branch });
		if (!args) {
			return {
				kind: 'unsupported',
				detail: `this version of the Entire CLI does not describe the flag this lookup needs for 'experts'; update the CLI`,
			};
		}

		const [result, repository] = await Promise.all([
			this.options.runner.run(args, {
				cwd,
				timeoutMs,
				context: acting.name,
				env: staticEnvironment(),
				withholdBodies: true,
				redactOperands: true,
				signal,
			}),
			this.repository(cwd),
		]);

		const context: ExpertsContext = {
			repository,
			branch,
			login: acting.handle === acting.name ? acting.handle : `${acting.handle} (login ${acting.name})`,
			limit: help.flags.limit ? limit : undefined,
		};

		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled' };
			}
			if (result.reason === 'absent' || result.reason === 'broken') {
				return { kind: 'noCli', detail: result.detail };
			}
			const said = failureDetail(result.stderr, result.stdout, result.detail);
			if (result.reason === 'exit-code' && classifyExpertsFailure(`${result.stderr}\n${result.stdout}`) === 'not-mirrored') {
				return { kind: 'notMirrored', cliText: said };
			}
			return {
				kind: 'failed',
				detail: result.reason === 'timeout' ? `${result.detail}; raise entirely.expertsTimeout if Entire needs longer` : withSignInHint(said),
			};
		}

		this.reply = result.stdout;
		let parsed: unknown;
		try {
			parsed = JSON.parse(result.stdout);
		} catch {
			return { kind: 'unreadable', context };
		}
		const reading = decodeExperts(parsed);
		switch (reading.kind) {
			case 'entries':
				return { kind: 'found', entries: reading.entries, context };
			case 'empty':
				return { kind: 'empty', context };
			case 'unreadable':
				return { kind: 'unreadable', context };
		}
	}

	/** The repository the CLI resolves for this folder, or undefined when it cannot say. */
	private async repository(cwd: string | undefined): Promise<string | undefined> {
		const found = await readTrailWorkspace(this.options.runner, cwd);
		return found.kind === 'ok' ? found.value.repository : undefined;
	}
}
