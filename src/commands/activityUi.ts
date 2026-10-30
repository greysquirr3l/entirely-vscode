import * as vscode from 'vscode';

import type { DispatchMode, RecapPeriod } from '../lib/entire';
import type { GeneratedDocuments, GeneratedKind } from '../providers/generatedDocuments';
import type { DispatchUi } from './dispatch';
import type { RecapUi } from './recap';

/** The dispatch and recap commands' questions, asked in the editor. */
export class EditorGeneratedUi implements DispatchUi, RecapUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	async pickMode(): Promise<DispatchMode | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				{ label: 'Entire server', description: 'Entire writes the dispatch from recorded work', mode: 'cloud' as const },
				{ label: 'Local agent', description: 'An agent installed on this machine writes it from local history', mode: 'local' as const },
			],
			{ title: 'Who writes the dispatch?', ignoreFocusOut: true },
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

	async confirm(prompt: { readonly message: string; readonly detail: string; readonly action: string }): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	async pickPeriod(periods: readonly RecapPeriod[]): Promise<RecapPeriod | undefined> {
		const picked = await vscode.window.showQuickPick(
			periods.map(period => ({ label: period.label, period })),
			{ title: 'Recap period', ignoreFocusOut: true },
		);
		return picked?.period;
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

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}

	async showDispatch(text: string): Promise<void> {
		await this.open('dispatch', text);
		// A message with buttons settles only when dismissed, so it is not awaited.
		void vscode.window.showInformationMessage('The dispatch is open in a read-only editor.', 'Copy').then(choice => {
			if (choice === 'Copy') {
				void vscode.commands.executeCommand('entirely.copyDispatch');
			}
		});
	}

	async showRecap(text: string): Promise<void> {
		await this.open('recap', text);
	}

	private async open(kind: GeneratedKind, text: string): Promise<void> {
		const uri = this.documents.set(kind, text);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}
}
