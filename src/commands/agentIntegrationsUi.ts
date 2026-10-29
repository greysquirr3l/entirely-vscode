import * as vscode from 'vscode';

import { describeSupport } from '../lib/entire';
import type { AgentListing } from '../services/agentIntegrations';
import type { AgentAction, AgentConfirmation, AgentUi } from './agentIntegrations';

interface AgentPick extends vscode.QuickPickItem {
	readonly agent: AgentListing;
}

/** The agent setup command's questions, asked in the editor. */
export class EditorAgentUi implements AgentUi {
	async chooseAgent(agents: readonly AgentListing[]): Promise<AgentListing | undefined> {
		const picks: AgentPick[] = agents.map(agent => ({
			label: `${agent.installed ? '$(check) ' : ''}${agent.name}`,
			description: agent.installed ? 'installed' : 'not installed',
			detail: agent.support ? describeSupport(agent.support) : undefined,
			agent,
		}));
		const picked = await vscode.window.showQuickPick(picks, {
			title: 'Agent integrations the Entire CLI supports',
			placeHolder: 'Pick one to install or remove',
		});
		return picked?.agent;
	}

	async chooseAction(agent: AgentListing, canReinstall: boolean): Promise<AgentAction | undefined> {
		const choices: (vscode.QuickPickItem & { action: AgentAction })[] = [
			{ label: 'Remove', detail: `Take the ${agent.name} hooks out of this workspace`, action: 'remove' },
		];
		if (canReinstall) {
			choices.push({ label: 'Reinstall', detail: `Write the ${agent.name} hooks again`, action: 'reinstall' });
		}
		const picked = await vscode.window.showQuickPick(choices, { title: `${agent.name} is installed` });
		return picked?.action;
	}

	async confirm(prompt: AgentConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			{ modal: true, detail: prompt.detail },
			prompt.action,
		);
		return choice === prompt.action;
	}

	withProgress<T>(title: string, work: () => Promise<T>): Promise<T> {
		return Promise.resolve(
			vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => work()),
		);
	}

	// A message with no buttons settles only when it is dismissed, so the
	// command is not held open waiting for that.
	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}
}
