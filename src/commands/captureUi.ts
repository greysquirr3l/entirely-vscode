import * as vscode from 'vscode';

import type { CaptureConfirmation } from '../lib/entire';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { CaptureChoice, CaptureUi } from './captureControl';

/** The capture-control questions, asked in the editor. */
export class EditorCaptureUi implements CaptureUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	async chooseFolder(folders: readonly string[]): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			folders.map(folder => ({ label: vscode.Uri.file(folder).path.split('/').pop() ?? folder, description: folder, folder })),
			{ title: 'Which workspace folder?', ignoreFocusOut: true },
		);
		return picked?.folder;
	}

	async choose<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<T | undefined> {
		const picked = await vscode.window.showQuickPick(
			items.map(item => ({ label: item.label, description: item.description, detail: item.detail, id: item.id })),
			{ title, ignoreFocusOut: true },
		);
		return picked?.id;
	}

	async pickMany<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<readonly T[] | undefined> {
		const picked = await vscode.window.showQuickPick(
			items.map(item => ({ label: item.label, description: item.description, detail: item.detail, picked: item.picked === true, id: item.id })),
			{ title, canPickMany: true, ignoreFocusOut: true },
		);
		return picked?.map(item => item.id);
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

	async confirm(prompt: CaptureConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	typeToConfirm(expected: string): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Confirm by typing the folder name',
				prompt: `Type ${expected} to continue. Press Escape to stop.`,
				ignoreFocusOut: true,
				validateInput: value => (value.trim() === expected ? undefined : `Type ${expected} exactly.`),
			}),
		);
	}

	async showText(_title: string, text: string): Promise<void> {
		const uri = this.documents.set('capture', text);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	notify(level: 'info' | 'warn', message: string, actions: readonly string[] = []): Promise<string | undefined> {
		const show = level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
		return Promise.resolve(show(message, ...actions));
	}

	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return Promise.resolve(
			vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (_progress, token) => {
				const controller = new AbortController();
				const listener = token.onCancellationRequested(() => controller.abort());
				return work(controller.signal).finally(() => listener.dispose());
			}),
		);
	}

	async openFile(file: string): Promise<void> {
		await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
	}

	async openUrl(url: string): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
