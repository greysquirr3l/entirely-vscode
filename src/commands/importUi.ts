import * as vscode from 'vscode';

import { MAX_IMPORT_SESSIONS, parseSessionIds } from '../lib/entire';
import type { ImportConfirmation, ImportNarrowing, ImportUi } from './historyImport';

/** The import command's questions, asked in the editor. */
export class EditorImportUi implements ImportUi {
	async chooseAgent(agents: readonly string[]): Promise<string | undefined> {
		return vscode.window.showQuickPick([...agents], {
			title: 'Import history from which agent?',
		});
	}

	async chooseNarrowing(agent: string): Promise<ImportNarrowing | undefined> {
		const all = { label: 'All sessions from the past month', all: true };
		const some = { label: 'Only sessions I choose…', all: false };
		const picked = await vscode.window.showQuickPick([all, some], { title: `Which ${agent} sessions?` });
		if (!picked) {
			return undefined;
		}
		if (picked.all) {
			return { kind: 'all' };
		}
		const text = await vscode.window.showInputBox({
			title: `Which ${agent} sessions?`,
			prompt: `Session ids, separated by spaces or commas (up to ${MAX_IMPORT_SESSIONS})`,
			ignoreFocusOut: true,
			validateInput: value => (parseSessionIds(value) ? undefined : 'Enter one or more session ids the CLI can be given.'),
		});
		const ids = text === undefined ? undefined : parseSessionIds(text);
		return ids ? { kind: 'sessions', ids } : undefined;
	}

	async confirm(prompt: ImportConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			{ modal: true, detail: prompt.detail },
			prompt.action,
		);
		return choice === prompt.action;
	}

	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return Promise.resolve(
			vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
				(_progress, token) => {
					const controller = new AbortController();
					const listener = token.onCancellationRequested(() => controller.abort());
					return Promise.resolve(work(controller.signal)).finally(() => listener.dispose());
				},
			),
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
