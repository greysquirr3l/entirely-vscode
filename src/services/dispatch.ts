import {
	DISPATCH_WANTS,
	describeHelpFailure,
	dispatchArguments,
	failureDetail,
	invalidDispatchRequest,
	readCommandFlags,
	readDefaultValue,
	staticEnvironment,
	stripTerminalCodes,
	withSignInHint,
	describeFlag,
	type AccountContext,
	type DispatchFlags,
	type DispatchOutcome,
	type DispatchRequest,
} from '../lib/entire';
import type { CliRunner } from './cli';
import type { Read } from './controlPlane';

/** What the CLI's help says a dispatch can be asked for. */
export interface DispatchCapabilities {
	readonly local: boolean;
	readonly window: boolean;
	/** The window the CLI uses when none is given, from its help. */
	readonly defaultWindow?: string;
	readonly jurisdiction: boolean;
	/** The repository the CLI says it acts on. */
	readonly repository?: string;
}

/** Where dispatches are generated. */
export interface DispatchSource {
	capabilities(): Promise<Read<DispatchCapabilities>>;
	/** Generates one dispatch as the named login. Runs once and is never retried. */
	generate(request: DispatchRequest, acting: AccountContext, signal?: AbortSignal): Promise<DispatchOutcome>;
}

export interface DispatchOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, a dispatch may take. A local agent can be slow. */
	readonly timeoutSeconds: () => number;
}

const PURPOSE = 'generate a dispatch';

/**
 * Generates a dispatch through `entire dispatch`.
 *
 * It starts work on Entire's servers or in a local agent, so the caller
 * confirms first and this class runs it exactly once: a failure, a
 * timeout and a cancel each end the attempt. The command is run with
 * flags, so it prints its markdown instead of opening its wizard. The
 * login it runs as is the one that was confirmed. The text is a summary
 * of the user's prompts and code, so it is kept out of the invocation
 * record and returned only to the caller.
 */
export class DispatchService implements DispatchSource {
	constructor(private readonly options: DispatchOptions) {}

	private async prepare(): Promise<Read<{ flags: DispatchFlags; capabilities: DispatchCapabilities }>> {
		const usage = await this.options.runner.usage('dispatch', { cwd: this.options.workspaceRoot() });
		if (!usage.ok) {
			return { ok: false, detail: describeHelpFailure('dispatch', PURPOSE, usage.reason, usage.detail) };
		}
		const picked = readCommandFlags('dispatch', usage.value.raw, usage.value.flags, DISPATCH_WANTS);
		if (!picked.ok) {
			return picked;
		}
		const { flags } = picked;
		return {
			ok: true,
			value: {
				flags,
				capabilities: {
					local: flags.local !== undefined,
					window: flags.since !== undefined,
					defaultWindow: flags.since ? readDefaultValue(describeFlag(picked.table, flags.since)) : undefined,
					jurisdiction: flags.jurisdiction !== undefined,
					repository: picked.currentRepo,
				},
			},
		};
	}

	async capabilities(): Promise<Read<DispatchCapabilities>> {
		const prepared = await this.prepare();
		return prepared.ok ? { ok: true, value: prepared.value.capabilities } : prepared;
	}

	async generate(request: DispatchRequest, acting: AccountContext, signal?: AbortSignal): Promise<DispatchOutcome> {
		const prepared = await this.prepare();
		if (!prepared.ok) {
			return { kind: 'failed', detail: prepared.detail };
		}
		const { flags } = prepared.value;
		const invalid = invalidDispatchRequest(request, flags);
		if (invalid) {
			return { kind: 'failed', detail: invalid };
		}

		const result = await this.options.runner.run(dispatchArguments(flags, request), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: acting.name,
			env: staticEnvironment(),
			withholdBodies: true,
			signal,
		});

		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled' };
			}
			if (result.reason === 'timeout') {
				return { kind: 'failed', detail: `${result.detail}; raise entirely.dispatchTimeout if the dispatch needs longer` };
			}
			return { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
		}
		const text = stripTerminalCodes(result.stdout).trim();
		return text.length > 0 ? { kind: 'done', text } : { kind: 'empty' };
	}
}
