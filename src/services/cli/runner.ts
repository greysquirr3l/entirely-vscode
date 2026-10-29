import { execute, type ExecOptions } from './exec';
import { parseJson } from './json';
import { CliLocator } from './locator';
import { parseUsage } from './usage';
import {
	byteLength,
	type CliInvocation,
	type CliInvocationBodies,
	type CliInvocationSink,
} from './invocation';
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
	/**
	 * Called with each piece of stdout as it arrives.
	 *
	 * A command that waits for a person produces what the person needs
	 * before it finishes, so a caller that wants to show it cannot wait
	 * for the command to end.
	 */
	readonly onStdout?: (chunk: string) => void;
	/** Called with each piece of stderr as it arrives. */
	readonly onStderr?: (chunk: string) => void;
	/**
	 * Whether the pinned login is left off this command.
	 *
	 * The CLI marks the login it is acting as, so the command that lists
	 * the saved logins has to ask without the override in order to learn
	 * which login the CLI would use on its own.
	 */
	readonly ignoreContext?: boolean;
	/**
	 * Keeps the output out of the invocation record.
	 *
	 * A transcript is the user's own conversation with an agent. The record
	 * still says how many bytes came back, but neither the debug excerpt in
	 * the output channel nor the dump command can reach the text.
	 */
	readonly withholdBodies?: boolean;
}

/** One invocation, and the bodies it produced. */
interface PerformedInvocation {
	readonly result: CliResult;
	readonly invocation: CliInvocation;
	readonly bodies: CliInvocationBodies;
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
 *
 * Every invocation is reported to the sink, so that the output channel
 * carries the command line, the working directory and the exit code of
 * everything the extension asked the CLI to do.
 */
export class CliRunner {
	private sink: CliInvocationSink | undefined;
	/** The saved login every command acts as, when one is pinned. */
	private pinnedContext: string | undefined;

	constructor(private readonly locator: CliLocator = new CliLocator()) {}

	/**
	 * Reports invocations to a sink.
	 *
	 * The sink is injected rather than imported so that this layer stays
	 * free of the editor, and so that a test can watch what was run.
	 */
	setSink(sink: CliInvocationSink | undefined): void {
		this.sink = sink;
		this.locator.setSink(sink);
	}

	/**
	 * Pins the saved login that every command acts as.
	 *
	 * The name is the one the CLI saved the login under. The CLI's own
	 * active login is left alone: the pin applies to the commands the
	 * extension runs and to nothing else, so the user keeps the login the
	 * CLI would have used in their terminal.
	 *
	 * The login reaches the CLI two ways, because the CLI's own commands
	 * and the processes it spawns do not agree on how. The `--context`
	 * flag is inherited by the CLI's subcommands, and the `ENTIRE_CONTEXT`
	 * environment variable is what reaches the plugin commands and the
	 * agents the CLI starts, so both are set.
	 */
	setContext(name: string | undefined): void {
		const trimmed = name?.trim() ?? '';
		this.pinnedContext = trimmed.length > 0 ? trimmed : undefined;
	}

	/** The saved login every command acts as, when one is pinned. */
	get context(): string | undefined {
		return this.pinnedContext;
	}

	/** The discovery result for the CLI, running a lookup if it is stale. */
	discover(): Promise<Awaited<ReturnType<CliLocator['current']>>> {
		return this.locator.current();
	}

	/** Forgets the cached discovery result. */
	invalidate(): void {
		this.locator.invalidate();
	}

	/**
	 * Points the runner at a specific binary, or back at the usual search.
	 *
	 * The path comes from the user's setting, so changing it must take
	 * effect without a reload.
	 */
	setConfiguredPath(configuredPath: string | undefined): void {
		this.locator.setConfiguredPath(configuredPath);
	}

