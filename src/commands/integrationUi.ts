import * as vscode from 'vscode';

import type { ControlConfirmation, McpConfigFile } from '../lib/entire';
import type { IntegrationFolder } from '../services/integrationDetection';
import type { OfferUi, PluginOfferAnswer, ProjectOfferAnswer } from '../services/integrationOffers';
import type { IntegrationUi } from './integrations';

/** The integration questions, asked in the editor. */
export class EditorIntegrationUi implements IntegrationUi, OfferUi {
	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}

	async showSnippet(message: string, snippet: string): Promise<void> {
		const copy = 'Copy';
		const choice = await vscode.window.showWarningMessage(`${message}\n${snippet}`, copy);
		if (choice === copy) {
			await vscode.env.clipboard.writeText(snippet);
		}
	}

	async offerPlugins(names: readonly string[]): Promise<PluginOfferAnswer | undefined> {
		const install = 'Install…';
		const choice = await vscode.window.showInformationMessage(
			`These Entire plugins are not installed: ${names.join(', ')}. Install them once and every project can use them. This is asked only once on this machine.`,
			install,
			'Not now',
		);
		return choice === install ? 'install' : choice === undefined ? undefined : 'not-now';
	}

	async pickPlugins(names: readonly string[]): Promise<readonly string[] | undefined> {
		const picked = await vscode.window.showQuickPick(
			names.map(name => ({ label: name, picked: true })),
			{ title: 'Install which plugins?', canPickMany: true, ignoreFocusOut: true },
		);
		return picked?.map(item => item.label);
	}

	async offerProjectConfig(folder: IntegrationFolder, file: McpConfigFile): Promise<ProjectOfferAnswer | undefined> {
		const add = `Add to ${file}`;
		const never = "Don't ask for this project";
		const editorNote = file === '.vscode/mcp.json' ? ' VS Code already gets the server from this extension, so it may show twice.' : '';
		const choice = await vscode.window.showInformationMessage(
			`Add the Entire MCP server to ${file} in ${folder.name}, so other agents can use it? This adds an "entire" entry and leaves every other entry as it is.${editorNote}`,
			add,
			'Not now',
			never,
		);
		return choice === add ? 'add' : choice === never ? 'never' : choice === undefined ? undefined : 'not-now';
	}
}
