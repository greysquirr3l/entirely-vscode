import * as vscode from 'vscode';

import type { CliDoctorSource } from '../services/cliDoctor';
import type { ReportSink } from './doctor';

/** What the command needs to do its job. */
export interface CliDoctorOutputDependencies {
	readonly cliDoctor: CliDoctorSource;
	readonly output: ReportSink;
	readonly notify?: (message: string, actions: string[]) => Promise<string | undefined>;
}

/**
 * Writes the CLI doctor's full text to the output channel.
 *
 * The report holds each finding's headline and the reason and fix lines.
 * The rest of what `entire doctor` prints can name files and sessions, so
 * it is only shown when the user asks for it, here, for the last run.
 */
export async function showCliDoctorOutput(deps: CliDoctorOutputDependencies): Promise<void> {
	const notify =
		deps.notify ??
		(async (message: string, actions: string[]): Promise<string | undefined> =>
			vscode.window.showInformationMessage(message, ...actions));

	const raw = deps.cliDoctor.lastOutput();
	if (raw === undefined || raw.trim().length === 0) {
		await notify('Run "Entirely: Doctor: Copy a Diagnostic Report" first. The CLI has not printed any diagnostics yet.', []);
		return;
	}

	deps.output.appendLine('');
	deps.output.appendLine('## The last `entire doctor` output');
	deps.output.appendLine('');
	deps.output.appendLine(raw);
	deps.output.show(true);
	await notify('The CLI doctor output was written to the Entirely log.', []);
}
