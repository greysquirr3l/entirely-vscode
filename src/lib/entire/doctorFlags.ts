import { pickFlags, type FlagWant } from './controlPlaneFlags';
import { readCurrentRepo } from './workSearchFlags';
import type { HelpFlag } from './search';

/** The four deeper subcommands of `entire doctor` that the editor reaches. */
export type DoctorSubcommand = 'logs' | 'trace' | 'bundle' | 'migrate-checkpoints';

/**
 * What the extension needs from each subcommand's flags, found by what the
 * CLI's help says about them. The tables below are only the fallback for a
 * help text that cannot be parsed (0.12.2); a flag that is not in the
 * help is never passed.
 */
export const DOCTOR_LOG_WANTS = {
	tail: { name: /tail/, description: /\blast\s+N\s+lines\b/i, required: true },
	// Picked only so nothing else claims it: the extension never passes it.
	follow: { name: /follow/, description: /\bstream\b/i },
} as const satisfies Record<string, FlagWant>;

export const DOCTOR_TRACE_WANTS = {
	last: { name: /last/, description: /\blast\s+N\b/i },
	hook: { name: /hook/, description: /\bfilter by hook\b/i },
	slow: { name: /slow/, description: /\bflagged slow\b/i },
	summary: { name: /summary/, description: /\baggregate\b/i },
} as const satisfies Record<string, FlagWant>;

export const DOCTOR_BUNDLE_WANTS = {
	out: { name: /^--out$/, description: /\bpath\b.*\bwrite\b|\bwrite\b.*\bpath\b/i, required: true },
	raw: { name: /raw/, description: /\bskip\b.*\bredaction\b/i },
} as const satisfies Record<string, FlagWant>;

export const DOCTOR_MIGRATE_WANTS = {
	dryRun: { name: /dry-run/, description: /\bwithout writing\b/i, required: true },
} as const satisfies Record<string, FlagWant>;

/** The 0.12.2 flag tables, used only when a help text cannot be parsed. */
export const DOCTOR_FALLBACK: Readonly<Record<DoctorSubcommand, readonly HelpFlag[]>> = {
	logs: [
		{ name: '--follow', description: 'Stream new log lines as they are written' },
		{ name: '--tail', description: 'Show the last N lines (use 0 for all) (default 100)' },
	],
	trace: [
		{ name: '--hook', description: 'Filter by hook type' },
		{ name: '--last', description: 'Show last N hook invocations (default 1)' },
		{ name: '--slow', description: 'Only include traces flagged slow (those logged at WARN)' },
		{ name: '--summary', description: 'Aggregate across traces instead of showing each one' },
	],
	bundle: [
		{ name: '--out', description: 'Path to write the bundle archive (default: OS temp dir)' },
		{ name: '--raw', description: 'Skip secret redaction.' },
	],
	'migrate-checkpoints': [{ name: '--dry-run', description: 'Report what would be migrated without writing refs' }],
};

export type LogFlags = Readonly<Partial<Record<keyof typeof DOCTOR_LOG_WANTS, string>>>;
export type TraceFlags = Readonly<Partial<Record<keyof typeof DOCTOR_TRACE_WANTS, string>>>;
export type BundleFlags = Readonly<Partial<Record<keyof typeof DOCTOR_BUNDLE_WANTS, string>>>;
export type MigrateFlags = Readonly<Partial<Record<keyof typeof DOCTOR_MIGRATE_WANTS, string>>>;

/** The flags a subcommand's help offers, or why it cannot be used. */
export type DoctorFlagPick<F> =
	| { readonly ok: true; readonly flags: F; readonly repository: string | undefined }
	| { readonly ok: false; readonly detail: string };

function pick<K extends string>(
	sub: DoctorSubcommand,
	help: string,
	wants: Readonly<Record<K, FlagWant>>,
): DoctorFlagPick<Readonly<Partial<Record<K, string>>>> {
	const picked = pickFlags(`doctor ${sub}`, help, DOCTOR_FALLBACK[sub], wants);
	return picked.ok ? { ok: true, flags: picked.flags, repository: readCurrentRepo(help) } : picked;
}

export function pickLogFlags(help: string): DoctorFlagPick<LogFlags> {
	return pick('logs', help, DOCTOR_LOG_WANTS);
}

export function pickTraceFlags(help: string): DoctorFlagPick<TraceFlags> {
	return pick('trace', help, DOCTOR_TRACE_WANTS);
}

export function pickBundleFlags(help: string): DoctorFlagPick<BundleFlags> {
	return pick('bundle', help, DOCTOR_BUNDLE_WANTS);
}

export function pickMigrateFlags(help: string): DoctorFlagPick<MigrateFlags> {
	return pick('migrate-checkpoints', help, DOCTOR_MIGRATE_WANTS);
}

/** The line count used when a value cannot be trusted. */
export const DEFAULT_LOG_LINES = 200;

/**
 * `entire doctor logs`, bounded.
 *
 * The line count is always at least one: the CLI reads zero as "the whole
 * file", which has no bound. The follow flag is never added.
 */
export function logArguments(tail: string, lines: number): readonly string[] {
	const count = Number.isFinite(lines) ? Math.max(1, Math.floor(lines)) : DEFAULT_LOG_LINES;
	return ['doctor', 'logs', `${tail}=${count}`];
}

/** What the person asked of the trace command. */
export interface TraceRequest {
	readonly last?: number;
	readonly hook?: string;
	readonly slow?: boolean;
	readonly summary?: boolean;
}

/** `entire doctor trace`, with only the options the help described. */
export function traceArguments(flags: TraceFlags, request: TraceRequest): readonly string[] {
	const args = ['doctor', 'trace'];
	if (request.summary && flags.summary) {
		args.push(flags.summary);
	}
	if (request.slow && flags.slow) {
		args.push(flags.slow);
	}
	if (request.last !== undefined && flags.last) {
		args.push(`${flags.last}=${Math.max(1, Math.floor(request.last))}`);
	}
	if (request.hook && flags.hook && isHookName(request.hook)) {
		args.push(`${flags.hook}=${request.hook}`);
	}
	return args;
}

/**
 * Whether a value can be passed as a hook name.
 *
 * The CLI's list of hook names is not published, so this checks only the
 * shape: lower-case words joined by hyphens, which cannot be read as a flag.
 */
export function isHookName(value: string): boolean {
	return /^[a-z][a-z0-9-]{0,40}$/.test(value);
}

/**
 * `entire doctor bundle`. The path is a separate argument so the recorder
 * can hide it (the flag is passed to `redactFlags`). The raw flag is added
 * only when asked for and only when the help described it.
 */
export function bundleArguments(flags: { readonly out: string; readonly raw?: string }, file: string, raw: boolean): readonly string[] {
	return ['doctor', 'bundle', flags.out, file, ...(raw && flags.raw ? [flags.raw] : [])];
}

/** `entire doctor migrate-checkpoints` as a dry run. */
export function migrateDryRunArguments(dryRun: string): readonly string[] {
	return ['doctor', 'migrate-checkpoints', dryRun];
}

/**
 * `entire doctor migrate-checkpoints` as the real thing. No flag follows:
 * with no terminal the CLI never pushes, and the extension never names a
 * remote that could change that.
 */
export function migrateApplyArguments(): readonly string[] {
	return ['doctor', 'migrate-checkpoints'];
}
