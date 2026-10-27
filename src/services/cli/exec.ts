import { execFile } from 'child_process';

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
}

/** The outcome of running a process. */
export type ExecOutcome =
	| {
			readonly ok: true;
			readonly stdout: string;
			readonly stderr: string;
			readonly exitCode: number;
			readonly durationMs: number;
	  }
	| {
			readonly ok: false;
			readonly reason: 'timeout' | 'exit-code' | 'spawn-failed';
			readonly detail: string;
			readonly stdout: string;
			readonly stderr: string;
			/** The code the process exited with, when it ran and exited. */
			readonly exitCode: number | undefined;
			readonly durationMs: number;
	  };

/** The most output the extension will read from one command. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** A short, safe excerpt of output for an error message. */
function excerpt(text: string): string {
	const collapsed = text.replace(/\s+/g, ' ').trim();
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}...` : collapsed;
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
 */
export function execute(
	binary: string,
	args: readonly string[],
	options: ExecOptions,
): Promise<ExecOutcome> {
	const startedAt = Date.now();

	return new Promise<ExecOutcome>(resolve => {
		const child = execFile(
			binary,
			[...args],
			{
				cwd: options.cwd,
				timeout: options.timeoutMs,
				env: options.env ?? process.env,
				encoding: 'utf8',
				maxBuffer: MAX_BUFFER_BYTES,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				const durationMs = Date.now() - startedAt;
				const out = stdout ?? '';
				const err = stderr ?? '';

				if (!error) {
					resolve({ ok: true, stdout: out, stderr: err, exitCode: 0, durationMs });
					return;
				}

				const killed = (error as { killed?: boolean }).killed === true;
				if (killed) {
					resolve({
						ok: false,
						reason: 'timeout',
						detail: `the command did not finish within ${options.timeoutMs}ms`,
						stdout: out,
						stderr: err,
						exitCode: undefined,
						durationMs,
					});
					return;
				}

				const code = (error as { code?: string | number }).code;
				if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
					resolve({
						ok: false,
						reason: 'spawn-failed',
						detail: `the command could not be started: ${String(code)}`,
						stdout: out,
						stderr: err,
						exitCode: undefined,
						durationMs,
					});
					return;
				}

				const exitCode = typeof code === 'number' ? code : -1;
				const detail =
					err.trim().length > 0 ? excerpt(err) : `the command exited with code ${exitCode}`;
				resolve({
					ok: false,
					reason: 'exit-code',
					detail,
					stdout: out,
					stderr: err,
					exitCode,
					durationMs,
				});
			},
		);

		if (options.input !== undefined) {
			child.stdin?.end(options.input);
		}
	});
}
