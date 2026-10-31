import { spawn } from 'child_process';

import type { CliInvocation, CliInvocationOutcome, CliInvocationSink } from './invocation';
import type { CliLocator } from './locator';

/** How a stream ended. */
export type StreamEnd =
	| { readonly kind: 'exited'; readonly code: number; readonly stderr: string }
	| { readonly kind: 'stopped' }
	| { readonly kind: 'spawn-failed'; readonly detail: string }
	| { readonly kind: 'no-cli'; readonly detail: string };

/** A running stream, and the means to end it. */
export interface StreamHandle {
	/** Ends the stream. Safe to call at any time and more than once. */
	stop(): void;
	/** Settles once, when the stream is over. Never rejects. */
	readonly done: Promise<StreamEnd>;
}

/** How one stream is run. */
export interface StreamOptions {
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	/** Called with each complete line of stdout, without its line break. */
	readonly onLine: (line: string) => void;
	/** Ends the stream when it aborts. */
	readonly signal?: AbortSignal;
	/** Flags whose values are left out of the recorded command line. */
	readonly redactFlags?: readonly string[];
}

/** What the runner hands the stream: the parts of itself a stream shares with a run. */
export interface StreamDependencies {
	readonly locator: CliLocator;
	/** The saved login the command acts as, already decided. */
	readonly context: string | undefined;
	/** The arguments to run: the command's own, with the login's override in front when there is one. */
	readonly effectiveArgs: readonly string[];
	readonly sink: CliInvocationSink | undefined;
	/** The arguments as they are reported, with typed values left out. */
	readonly report: (args: readonly string[]) => string[];
}

/** How much of the CLI's stderr is kept for the message that explains a failure. */
export const STDERR_TAIL_BYTES = 4096;

/** How long a stopped process may take to exit before it is killed outright. */
export const KILL_GRACE_MS = 2000;

/** The longest unfinished line held while waiting for its line break. */
const MAX_PENDING_LINE = 1024 * 1024;

/**
 * Cuts a stream of chunks into lines.
 *
 * A line may arrive in several chunks and the last line may have no break,
 * so the unfinished part is held until the next chunk or the end.
 */
export class LineSplitter {
	private pending = '';

	/** Adds a chunk and returns the lines it completed. */
	push(chunk: string): string[] {
		const text = this.pending + chunk;
		const parts = text.split(/\r?\n/);
		const rest = parts.pop() ?? '';
		this.pending = rest.length > MAX_PENDING_LINE ? '' : rest;
		return parts;
	}

	/** The final line, when the stream ended without a line break. */
	flush(): string | undefined {
		const last = this.pending;
		this.pending = '';
		return last.length > 0 ? last : undefined;
	}
}

/** Keeps the last bytes of a stream. */
class Tail {
	private text = '';

	add(chunk: string): void {
		this.text = (this.text + chunk).slice(-STDERR_TAIL_BYTES);
	}

	get value(): string {
		return this.text;
	}
}

function record(
	deps: StreamDependencies,
	binary: string,
	args: readonly string[],
	options: StreamOptions,
	outcome: CliInvocationOutcome,
	exitCode: number | undefined,
	detail: string | undefined,
	durationMs: number,
): void {
	const invocation: CliInvocation = {
		binary,
		args: deps.report(args),
		cwd: options.cwd,
		outcome,
		exitCode,
		durationMs,
		inputBytes: 0,
		stdoutBytes: 0,
		stderrBytes: 0,
		detail,
	};
	deps.sink?.report(invocation, {});
}

/**
 * Starts a command that streams, and calls back with each line it prints.
 *
 * It resolves the binary and the login the way a run does, spawns the
 * process once, and never throws: a missing CLI and a process that cannot
 * start are values on `done`. Nothing it prints is written to the output
 * channel. One entry records the start and one the end, with the typed
 * values of the arguments left out, and only the last few kilobytes of
 * stderr are kept, to explain a failure. There is no timeout, because a
 * stream is meant to last; the caller stops it, or aborts the signal.
 */
export function startStream(deps: StreamDependencies, options: StreamOptions): StreamHandle {
	const effective = [...deps.effectiveArgs];
	let stopRequested = false;
	let kill: (() => void) | undefined;

	const stop = (): void => {
		stopRequested = true;
		kill?.();
	};

	const done = new Promise<StreamEnd>(resolve => {
		const startedAt = Date.now();

		void deps.locator.current().then(discovery => {
			if (discovery.state !== 'available') {
				const detail =
					discovery.state === 'absent'
						? 'the Entire CLI is not installed'
						: `the Entire CLI at ${discovery.path} is not usable: ${discovery.detail}`;
				record(deps, discovery.state === 'absent' ? 'entire' : discovery.path, effective, options, discovery.state, undefined, detail, 0);
				resolve({ kind: 'no-cli', detail });
				return;
			}
			if (stopRequested || options.signal?.aborted) {
				resolve({ kind: 'stopped' });
				return;
			}

			const splitter = new LineSplitter();
			const stderr = new Tail();
			let settled = false;
			let grace: NodeJS.Timeout | undefined;

			const child = spawn(discovery.path, effective, {
				cwd: options.cwd,
				env: deps.context ? { ...(options.env ?? process.env), ENTIRE_CONTEXT: deps.context } : (options.env ?? process.env),
				shell: false,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			record(deps, discovery.path, effective, options, 'ok', undefined, 'streaming', 0);

			const finish = (end: StreamEnd, outcome: CliInvocationOutcome, exitCode: number | undefined, detail: string | undefined): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (grace) {
					clearTimeout(grace);
				}
				options.signal?.removeEventListener('abort', stop);
				record(deps, discovery.path, effective, options, outcome, exitCode, detail, Date.now() - startedAt);
				resolve(end);
			};

			kill = () => {
				child.stdout?.destroy();
				child.stderr?.destroy();
				child.kill('SIGTERM');
				// A process that ignores the signal is killed after a grace period,
				// so `done` always settles. The timer is cleared when it exits.
				if (!settled && !grace) {
					grace = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
				}
			};
			if (options.signal) {
				options.signal.addEventListener('abort', stop, { once: true });
			}

			child.stdout?.setEncoding('utf8');
			child.stdout?.on('data', (chunk: string) => {
				if (stopRequested) {
					return;
				}
				for (const line of splitter.push(chunk)) {
					options.onLine(line);
				}
			});
			child.stderr?.setEncoding('utf8');
			child.stderr?.on('data', (chunk: string) => stderr.add(chunk));

			child.on('error', (error: NodeJS.ErrnoException) => {
				const detail = `the command could not be started: ${String(error.code ?? error.message)}`;
				finish({ kind: 'spawn-failed', detail }, 'spawn-failed', undefined, detail);
			});

			child.on('close', (code: number | null) => {
				if (stopRequested) {
					finish({ kind: 'stopped' }, 'cancelled', undefined, 'the stream was stopped');
					return;
				}
				const last = splitter.flush();
				if (last !== undefined) {
					options.onLine(last);
				}
				const exitCode = code ?? -1;
				finish(
					{ kind: 'exited', code: exitCode, stderr: stderr.value },
					exitCode === 0 ? 'ok' : 'exit-code',
					exitCode,
					exitCode === 0 ? undefined : `the command exited with code ${exitCode}`,
				);
			});

			// A stop that came while the process was starting.
			if (stopRequested) {
				kill();
			}
		});
	});

	return { stop, done };
}
