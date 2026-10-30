import * as vscode from 'vscode';

import type { ControlConfirmation } from '../lib/entire';
import type { HelpFlag } from '../lib/entire/search';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { PluginChoice, PluginUi } from './plugins';

const OTHER = '$(edit) Another plugin…';

/** The plugin commands' questions, asked in the editor. */
export class EditorPluginUi implements PluginUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	async pickPlugin(choices: readonly PluginChoice[]): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				...choices.map(choice => ({
					label: choice.name,
					description: choice.installed ? 'installed' : 'not installed',
					detail: choice.detail.length > 0 && choice.installed ? choice.detail : undefined,
				})),
				{ label: OTHER, description: 'type a plugin name' },
			],
			{ title: 'Plugin', ignoreFocusOut: true },
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

	async pickSubcommand(plugin: string, subcommands: readonly string[]): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			[{ label: '(no subcommand)', value: '' }, ...subcommands.map(name => ({ label: name, value: name }))],
			{ title: `${plugin}: subcommand`, ignoreFocusOut: true },
		);
		return picked?.value;
	}

	askArguments(plugin: string, flags: readonly HelpFlag[], validate: (text: string) => string | undefined): Promise<string | undefined> {
		const known = flags.slice(0, 8).map(flag => flag.name).join(' ');
		return Promise.resolve(
			vscode.window.showInputBox({
				title: `${plugin}: arguments`,
				prompt: known.length > 0 ? `Flags from the plugin's help: ${known}. Leave empty for none.` : 'Arguments for the plugin. Leave empty for none.',
				ignoreFocusOut: true,
				validateInput: validate,
			}),
		);
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

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}

	async offerInstall(message: string, name: string): Promise<boolean> {
		const action = `Install ${name}`;
		const choice = await vscode.window.showWarningMessage(message, action);
		return choice === action;
	}

	async showOutput(_plugin: string, text: string): Promise<void> {
		const uri = this.documents.set('plugin', text);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}
}
