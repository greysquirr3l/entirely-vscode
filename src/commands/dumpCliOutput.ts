import * as vscode from 'vscode';

import type { CliInvocationRecorder } from '../services/cli/recorder';
import type { ReportSink } from './doctor';

/** What the dump command needs to do its job. */
export interface DumpDependencies {
	/** What the CLI has been asked to do so far. */
	readonly recorder: CliInvocationRecorder;
	/** Where the payload is written. */
	readonly output: ReportSink;
	/** How the user is told what happened. */
	readonly notify?: (message: string, actions: string[]) => Promise<string | undefined>;
}

/**
 * Shows what the last CLI invocation actually produced.
 *
 * The channel carries the size of a payload and nothing else, because a
 * checkpoint payload or a prompt body is the user's own content and does
 * not belong in a log by default. This command is where that content is
 * asked for, one invocation at a time.
 */
export async function dumpCliOutput(deps: DumpDependencies): Promise<void> {
	const notify =
		deps.notify ??
		(async (message: string, actions: string[]): Promise<string | undefined> =>
			vscode.window.showInformationMessage(message, ...actions));

	const bodies = deps.recorder.latestBodies();

	if (!bodies) {
		await notify('The Entire CLI has not been run yet, so there is nothing to show.', []);
		return;
	}

	const lines: string[] = ['## The last Entire CLI invocation'];

	if (bodies.input !== undefined) {
		lines.push('');
		lines.push('### stdin');
		lines.push('');
		lines.push(bodies.input);
	}

	if (bodies.stdout !== undefined && bodies.stdout.length > 0) {
		lines.push('');
		lines.push('### stdout');
		lines.push('');
		lines.push(bodies.stdout);
	}

	if (bodies.stderr !== undefined && bodies.stderr.length > 0) {
		lines.push('');
		lines.push('### stderr');
		lines.push('');
		lines.push(bodies.stderr);
	}

	deps.output.appendLine('');
	deps.output.appendLine(lines.join('\n'));
	deps.output.show(true);

	await notify('The last Entire CLI output was written to the Entirely log.', []);
}
