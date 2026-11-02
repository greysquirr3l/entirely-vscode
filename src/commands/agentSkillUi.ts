import * as vscode from 'vscode';

import { neutraliseLinks, type ControlConfirmation } from '../lib/entire';
import type { AgentSkillUi } from './agentSkill';

/** The questions the install asks, in the editor. */
export class EditorAgentSkillUi implements AgentSkillUi {
	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			{ modal: true, detail: neutraliseLinks(prompt.detail) },
			prompt.action,
		);
		return choice === prompt.action;
	}

	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(neutraliseLinks(message));
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(neutraliseLinks(message));
		return Promise.resolve();
	}
}
