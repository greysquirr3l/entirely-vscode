import { execute, type ExecOptions } from './exec';
import { parseJson } from './json';
import { CliLocator } from './locator';
import { parseUsage } from './usage';
import type { CliCommandUsage, CliResult } from './types';

/** How long a CLI command may run before it is killed. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** How a single command should be run. */
export interface RunOptions {
	/** The working directory for the command, usually the workspace root. */
	readonly cwd?: string;
	/** How long the command may run. */
	readonly timeoutMs?: number;
	/** Text to write to the command's stdin. */
	readonly input?: string;
	/** The environment for the command. */
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * The one place that runs the Entire CLI.
 *
 * Nothing else in the extension spawns a process: every command goes
 * through here, so timeouts, output capture and the failure taxonomy are
 * decided once.
 *
 * Nothing here throws. A missing CLI, a broken CLI, a timeout, a non-zero
 * exit and a malformed response are all values, because every one of them
 * is a state the extension has to survive.
 */
export class CliRunner {
	constructor(private readonly locator: CliLocator = new CliLocator()) {}

	/** The discovery result for the CLI, running a lookup if it is stale. */
	discover(): Promise<Awaited<ReturnType<CliLocator['current']>>> {
		return this.locator.current();
	}

	/** Forgets the cached discovery result. */
	invalidate(): void {
		this.locator.invalidate();
	}

	/**
	 * Runs a command and returns its output.
	 *
	 * The arguments are the CLI's own, so `run(['status', '--json'])`
	 * invokes `entire status --json`.
	 */
	async run(args: readonly string[], options: RunOptions = {}): Promise<CliResult> {
		const discovery = await this.locator.current();

		if (discovery.state === 'absent') {
			return {
				ok: false,
				reason: 'absent',
				detail: 'the Entire CLI is not installed',
				stdout: '',
				stderr: '',
				durationMs: 0,
			};
		}

		if (discovery.state === 'broken') {
			return {
				ok: false,
				reason: 'broken',
				detail: `the Entire CLI at ${discovery.path} is not usable: ${discovery.detail}`,
				stdout: '',
				stderr: '',
				durationMs: 0,
			};
		}

		const execOptions: ExecOptions = {
			cwd: options.cwd,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			input: options.input,
			env: options.env,
		};

		const outcome = await execute(discovery.path, args, execOptions);

		if (!outcome.ok) {
			return {
				ok: false,
				reason: outcome.reason === 'spawn-failed' ? 'spawn-failed' : outcome.reason,
				detail: outcome.detail,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				durationMs: outcome.durationMs,
			};
		}

		return {
			ok: true,
			value: outcome.stdout,
			stdout: outcome.stdout,
			stderr: outcome.stderr,
			durationMs: outcome.durationMs,
		};
	}

	/**
	 * Runs a command and reads its JSON payload.
	 *
	 * The decoder is supplied by the caller, so the shape of the payload is
	 * owned by the layer that knows it. A decoder that rejects the payload
	 * becomes an `invalid-output` failure rather than an exception.
	 */
	async runJson<T>(
		args: readonly string[],
		decode: (value: unknown) => T,
		options: RunOptions = {},
	): Promise<CliResult<T>> {
		const result = await this.run(args, options);

		if (!result.ok) {
			return result;
		}

		const parsed = parseJson(result.stdout);
		if (!parsed.ok) {
			return {
				ok: false,
				reason: 'invalid-output',
				detail: parsed.detail,
				stdout: result.stdout,
				stderr: result.stderr,
				durationMs: result.durationMs,
			};
		}

		try {
			return { ...result, value: decode(parsed.value) };
		} catch (error) {
			return {
				ok: false,
				reason: 'invalid-output',
				detail: error instanceof Error ? error.message : String(error),
				stdout: result.stdout,
				stderr: result.stderr,
				durationMs: result.durationMs,
			};
		}
	}

	/**
	 * Reads the CLI's own usage for a command.
	 *
	 * The CLI is the source of truth for its own flags, so callers read them
	 * from here rather than hardcoding a list that can drift.
	 */
	async usage(command: string, options: RunOptions = {}): Promise<CliResult<CliCommandUsage>> {
		const args = command.length > 0 ? ['agent-help', command] : ['agent-help'];
		const result = await this.run(args, options);

		if (!result.ok) {
			return result;
		}

		return { ...result, value: parseUsage(command, result.stdout) };
	}
}
