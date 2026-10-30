import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ControlConfirmation } from '../lib/entire';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { DoctorDepthUi, OutputDocument, TraceMode } from './doctorDepth';

const TRACE_MODES: Record<TraceMode, { label: string; description: string }> = {
	latest: { label: 'The latest trace', description: 'the most recent hook invocation' },
	last: { label: 'The last few traces', description: 'you choose how many next' },
	summary: { label: 'A summary', description: 'which step dominates, per hook' },
	slow: { label: 'Slow traces only', description: 'hooks the CLI flagged as slow' },
};

/** The doctor's log, trace, bundle and migration questions, asked in the editor. */
export class EditorDoctorDepthUi implements DoctorDepthUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	notify(level: 'info' | 'warn', message: string, actions: readonly string[] = []): Promise<string | undefined> {
		const show = level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
		return Promise.resolve(show(message, ...actions));
	}

	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
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

	async pickTraceMode(modes: readonly TraceMode[]): Promise<TraceMode | undefined> {
		const picked = await vscode.window.showQuickPick(
			modes.map(mode => ({ ...TRACE_MODES[mode], mode })),
			{ title: 'Which hook traces?', ignoreFocusOut: true },
		);
		return picked?.mode;
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

	async chooseSavePath(options: { readonly title: string; readonly defaultName: string; readonly extensions: readonly string[] }): Promise<string | undefined> {
		const uri = await vscode.window.showSaveDialog({
			title: options.title,
			defaultUri: vscode.Uri.file(path.join(os.homedir(), options.defaultName)),
			filters: { Files: [...options.extensions] },
			saveLabel: 'Save',
		});
		return uri?.fsPath;
	}

	async showOutput(document: OutputDocument): Promise<void> {
		const uri = this.documents.set('doctor', document.text);
		const opened = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(opened, { preview: true });
		const actions = document.saveWhole ? ['Copy', 'Save the whole output…'] : ['Copy'];
		// A message with buttons settles only when dismissed, so it is not awaited.
		void vscode.window.showInformationMessage('The output is open in a read-only editor.', ...actions).then(async choice => {
			if (choice === 'Copy') {
				await vscode.env.clipboard.writeText(document.text);
			} else if (choice === 'Save the whole output…') {
				await document.saveWhole?.();
			}
		});
	}

	async reveal(file: string): Promise<void> {
		await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
	}

	async copyText(text: string): Promise<void> {
		await vscode.env.clipboard.writeText(text);
	}

	async openUrl(url: string): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}

	async openFile(file: string): Promise<void> {
		await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
	}
}
