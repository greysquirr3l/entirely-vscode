import { failureDetail, readDoctorOutput, type CliDoctorReading } from '../lib/entire';
import type { CliRunner } from './cli';

/** What the service needs to do its job. */
export interface CliDoctorOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, `entire doctor` may take. */
	readonly timeoutSeconds: () => number;
}

/** Where the report gets the CLI's own diagnostics. */
export interface CliDoctorSource {
	read(): Promise<CliDoctorReading>;
	/** The unfiltered text of the last run, held in memory only. */
	lastOutput(): string | undefined;
}

/**
 * Asks `entire doctor` what is wrong with the capture pipeline.
 *
 * The command is run with no flags at all. Without a terminal it reports
 * each problem and points at `--force` instead of fixing anything, and
 * this service never passes `--force`. The command's existence is checked
 * against `entire agent-help` first, so an old CLI is reported as lacking
 * it rather than as failing. The raw output is held in memory for an
 * explicit command and kept out of the invocation record, so neither the
 * output channel nor the dump command can reach it.
 */
export class CliDoctorService implements CliDoctorSource {
	private raw: string | undefined;

	constructor(private readonly options: CliDoctorOptions) {}

	lastOutput(): string | undefined {
		return this.raw;
	}

	async read(): Promise<CliDoctorReading> {
		this.raw = undefined;
		const cwd = this.options.workspaceRoot();

		const discovery = await this.options.runner.discover();
		if (discovery.state === 'absent') {
			return { kind: 'no-cli', detail: 'the Entire CLI is not installed' };
		}
		if (discovery.state === 'broken') {
			return { kind: 'no-cli', detail: `the Entire CLI is not usable: ${discovery.detail}` };
		}

		const usage = await this.options.runner.usage('doctor', { cwd, withholdBodies: true });
		if (!usage.ok) {
			if (usage.reason === 'exit-code') {
				return { kind: 'unsupported', detail: 'this Entire CLI has no doctor command' };
			}
			return { kind: 'failed', reason: usage.reason, detail: failureDetail(usage.stderr, '', usage.detail) };
		}

		const result = await this.options.runner.run(['doctor'], {
			cwd,
			timeoutMs: this.options.timeoutSeconds() * 1000,
			withholdBodies: true,
		});

		if (!result.ok) {
			this.raw = result.stdout + result.stderr;
			return {
				kind: 'failed',
				reason: result.reason,
				detail: failureDetail(result.stderr, result.stdout, result.detail),
			};
		}

		this.raw = result.stdout + (result.stderr.length > 0 ? `\n${result.stderr}` : '');
		return readDoctorOutput(result.stdout);
	}
}
