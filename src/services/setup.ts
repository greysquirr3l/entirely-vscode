import * as vscode from 'vscode';

import type { CliRunner } from './cli';

/**
 * The agents this extension sets up hooks for.
 *
 * The CLI owns the names; `copilot-cli` is the identifier it gives Copilot
 * CLI. The flag that selects the agent is read from the CLI's own help at
 * runtime, never hardcoded, because the CLI is free to change it.
 */
const SUPPORTED_AGENTS = ['copilot-cli'];

/**
 * The arguments that set Entire up without asking anything.
 *
 * `entire enable` on its own runs a configuration flow that prompts, which
 * is not something to put behind a button. `--agent` selects a single agent
 * and implies the non-interactive mode. `--no-init-repo` stops the CLI
 * offering to initialise a repository, because a prompt must never create
 * a repository or an initial commit behind the user's back.
 *
 * The flags are still checked against the CLI's own help before they are
 * used, because the CLI is the source of truth for its own behaviour.
 */
export async function enableArguments(runner: CliRunner): Promise<string[] | undefined> {
	const usage = await runner.usage('enable');
	if (!usage.ok) {
		await vscode.window.showErrorMessage(
			`Entirely could not read the Entire CLI's usage: ${usage.detail}`,
		);
		return undefined;
	}

	const flags = usage.value.flags.map(flag => flag.name);
	const args = ['enable'];

	if (flags.includes('--agent')) {
		args.push('--agent', SUPPORTED_AGENTS[0]);
	}
	if (flags.includes('--no-init-repo')) {
		args.push('--no-init-repo');
	}

	return args;
}

/**
 * Sets Entire up for a repository, without asking anything and without
 * touching the git history.
 *
 * The CLI's own words are not shown here. The invocation logger already
 * carries them, as a bounded excerpt, at the `debug` level; writing the
 * whole of stdout to the channel at the default level would put the
 * payload into the buffer a user attaches to a bug report.
 */
export async function enableEntire(runner: CliRunner, cwd: string | undefined): Promise<boolean> {
	const args = await enableArguments(runner);
	if (!args) {
		return false;
	}

	const result = await runner.run(args, { cwd });
	if (!result.ok) {
		await vscode.window.showErrorMessage(`Entire could not be set up: ${result.detail}`);
		return false;
	}

	await vscode.window.showInformationMessage(
		'Entire is set up for this workspace. Commit the .entire and .github/hooks files so it works across worktrees.',
	);

	return true;
}
