import {
	RECAP_WANTS,
	describeHelpFailure,
	failureDetail,
	recapArguments,
	recapPeriods,
	readCommandFlags,
	staticEnvironment,
	stripTerminalCodes,
	withSignInHint,
	type RecapPeriod,
} from '../lib/entire';
import type { CliRunner } from './cli';
import type { Read } from './controlPlane';

export type RecapOutcome =
	| { readonly kind: 'found'; readonly text: string }
	| { readonly kind: 'empty' }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where the recap comes from. */
export interface RecapSource {
	/** The periods the CLI's help describes. */
	periods(): Promise<Read<readonly RecapPeriod[]>>;
	read(period: RecapPeriod | undefined): Promise<RecapOutcome>;
}

export interface RecapOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	readonly timeoutSeconds: () => number;
}

const PURPOSE = 'see a recap';

/**
 * Reads `entire recap` in its static form.
 *
 * Without the flag that asks for static output the command opens an
 * interactive screen, so a CLI whose help does not describe that flag is
 * reported as too old and the command is not run at all.
 */
export class RecapService implements RecapSource {
	constructor(private readonly options: RecapOptions) {}

	private async prepare() {
		const usage = await this.options.runner.usage('recap', { cwd: this.options.workspaceRoot() });
		if (!usage.ok) {
			return { ok: false as const, detail: describeHelpFailure('recap', PURPOSE, usage.reason, usage.detail) };
		}
		const picked = readCommandFlags('recap', usage.value.raw, usage.value.flags, RECAP_WANTS);
		if (!picked.ok) {
			return { ok: false as const, detail: 'this version of the Entire CLI cannot print a recap as static text; update the CLI' };
		}
		return { ok: true as const, flags: picked.flags, table: picked.table };
	}

	async periods(): Promise<Read<readonly RecapPeriod[]>> {
		const prepared = await this.prepare();
		return prepared.ok ? { ok: true, value: recapPeriods(prepared.table, prepared.flags) } : prepared;
	}

	async read(period: RecapPeriod | undefined): Promise<RecapOutcome> {
		const prepared = await this.prepare();
		if (!prepared.ok) {
			return { kind: 'failed', detail: prepared.detail };
		}
		const known = period ? recapPeriods(prepared.table, prepared.flags).find(item => item.flag === period.flag) : undefined;
		if (period && !known) {
			return { kind: 'failed', detail: `this version of the Entire CLI no longer describes the "${period.label}" period; pick it again` };
		}
		const args = recapArguments(prepared.flags, prepared.table, known);
		if (!args) {
			return { kind: 'failed', detail: 'this version of the Entire CLI cannot print a recap as static text; update the CLI' };
		}
		const result = await this.options.runner.run(args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			env: staticEnvironment(),
			withholdBodies: true,
		});
		if (!result.ok) {
			return { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
		}
		const text = stripTerminalCodes(result.stdout).trim();
		return text.length > 0 ? { kind: 'found', text } : { kind: 'empty' };
	}
}
