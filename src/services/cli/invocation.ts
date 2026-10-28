/**
 * What one CLI invocation did.
 *
 * The record carries the facts a user needs to reproduce a problem: the
 * exact command line, the directory it ran in, and how it ended.
 *
 * It deliberately carries no bodies. A prompt body or a checkpoint payload
 * is not something the channel may show by default, so the record says how
 * many bytes there were and the bodies are kept apart, to be asked for
 * explicitly.
 */
export interface CliInvocation {
	/** The binary that was run, or the command name when there was none. */
	readonly binary: string;
	/** The arguments, as they were passed. */
	readonly args: readonly string[];
	/** The directory the command ran in. */
	readonly cwd: string | undefined;
	/** How the invocation ended. */
	readonly outcome: CliInvocationOutcome;
	/** The code the process exited with, when it ran and exited. */
	readonly exitCode: number | undefined;
	/** How long it took, in milliseconds. */
	readonly durationMs: number;
	/** How many bytes were written to the command's stdin. */
	readonly inputBytes: number;
	/** How many bytes came back on stdout. */
	readonly stdoutBytes: number;
	/** How many bytes came back on stderr. */
	readonly stderrBytes: number;
	/** Why it failed, when it failed. */
	readonly detail: string | undefined;
}

/** How a CLI invocation ended. */
export type CliInvocationOutcome =
	| 'ok'
	| 'absent'
	| 'broken'
	| 'timeout'
	| 'exit-code'
	| 'spawn-failed'
	| 'invalid-output';

/**
 * The bodies one invocation produced.
 *
 * These are kept in memory only, and only so that an explicit command can
 * show them. Nothing here is written anywhere until somebody asks.
 */
export interface CliInvocationBodies {
	/** The text that was written to the command's stdin. */
	readonly input?: string;
	/** What the command printed on stdout. */
	readonly stdout?: string;
	/** What the command printed on stderr. */
	readonly stderr?: string;
}

/**
 * Where invocations are reported.
 *
 * The runner reports to this rather than to the output channel, so that
 * the CLI layer stays free of the editor and can be tested without it.
 */
export interface CliInvocationSink {
	/** Reports one invocation, and the bodies it produced. */
	report(invocation: CliInvocation, bodies: CliInvocationBodies): void;
}

/** The most of a payload the channel shows when it shows one at all. */
export const PAYLOAD_EXCERPT_LIMIT = 200;

/** An argument that needs no quoting. */
const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quotes an argument so the command line can be pasted into a shell.
 *
 * The quoting is the shell's own, so a command line copied out of the
 * channel runs the same command the extension ran.
 */
export function quoteArgument(argument: string): string {
	if (argument.length === 0) {
		return "''";
	}

	if (SAFE_ARGUMENT.test(argument)) {
		return argument;
	}

	return `"${argument.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Renders the exact command line of an invocation.
 *
 * This is what a user needs to reproduce a problem by hand, so the binary
 * is named in full and every argument is quoted the way a shell would
 * quote it.
 */
export function renderCommandLine(binary: string, args: readonly string[]): string {
	return [binary, ...args.map(quoteArgument)].join(' ');
}

/** The size of a piece of text, in bytes. */
export function byteLength(text: string | undefined): number {
	if (!text) {
		return 0;
	}

	return Buffer.byteLength(text, 'utf8');
}

/**
 * Formats a number of bytes for a human to read.
 *
 * The unit is written out rather than left to the reader to work out.
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} kB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shortens a payload to something that may be shown.
 *
 * The whitespace is collapsed so that a payload does not take over the
 * channel, and the result is cut short rather than dropped, so that the
 * reader can still tell what kind of thing it was.
 */
export function excerptPayload(text: string, limit: number = PAYLOAD_EXCERPT_LIMIT): string {
	const collapsed = text.replace(/\s+/g, ' ').trim();

	if (collapsed.length <= limit) {
		return collapsed;
	}

	return `${collapsed.slice(0, limit)}...`;
}
