import * as vscode from 'vscode';

import type { ControlConfirmation, Project } from '../lib/entire';
import type { ControlPlaneUi } from './controlPlane';

/** The control plane commands' questions, asked in the editor. */
export class EditorControlPlaneUi implements ControlPlaneUi {
	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	pick(title: string, values: readonly string[]): Promise<string | undefined> {
		return Promise.resolve(vscode.window.showQuickPick([...values], { title, ignoreFocusOut: true }));
	}

	ask(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly validate: (value: string) => string | undefined;
	}): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: options.title,
				prompt: options.prompt,
				value: options.value,
				ignoreFocusOut: true,
				validateInput: options.validate,
			}),
		);
	}

	async pickProject(projects: readonly Project[]): Promise<Project | undefined> {
		const picked = await vscode.window.showQuickPick(
			projects.map(project => ({ label: project.name, description: project.ownerName, project })),
			{ title: 'Project', ignoreFocusOut: true },
		);
		return picked?.project;
	}

	withProgress<T>(title: string, work: () => Promise<T>): Promise<T> {
		return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => work()));
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

	async showApiResult(heading: string, body: string): Promise<void> {
		// The first line is a comment so the document says what produced it.
		const document = await vscode.workspace.openTextDocument({ language: 'jsonc', content: `// ${heading}\n${body}\n` });
		await vscode.window.showTextDocument(document, { preview: true });
	}
}
