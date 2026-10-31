import { describesCommand, failureDetail, pickFlags, type FlagWant } from '../lib/entire';
import type { HelpFlag } from '../lib/entire';
import type { CliRunner } from './cli';

/** Why a command could not be used, before anything ran. */
export type Unavailable =
	/** The CLI is missing or unusable. */
	| { readonly kind: 'noCli'; readonly detail: string }
	/** This version of the CLI does not describe the command or a flag it needs. */
	| { readonly kind: 'unsupported'; readonly detail: string }
	/** The help could not be read for another reason. */
	| { readonly kind: 'failed'; readonly detail: string };

export type HelpRead<K extends string> =
	| {
			readonly ok: true;
			readonly raw: string;
			readonly flags: Readonly<Partial<Record<K, string>>>;
			readonly table: readonly HelpFlag[];
	  }
	| ({ readonly ok: false } & Unavailable);

/** What is said when the CLI has no such command. It names the command and the way out. */
export function describeMissingCommand(command: string, purpose: string): string {
	return `this version of the Entire CLI has no '${command}' command, so it cannot ${purpose}; update the CLI`;
}

export interface HelpOptions {
	readonly cwd: string | undefined;
	readonly timeoutMs: number;
}

/**
 * Reads a labs command's own `--help` and picks its flags.
 *
 * `agent-help` does not know these commands, so their help is the only
 * source of their flags. It is read for every call and never cached. A CLI
 * that lacks the command answers with the top-level help, which does not
 * describe the command, and that is reported as unsupported before anything
 * runs.
 */
export async function readCommandHelp<K extends string>(
	runner: CliRunner,
	command: string,
	purpose: string,
	wants: Readonly<Record<K, FlagWant>>,
	options: HelpOptions,
): Promise<HelpRead<K>> {
	const help = await runner.help(command, { cwd: options.cwd, timeoutMs: options.timeoutMs, withholdBodies: true });
	if (!help.ok) {
		if (help.reason === 'absent') {
			return { ok: false, kind: 'noCli', detail: `the Entire CLI is not installed; install it to ${purpose}` };
		}
		if (help.reason === 'broken') {
			return { ok: false, kind: 'noCli', detail: help.detail };
		}
		if (help.reason === 'exit-code') {
			return { ok: false, kind: 'unsupported', detail: describeMissingCommand(command, purpose) };
		}
		return { ok: false, kind: 'failed', detail: failureDetail(help.stderr, '', help.detail) };
	}
	if (!describesCommand(help.value.raw, command)) {
		return { ok: false, kind: 'unsupported', detail: describeMissingCommand(command, purpose) };
	}
	const picked = pickFlags(command, help.value.raw, [], wants);
	if (!picked.ok) {
		return { ok: false, kind: 'unsupported', detail: picked.detail };
	}
	return { ok: true, raw: help.value.raw, flags: picked.flags, table: picked.table };
}
