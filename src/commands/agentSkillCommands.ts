import * as vscode from 'vscode';

import { installAgentSkill } from './agentSkill';
import { EditorAgentSkillUi } from './agentSkillUi';

/**
 * Registers the command that writes Entire's agent skill into a
 * repository.
 *
 * The skill is a file in the repository, so it is written where the
 * person can read it, see it in the diff, and delete it.
 */
export function registerAgentSkill(context: vscode.ExtensionContext): void {
	const ui = new EditorAgentSkillUi();
	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.installAgentSkill', async () => {
			await installAgentSkill({ ui, repositoryRoot: () => repositoryRoot() });
		}),
	);
}

/**
 * The repository the skill is written into.
 *
 * The folder holding the file being edited is preferred, so a window
 * with several folders open writes into the one being worked in.
 */
function repositoryRoot(): string | undefined {
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active !== undefined) {
		const folder = vscode.workspace.getWorkspaceFolder(active);
		if (folder !== undefined) {
			return folder.uri.fsPath;
		}
	}
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
