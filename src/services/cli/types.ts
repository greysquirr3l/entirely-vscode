/**
 * Where a resolved `entire` binary came from.
 *
 * `path` means the binary was found in a `PATH` entry. `install-location`
 * means it was found in one of the directories the CLI documents for
 * installation. `configured` means the user pointed at it explicitly.
 */
export type CliLocation = 'path' | 'install-location' | 'configured';

/** The outcome of locating and verifying the Entire CLI. */
export type CliDiscovery =
	| { readonly state: 'absent' }
	| {
			readonly state: 'available';
			/** Absolute path to the binary. */
			readonly path: string;
			readonly location: CliLocation;
			/** The directory the binary was found in. */
			readonly directory: string;
			/** The version string the CLI reported. */
			readonly version: string;
	  }
	| {
			readonly state: 'broken';
			readonly path: string;
			readonly location: CliLocation;
			readonly directory: string;
			/** Why the binary could not be used. */
			readonly detail: string;
	  };

/** Why an invocation did not produce a value. */
export type CliFailureReason =
	/** No `entire` binary was found. */
	| 'absent'
	/** A binary was found but is not usable. */
	| 'broken'
	/** The command ran for longer than its timeout. */
	| 'timeout'
	/** The command exited with a non-zero status. */
	| 'exit-code'
	/** The output was not the JSON the caller asked for. */
	| 'invalid-output'
	/** The process could not be started at all. */
	| 'spawn-failed'
	/** The caller aborted the command. */
	| 'cancelled';

/** The result of running a CLI command. Never throws; failures are values. */
export type CliResult<T = unknown> =
	| {
			readonly ok: true;
			readonly value: T;
			readonly stdout: string;
			readonly stderr: string;
			readonly durationMs: number;
			/** True when the CLI printed more than the extension reads, so the text is cut short. Absent means not. */
			readonly truncated?: boolean;
	  }
	| {
			readonly ok: false;
			readonly reason: CliFailureReason;
			readonly detail: string;
			readonly stdout: string;
			readonly stderr: string;
			readonly durationMs: number;
			readonly truncated?: boolean;
	  };

/** A single flag, as reported by the CLI's own `agent-help` output. */
export interface CliFlag {
	/** The flag as written, for example `--json`. */
	readonly name: string;
	/** The text the CLI gave for it. */
	readonly description: string;
}

/** The CLI's own usage information for one command. */
export interface CliCommandUsage {
	/** The command the usage was read for, for example `status`. */
	readonly command: string;
	readonly flags: readonly CliFlag[];
	/** The unmodified text the CLI printed. */
	readonly raw: string;
}
