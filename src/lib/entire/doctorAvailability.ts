import type { DoctorSubcommand } from './doctorFlags';

/** Why a doctor subcommand cannot be used, or the flags it can be used with. */
export type DoctorSubcommandCheck<F> =
	| { readonly ok: true; readonly flags: F; readonly repository: string | undefined }
	/** There is no usable CLI. */
	| { readonly ok: false; readonly reason: 'no-cli'; readonly detail: string }
	/** The CLI is there and has no such subcommand. */
	| { readonly ok: false; readonly reason: 'unsupported'; readonly detail: string; readonly version: string }
	/** The subcommand is there, but its help does not describe a flag the extension cannot do without. */
	| { readonly ok: false; readonly reason: 'unavailable'; readonly detail: string }
	/** The lookup itself failed: a timeout, a crash. */
	| { readonly ok: false; readonly reason: 'failed'; readonly detail: string };

/** The line for a CLI that lacks a subcommand. It names the subcommand and the version. */
export function describeMissingSubcommand(sub: DoctorSubcommand, version: string): string {
	return `This Entire CLI (${version}) has no \`doctor ${sub}\` command. Update the CLI to use it.`;
}

/** The line for a CLI that is not there. */
export function describeNoCli(installCommand: string): string {
	return `The Entire CLI is not installed. Install it with: ${installCommand}`;
}