	/**
	 * Runs a command and returns its output.
	 *
	 * The arguments are the CLI's own, so `run(['status', '--json'])`
	 * invokes `entire status --json`.
	 */
	async run(args: readonly string[], options: RunOptions = {}): Promise<CliResult> {
		const performed = await this.perform(args, options);
		this.report(performed);

		return performed.result;
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
		const performed = await this.perform(args, options);
		const result = performed.result;

		if (!result.ok) {
			this.report(performed);
			return result;
		}

		const parsed = parseJson(result.stdout);
		if (!parsed.ok) {
			this.report({
				...performed,
				invocation: { ...performed.invocation, outcome: 'invalid-output', detail: parsed.detail },
			});

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
			const value = decode(parsed.value);
			this.report(performed);

			return { ...result, value };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.report({
				...performed,
				invocation: { ...performed.invocation, outcome: 'invalid-output', detail },
			});

			return {
				ok: false,
				reason: 'invalid-output',
				detail,
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
	 *
	 * A command may be named by its path, as `repo mirror add`, and each
	 * part of the path is passed to the CLI as its own word, because the
	 * CLI reads a whole path as one word as though it were no path at all.
	 */
	async usage(command: string, options: RunOptions = {}): Promise<CliResult<CliCommandUsage>> {
		const segments = command.trim().split(/\s+/).filter(part => part.length > 0);
		const args = segments.length > 0 ? ['agent-help', ...segments] : ['agent-help'];
		const performed = await this.perform(args, options);
		const result = performed.result;

		this.report(performed);

		if (!result.ok) {
			return result;
		}

		return { ...result, value: parseUsage(command, result.stdout) };
	}

	/**
	 * Runs a command and remembers what it did.
	 *
	 * The reporting is left to the caller, so that a command whose output
	 * turns out to be unusable is reported as the failure it is, rather
	 * than as the success the process was.
	 */
	private async perform(
		args: readonly string[],
		options: RunOptions,
	): Promise<PerformedInvocation> {
		const discovery = await this.locator.current();

		// The pinned login is worked out once, here, so that the command
		// line that is recorded is the command line that was run.
		const context = options.ignoreContext ? undefined : this.pinnedContext;
		const effectiveArgs = context ? ['--context', context, ...args] : [...args];

		if (discovery.state === 'absent') {
			const detail = 'the Entire CLI is not installed';

			return {
				result: {
					ok: false,
					reason: 'absent',
					detail,
					stdout: '',
					stderr: '',
					durationMs: 0,
				},
				invocation: {
					binary: 'entire',
					args: effectiveArgs,
					cwd: options.cwd,
					outcome: 'absent',
					exitCode: undefined,
					durationMs: 0,
					inputBytes: 0,
					stdoutBytes: 0,
					stderrBytes: 0,
					detail,
				},
				bodies: {},
			};
		}

		if (discovery.state === 'broken') {
			const detail = `the Entire CLI at ${discovery.path} is not usable: ${discovery.detail}`;

			return {
				result: {
					ok: false,
					reason: 'broken',
					detail,
					stdout: '',
					stderr: '',
					durationMs: 0,
				},
				invocation: {
					binary: discovery.path,
					args: effectiveArgs,
					cwd: options.cwd,
					outcome: 'broken',
					exitCode: undefined,
					durationMs: 0,
					inputBytes: 0,
					stdoutBytes: 0,
					stderrBytes: 0,
					detail,
				},
				bodies: {},
			};
		}

		const execOptions: ExecOptions = {
			cwd: options.cwd,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			input: options.input,
			env: context
				? { ...(options.env ?? process.env), ENTIRE_CONTEXT: context }
				: options.env,
			onStdout: options.onStdout,
			onStderr: options.onStderr,
		};

		const outcome = await execute(discovery.path, effectiveArgs, execOptions);
		const inputBytes = byteLength(options.input);
		const stdoutBytes = byteLength(outcome.stdout);
		const stderrBytes = byteLength(outcome.stderr);
		const bodies: CliInvocationBodies = options.withholdBodies
			? {}
			: {
					input: options.input,
					stdout: outcome.stdout,
					stderr: outcome.stderr,
				};

		if (!outcome.ok) {
			return {
				result: {
					ok: false,
					reason: outcome.reason === 'spawn-failed' ? 'spawn-failed' : outcome.reason,
					detail: outcome.detail,
					stdout: outcome.stdout,
					stderr: outcome.stderr,
					durationMs: outcome.durationMs,
				},
				invocation: {
					binary: discovery.path,
					args: effectiveArgs,
					cwd: options.cwd,
					outcome: outcome.reason,
					exitCode: outcome.exitCode,
					durationMs: outcome.durationMs,
					inputBytes,
					stdoutBytes,
					stderrBytes,
					detail: outcome.detail,
				},
				bodies,
			};
		}

		return {
			result: {
				ok: true,
				value: outcome.stdout,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				durationMs: outcome.durationMs,
			},
			invocation: {
				binary: discovery.path,
				args: effectiveArgs,
				cwd: options.cwd,
				outcome: 'ok',
				exitCode: outcome.exitCode,
				durationMs: outcome.durationMs,
				inputBytes,
				stdoutBytes,
				stderrBytes,
				detail: undefined,
			},
			bodies,
		};
	}

	/** Reports one invocation to the sink, when there is one. */
	private report(performed: PerformedInvocation): void {
		this.sink?.report(performed.invocation, performed.bodies);
	}
}

