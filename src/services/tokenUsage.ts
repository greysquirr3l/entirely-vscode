import {
	decodeTokenReport,
	isCheckpointId,
	isSessionId,
	unwrap,
	type TokenReport,
} from '../lib/entire';
import { END_OF_OPTIONS } from '../lib/entire/operand';
import type { CliRunner } from './cli';

/** The outcome of asking the CLI for token usage. */
export type TokenReportResult =
	| { readonly kind: 'found'; readonly report: TokenReport }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where token usage comes from. */
export interface TokenUsageSource {
	session(id: string): Promise<TokenReportResult>;
	checkpoint(id: string): Promise<TokenReportResult>;
}

/** What the service needs to do its job. */
export interface TokenUsageOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
}

/**
 * Reads token usage from `entire session tokens` and `entire checkpoint
 * tokens`. Nothing is estimated, summed or derived here: a count the CLI
 * does not send stays missing. A missing or unusable CLI comes back as a
 * failure with the runner's explanation.
 */
export class TokenUsageService implements TokenUsageSource {
	constructor(private readonly options: TokenUsageOptions) {}

	async session(id: string): Promise<TokenReportResult> {
		if (!isSessionId(id)) {
			return { kind: 'failed', detail: 'the session id is not one the CLI could have issued' };
		}
		return this.read(['session', 'tokens', '--json', END_OF_OPTIONS, id], 'session_id');
	}

	async checkpoint(id: string): Promise<TokenReportResult> {
		if (!isCheckpointId(id)) {
			return { kind: 'failed', detail: 'the checkpoint id is not one the CLI could have issued' };
		}
		return this.read(['checkpoint', 'tokens', '--json', END_OF_OPTIONS, id], 'checkpoint_id');
	}

	private async read(
		args: string[],
		idKey: 'session_id' | 'checkpoint_id',
	): Promise<TokenReportResult> {
		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeTokenReport(value, idKey)),
			{ cwd: this.options.workspaceRoot() },
		);
		return result.ok
			? { kind: 'found', report: result.value }
			: { kind: 'failed', detail: result.detail };
	}
}
