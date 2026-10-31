import * as vscode from 'vscode';

import type { ControlConfirmation } from '../lib/entire';
import type { FollowUp, PluginManagementUi, SearchItem } from '../commands/pluginManagement';
import type { PluginChoice } from '../commands/plugins';
import type { GeneratedDocuments } from './generatedDocuments';

const OTHER = '$(edit) Another plugin…';

/** The plugin management flows' questions, asked in the editor. Output is shown as plain text documents. */
export class EditorPluginManagementUi implements PluginManagementUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	async pickPlugin(choices: readonly PluginChoice[], title: string): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				...choices.map(choice => ({
					label: choice.name,
					description: choice.installed ? 'installed' : 'not installed',
					detail: choice.installed && choice.detail.length > 0 ? choice.detail : undefined,
				})),
				{ label: OTHER, description: 'type a plugin name' },
			],
			{ title, ignoreFocusOut: true },
		);
		if (!picked) {
			return undefined;
		}
		if (picked.label !== OTHER) {
			return picked.label;
		}
		return vscode.window.showInputBox({
			title: 'Plugin name',
			prompt: 'The name after entire-, such as graph for the entire-graph plugin.',
			ignoreFocusOut: true,
			validateInput: text => (/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(text.trim()) ? undefined : 'Use letters, digits, dashes and underscores.'),
		});
	}

	askTerm(): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Search Plugin Index',
				prompt: 'A word to look for in plugin names and descriptions. Leave empty to ask the CLI for its default listing.',
				ignoreFocusOut: true,
				validateInput: text => (/[\u0000-\u001f\u007f]/.test(text) ? 'The term cannot hold control characters.' : undefined),
			}),
		);
	}

	async pickResult(items: readonly SearchItem[]): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			items.map(item => ({
				label: item.name,
				description: item.blocked ? `cannot be installed: ${item.blocked}` : item.installed ? 'installed' : undefined,
				detail: item.description.length > 0 ? item.description : undefined,
			})),
			{ title: 'Plugin index', placeHolder: 'Choose a plugin', ignoreFocusOut: true, matchOnDetail: true },
		);
		return picked?.label;
	}

	async pickResultAction(name: string, installed: boolean): Promise<'info' | 'install' | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				{ label: 'Info', description: `Show what the index says about ${name}`, action: 'info' as const },
				...(installed ? [] : [{ label: 'Install', description: `Install ${name} after a question`, action: 'install' as const }]),
			],
			{ title: name, ignoreFocusOut: true },
		);
		return picked?.action;
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

	notify(level: 'info' | 'warn', message: string, followUp?: FollowUp): Promise<void> {
		const show = (...items: string[]): Thenable<string | undefined> =>
			level === 'warn' ? vscode.window.showWarningMessage(message, ...items) : vscode.window.showInformationMessage(message, ...items);
		const pending = followUp ? show(followUp.label) : show();
		void pending.then(choice => (followUp && choice === followUp.label ? followUp.run() : undefined)).then(undefined, () => undefined);
		return Promise.resolve();
	}

	async showDocument(title: string, text: string): Promise<void> {
		const uri = this.documents.set('plugin', text, title);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}
}
