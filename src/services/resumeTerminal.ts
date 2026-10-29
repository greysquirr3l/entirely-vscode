import * as vscode from 'vscode';

import type { ResumeLauncher } from './sessionResume';

/** The name of the terminal a resume runs in. */
export const RESUME_TERMINAL_NAME = 'Entire: resume session';

/**
 * Runs a resume in an integrated terminal.
 *
 * The CLI runs directly as the terminal's process, with no shell between,
 * so the terminal reports the CLI's own exit code. The terminal is the
 * user's from then on: it is shown, left open and not disposed here, since
 * the CLI may be asking them a question or running their agent.
 */
export const launchInTerminal: ResumeLauncher = launch => {
	const terminal = vscode.window.createTerminal({
		name: RESUME_TERMINAL_NAME,
		shellPath: launch.path,
		shellArgs: [...launch.args],
		cwd: launch.cwd,
		env: launch.env,
	});
	terminal.show();
	return {
		status: () => ({
			ended: terminal.exitStatus !== undefined,
			exitCode: terminal.exitStatus?.code,
		}),
	};
};
