import {
	PROFILE_WANTS,
	decodeTokenProfile,
	failureDetail,
	isEmptyProfile,
	profileArguments,
	staticEnvironment,
	unwrap,
	type ProfileScope,
	type TokenProfile,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { readCommandHelp, type Unavailable } from './commandHelp';

/** What reading the profile came to. */
export type ProfileOutcome =
	| { readonly kind: 'found'; readonly profile: TokenProfile }
	/** The CLI analysed no checkpoints: there is no history to profile. */
	| { readonly kind: 'empty' }
	| Unavailable;

export interface TokenProfileSource {
	read(scope: ProfileScope): Promise<ProfileOutcome>;
}

export interface TokenProfileOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, the profile may take. */
	readonly timeoutSeconds: () => number;
}

const PURPOSE = 'show a token profile';

/**
 * Reads `entire tokens profile --json`.
 *
 * The command reads committed checkpoint metadata only, so it spends no
 * tokens and writes nothing, but it still runs only when the person asks.
 * Its flags come from its own help, read for every call. The output is
 * kept out of the invocation record.
 */
export class TokenProfileService implements TokenProfileSource {
	constructor(private readonly options: TokenProfileOptions) {}

	async read(scope: ProfileScope): Promise<ProfileOutcome> {
		const cwd = this.options.workspaceRoot();
		const timeoutMs = this.options.timeoutSeconds() * 1000;
		const help = await readCommandHelp(this.options.runner, 'tokens profile', PURPOSE, PROFILE_WANTS, { cwd, timeoutMs });
		if (!help.ok) {
			return help;
		}
		const args = profileArguments(help.flags, scope);
		if (!args) {
			return { kind: 'unsupported', detail: "this version of the Entire CLI does not describe the flag for that scope of 'tokens profile'; update the CLI" };
		}
		const result = await this.options.runner.runJson(args, value => unwrap(decodeTokenProfile(value)), {
			cwd,
			timeoutMs,
			env: staticEnvironment(),
			withholdBodies: true,
		});
		if (!result.ok) {
			if (result.reason === 'absent' || result.reason === 'broken') {
				return { kind: 'noCli', detail: result.detail };
			}
			return { kind: 'failed', detail: failureDetail(result.stderr, '', result.detail) };
		}
		return isEmptyProfile(result.value) ? { kind: 'empty' } : { kind: 'found', profile: result.value };
	}
}
