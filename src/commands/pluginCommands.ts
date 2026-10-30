import * as vscode from 'vscode';

import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { EntireMcpProvider } from '../services/mcpProvider';
import type { McpServerSource } from '../services/mcpServer';
import { copyMcpConfig, startMcpServer, type McpDependencies, type McpUi } from './mcp';
import { EditorPluginUi } from './pluginUi';
import { installPluginCommand, runPluginCommand, type PluginDependencies } from './plugins';

const MCP_SETTING = 'mcpServerEnabled';

/** The MCP commands' questions, asked in the editor. */
export class EditorMcpUi implements McpUi {
	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}

	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}

	async showServers(): Promise<boolean> {
		try {
			await vscode.commands.executeCommand('workbench.mcp.listServer');
			return true;
		} catch {
			return false;
		}
	}

	async offerEnable(scope: string): Promise<boolean> {
		const action = 'Turn On';
		const choice = await vscode.window.showWarningMessage(
			'The Entire MCP server is turned off.',
			{
				modal: true,
				detail: `This changes ${scope} "entirely.${MCP_SETTING}" to true. No MCP configuration file is written; the editor starts the server itself.`,
			},
			action,
		);
		return choice === action;
	}

	async copy(text: string): Promise<void> {
		await vscode.env.clipboard.writeText(text);
	}
}

export interface PluginCommandDependencies {
	readonly plugins: Omit<PluginDependencies, 'ui'>;
	readonly documents: GeneratedDocuments;
	readonly mcp: {
		readonly source: McpServerSource;
		readonly provider: EntireMcpProvider;
		readonly enabled: () => boolean;
	};
}

/** Registers the plugin and MCP commands. */
export function registerPluginCommands(
	context: vscode.ExtensionContext,
	deps: PluginCommandDependencies,
): { readonly plugins: PluginDependencies; readonly mcp: McpDependencies } {
	const pluginDeps: PluginDependencies = { ...deps.plugins, ui: new EditorPluginUi(deps.documents) };
	const mcpUi = new EditorMcpUi();
	const mcpDeps: McpDependencies = {
		source: deps.mcp.source,
		ui: mcpUi,
		enabled: deps.mcp.enabled,
		enable: async () => {
			await vscode.workspace.getConfiguration('entirely').update(MCP_SETTING, true, vscode.ConfigurationTarget.Global);
		},
		refresh: () => deps.mcp.provider.refresh(),
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.runPluginCommand', async (name?: unknown) => {
			await runPluginCommand(pluginDeps, typeof name === 'string' ? name : undefined);
		}),
		vscode.commands.registerCommand('entirely.installPlugin', async (name?: unknown) => {
			await installPluginCommand(pluginDeps, typeof name === 'string' ? name : undefined);
		}),
		vscode.commands.registerCommand('entirely.startMcpServer', async () => {
			await startMcpServer(mcpDeps);
		}),
		vscode.commands.registerCommand('entirely.copyMcpConfig', async () => {
			await copyMcpConfig(mcpDeps);
		}),
	);
	return { plugins: pluginDeps, mcp: mcpDeps };
}
