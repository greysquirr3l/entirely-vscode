import * as vscode from 'vscode';

import { describeBridging } from '../lib/entire';
import { AgentIntegrationService } from './agentIntegrations';
import type { CliRunner } from './cli';
import { readExtensionSettings } from './configuration';

/**
 * Asks which of the CLI's agents to set Entire up for.
 *
 * The choices are what `entire agent list` prints, so an agent the CLI
 * adds later is offered without a change here. A list that cannot be read is
 * reported, and setup stops rather than guessing an agent.
 */
async function chooseSetupAgent(runner: CliRunner, cwd: string | undefined): Promise<string | undefined> {
	const service = new AgentIntegrationService({ runner, workspaceRoot: () => cwd, timeoutSeconds: () => 60,
		editorAgent: () => readExtensionSettings().editorHookAgent,
	});
	const listed = await service.list();
	if (!listed.ok) {
		await vscode.window.showErrorMessage(`Entirely could not list the agents Entire supports: ${listed.detail}.`);
		return undefined;
	}

	const picked = await vscode.window.showQuickPick(
		listed.agents.map(agent => ({
			label: agent.name,
			description: agent.installed ? 'installed' : undefined,
			detail: agent.bridging ? describeBridging(agent.bridging) : undefined,
		})),
		{ title: 'Set up Entire for which agent?', placeHolder: 'You can add more agents later with Set Up Agent Integrations' },
	);
	return picked?.label;
}

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
export async function enableArguments(runner: CliRunner, agent: string): Promise<string[] | undefined> {
	const usage = await runner.usage('enable');
	if (!usage.ok) {
		await vscode.window.showErrorMessage(
			`Entirely could not read the Entire CLI's usage: ${usage.detail}`,
		);
		return undefined;
	}

	const flags = usage.value.flags.map(flag => flag.name);
	const args = ['enable'];

	// Without an agent the CLI asks which one, which a button cannot answer.
	// A CLI that no longer has the flag is not given a guess.
	if (!flags.includes('--agent')) {
		await vscode.window.showErrorMessage(
			'This version of the Entire CLI cannot set up an agent without asking. Run entire enable in a terminal.',
		);
		return undefined;
	}
	args.push('--agent', agent);
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
	const agent = await chooseSetupAgent(runner, cwd);
	if (!agent) {
		return false;
	}

	const args = await enableArguments(runner, agent);
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
