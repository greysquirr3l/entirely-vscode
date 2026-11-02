import * as vscode from 'vscode';

import { neutraliseLinks, neutraliseLinksKeepingBrackets, type ControlConfirmation } from '../lib/entire';
import type { AgentSkillUi } from './agentSkill';

/** The questions the install asks, in the editor. */
export class EditorAgentSkillUi implements AgentSkillUi {
	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			// The detail is the one surface VS Code renders as Markdown, so
			// it takes the strict treatment. The path rides in the message,
			// which VS Code shows as plain text.
			{ modal: true, detail: neutraliseLinks(prompt.detail) },
			prompt.action,
		);
		return choice === prompt.action;
	}

	// A notification is shown as plain text, so the brackets in the
	// person's own path are kept: a path shown altered is a path the
	// person cannot find.
	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(neutraliseLinksKeepingBrackets(message));
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(neutraliseLinksKeepingBrackets(message));
		return Promise.resolve();
	}
}
