import * as vscode from 'vscode';

import type { ReviewLauncher } from './review';

/** The name of the terminal a review, its setup or its findings run in. */
export const REVIEW_TERMINAL_NAME = 'Entire: review';

/**
 * Runs the CLI in an integrated terminal.
 *
 * The CLI is the terminal's own process, with no shell between, so the
 * terminal reports its exit code and the person sees its prompts and can
 * stop it. The terminal is left open and is the person's from then on.
 * The end of the process is learned from the terminal-closed event, so
 * nothing polls. Listeners are collected on `disposables`, which the
 * extension disposes.
 */
export function reviewTerminalLauncher(disposables: vscode.Disposable[]): ReviewLauncher {
	return launch => {
		const terminal = vscode.window.createTerminal({
			name: REVIEW_TERMINAL_NAME,
			shellPath: launch.path,
			shellArgs: [...launch.args],
			cwd: launch.cwd,
			env: launch.env,
		});
		terminal.show();
		return {
			onExit: listener => {
				const subscription = vscode.window.onDidCloseTerminal(closed => {
					if (closed === terminal) {
						subscription.dispose();
						listener(closed.exitStatus?.code);
					}
				});
				disposables.push(subscription);
			},
		};
	};
}
