import {
	bundleArguments,
	bundleOutcomeFromReadback,
	describeMissingSubcommand,
	failureDetail,
	logArguments,
	pickBundleFlags,
	pickLogFlags,
	pickMigrateFlags,
	pickTraceFlags,
	traceArguments,
	type AccountContext,
	type BundleFlags,
	type BundleOutcome,
	type DoctorFlagPick,
	type DoctorSubcommand,
	type DoctorSubcommandCheck,
	type LogFlags,
	type MigrateFlags,
	type TraceFlags,
	type TraceRequest,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { verifyBundle } from './bundleFile';

export interface DoctorDepthOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** The lines of the log to ask for. */
	readonly logLines: () => number;
	/** How long, in seconds, the log and trace reads may take. */
	readonly readTimeoutSeconds: () => number;
	/** How long, in seconds, the bundle may take. */
	readonly bundleTimeoutSeconds: () => number;
}

/** What a read of the log or the traces came to. The text is the CLI's own, unbounded. */
export type DepthRead =
	| { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
	| { readonly kind: 'empty' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

/** Which output is held in memory for saving whole. */
export type HeldKind = 'log' | 'trace';

/**
 * Reads the CLI's operational log, hook traces, and writes diagnostic bundles.
 *
 * Every flag is taken from the CLI's own help for the subcommand, and a
 * subcommand the CLI lacks is reported as lacking before anything runs. Each
 * run keeps its output out of the invocation record. The full text of the
 * last log and the last trace is held in memory only, so that it can be saved
 * to a file the person chooses.
 */
export class DoctorDepthService {
	private readonly held = new Map<HeldKind, string>();

	constructor(private readonly options: DoctorDepthOptions) {}

	/** The whole of the last output of a kind, held in memory only. */
	lastOutput(kind: HeldKind): string | undefined {
		return this.held.get(kind);
	}

	/** Whether a subcommand exists on this CLI, and the flags its help describes. */
	private async check<F>(
		sub: DoctorSubcommand,
		pick: (help: string) => DoctorFlagPick<F>,
	): Promise<DoctorSubcommandCheck<F>> {
		const discovery = await this.options.runner.discover();
		if (discovery.state === 'absent') {
			return { ok: false, reason: 'no-cli', detail: 'the Entire CLI is not installed' };
		}
		if (discovery.state === 'broken') {
			return { ok: false, reason: 'no-cli', detail: `the Entire CLI is not usable: ${discovery.detail}` };
		}

		const usage = await this.options.runner.usage(`doctor ${sub}`, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.readTimeoutSeconds() * 1000,
			withholdBodies: true,
		});
		if (!usage.ok) {
			if (usage.reason === 'exit-code') {
				return { ok: false, reason: 'unsupported', detail: describeMissingSubcommand(sub, discovery.version), version: discovery.version };
			}
			return { ok: false, reason: 'failed', detail: failureDetail(usage.stderr, '', usage.detail) };
		}

		const picked = pick(usage.value.raw);
		if (!picked.ok) {
			return { ok: false, reason: 'unavailable', detail: picked.detail };
		}
		return { ok: true, flags: picked.flags, repository: picked.repository };
	}

	checkLog(): Promise<DoctorSubcommandCheck<LogFlags>> {
		return this.check('logs', pickLogFlags);
	}

	checkTrace(): Promise<DoctorSubcommandCheck<TraceFlags>> {
		return this.check('trace', pickTraceFlags);
	}

	checkBundle(): Promise<DoctorSubcommandCheck<BundleFlags>> {
		return this.check('bundle', pickBundleFlags);
	}

	checkMigrate(): Promise<DoctorSubcommandCheck<MigrateFlags>> {
		return this.check('migrate-checkpoints', pickMigrateFlags);
	}

	/** Reads the last lines of the log. Needs the tail flag from `checkLog`. */
	async readLog(flags: LogFlags, signal?: AbortSignal): Promise<DepthRead> {
		if (!flags.tail) {
			return { kind: 'failed', detail: 'the help of this CLI does not describe how many lines to read' };
		}
		return this.read('log', logArguments(flags.tail, this.options.logLines()), signal);
	}

	/** Reads hook traces. */
	readTraces(flags: TraceFlags, request: TraceRequest, signal?: AbortSignal): Promise<DepthRead> {
		return this.read('trace', traceArguments(flags, request), signal);
	}

	private async read(kind: HeldKind, args: readonly string[], signal: AbortSignal | undefined): Promise<DepthRead> {
		this.held.delete(kind);
		const result = await this.options.runner.run(args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.readTimeoutSeconds() * 1000,
			withholdBodies: true,
			signal,
		});
		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled' };
			}
			return { kind: 'failed', detail: failureDetail(result.stderr, '', result.detail) };
		}
		const text = result.stdout;
		if (text.trim().length === 0) {
			return { kind: 'empty' };
		}
		this.held.set(kind, text);
		return { kind: 'text', text, truncated: result.truncated === true };
	}

	/**
	 * Writes a bundle to the path the person chose, then reads the file back.
	 *
	 * The CLI runs once as the given login. What it prints is not trusted: the
	 * file at the chosen path is what is checked.
	 */
	async writeBundle(
		flags: { readonly out: string; readonly raw?: string },
		file: string,
		raw: boolean,
		acting: AccountContext | undefined,
		signal?: AbortSignal,
	): Promise<BundleOutcome> {
		const result = await this.options.runner.run(bundleArguments(flags, file, raw), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.bundleTimeoutSeconds() * 1000,
			context: acting?.name,
			withholdBodies: true,
			redactFlags: [flags.out],
			signal,
		});
		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled', file };
			}
			return { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		return bundleOutcomeFromReadback(file, await verifyBundle(file), raw);
	}
}
