import { spawn } from 'child_process';

/** How a CLI invocation should be run. */
export interface ExecOptions {
	/** The working directory for the command. */
	readonly cwd?: string;
	/** How long the command may run before it is killed. */
	readonly timeoutMs: number;
	/** Text to write to the command's stdin. */
	readonly input?: string;
	/** The environment for the command. Defaults to this process's. */
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * Called with each piece of stdout as it arrives.
	 *
	 * A command that waits for a person — a sign-in that needs a code
	 * entered in a browser — produces the thing the person needs long
	 * before the command finishes, and a caller that cannot see the
	 * output until the end has nothing to show them in the meantime.
	 */
	readonly onStdout?: (chunk: string) => void;
	/** Called with each piece of stderr as it arrives. */
	readonly onStderr?: (chunk: string) => void;
	/** Kills the process when it aborts, so a long command can be cancelled. */
	readonly signal?: AbortSignal;
}

/** The outcome of running a process. */
export type ExecOutcome =
	| {
			readonly ok: true;
			readonly stdout: string;
			readonly stderr: string;
			readonly exitCode: number;
			readonly durationMs: number;
			/** True when more output was printed than the extension reads, so the text here is cut short. */
			readonly truncated: boolean;
	  }
	| {
			readonly ok: false;
			readonly reason: 'timeout' | 'exit-code' | 'spawn-failed' | 'cancelled';
			readonly detail: string;
			readonly stdout: string;
			readonly stderr: string;
			/** The code the process exited with, when it ran and exited. */
			readonly exitCode: number | undefined;
			readonly durationMs: number;
			readonly truncated: boolean;
	  };

/** The most output the extension will read from one command. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Collects what a process wrote, up to a limit.
 *
 * The limit matters because a command that printed without end would
 * otherwise fill the memory of the extension host. What is past the limit
 * is dropped, because a payload that is too large is not one the
 * extension could read anyway.
 */
class BoundedBuffer {
	private readonly chunks: string[] = [];
	private size = 0;
	private truncated = false;

	/** Adds a piece of output. */
	add(chunk: string): void {
		if (this.truncated) {
			return;
		}

		const size = Buffer.byteLength(chunk, 'utf8');
		if (this.size + size > MAX_BUFFER_BYTES) {
			this.truncated = true;
			return;
		}

		this.size += size;
		this.chunks.push(chunk);
	}

	/** Whether output past the limit was dropped. */
	get wasTruncated(): boolean {
		return this.truncated;
	}

	/** What was collected. */
	get text(): string {
		return this.chunks.join('');
	}
}

/**
 * Runs a command and captures its output.
 *
 * stdout and stderr are captured separately and never merged: the CLI
 * writes its payload to stdout and its diagnostics to stderr, and merging
 * them would corrupt the payload.
 *
 * The command is always bounded by a timeout. A CLI that hangs is not a
 * CLI the extension can wait for, so the process is killed and the timeout
 * is reported as a failure.
 *
 * The failure detail says what went wrong and never quotes what the
 * command wrote. stderr is where a CLI puts its diagnostics, but it is
 * also where a CLI that is handed a prompt body may echo it back, and
 * this detail reaches a status bar tooltip, a notification and a report
 * the extension offers to copy into a public issue. The output itself is
 * behind the explicit command that dumps the last invocation.
 */
export function execute(
	binary: string,
	args: readonly string[],
	options: ExecOptions,
): Promise<ExecOutcome> {
	const startedAt = Date.now();

	return new Promise<ExecOutcome>(resolve => {
		const stdout = new BoundedBuffer();
		const stderr = new BoundedBuffer();

		const child = spawn(binary, [...args], {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: false,
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let settled = false;

		/** Finishes the invocation, once. */
		const finish = (outcome: ExecOutcome): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', cancel);
			resolve(outcome);
		};

		const timer = setTimeout(() => {
			// The streams are closed before the process is killed, because
			// a command that leaves a grandchild behind keeps the pipes
			// open, and the invocation would then wait for that grandchild
			// rather than for the command it asked about.
			child.stdout?.destroy();
			child.stderr?.destroy();
			child.kill('SIGTERM');

			finish({
				ok: false,
				reason: 'timeout',
				detail: `the command did not finish within ${options.timeoutMs}ms`,
				stdout: stdout.text,
				stderr: stderr.text,
				exitCode: undefined,
				durationMs: Date.now() - startedAt,
				truncated: stdout.wasTruncated || stderr.wasTruncated,
			});
		}, options.timeoutMs);

		const cancel = (): void => {
			child.stdout?.destroy();
			child.stderr?.destroy();
			child.kill('SIGTERM');
			finish({
				ok: false,
				reason: 'cancelled',
				detail: 'the command was cancelled',
				stdout: stdout.text,
				stderr: stderr.text,
				exitCode: undefined,
				durationMs: Date.now() - startedAt,
				truncated: stdout.wasTruncated || stderr.wasTruncated,
			});
		};
		if (options.signal?.aborted) {
			cancel();
		} else {
			options.signal?.addEventListener('abort', cancel, { once: true });
		}

		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			stdout.add(chunk);
			options.onStdout?.(chunk);
		});

		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			stderr.add(chunk);
			options.onStderr?.(chunk);
		});

		child.on('error', (error: NodeJS.ErrnoException) => {
			finish({
				ok: false,
				reason: 'spawn-failed',
				detail: `the command could not be started: ${String(error.code ?? error.message)}`,
				stdout: stdout.text,
				stderr: stderr.text,
				exitCode: undefined,
				durationMs: Date.now() - startedAt,
				truncated: stdout.wasTruncated || stderr.wasTruncated,
			});
		});

		child.on('close', (code: number | null) => {
			const durationMs = Date.now() - startedAt;
			const exitCode = code ?? -1;

			if (exitCode === 0) {
				finish({
					ok: true,
					stdout: stdout.text,
					stderr: stderr.text,
					exitCode: 0,
					durationMs,
					truncated: stdout.wasTruncated || stderr.wasTruncated,
				});
				return;
			}

			finish({
				ok: false,
				reason: 'exit-code',
				detail: `the command exited with code ${exitCode}`,
				stdout: stdout.text,
				stderr: stderr.text,
				exitCode,
				durationMs,
				truncated: stdout.wasTruncated || stderr.wasTruncated,
			});
		});

		if (options.input !== undefined) {
			child.stdin?.end(options.input);
		} else {
			child.stdin?.end();
		}
	});
}
