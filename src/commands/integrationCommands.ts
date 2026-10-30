import * as vscode from 'vscode';

import { integrationTargetOf, judgeCli } from '../lib/entire';
import { IntegrationsProvider } from '../providers/integrationsProvider';
import type { CliRunner } from '../services/cli';
import { mcpServerEnabledIn, readExtensionSettings } from '../services/configuration';
import { IntegrationDetector, type IntegrationFolder } from '../services/integrationDetection';
import { IntegrationOffers } from '../services/integrationOffers';
import { McpServerService } from '../services/mcpServer';
import { PluginService } from '../services/plugins';
import { ProjectMcpConfig } from '../services/projectMcpConfig';
import { EditorIntegrationUi } from './integrationUi';
import { addMcpToProject, enableMcpFromRow, installFromRow } from './integrations';
import type { McpDependencies } from './mcp';
import { installPluginCommand, type PluginDependencies } from './plugins';

export interface IntegrationWiring {
	readonly runner: CliRunner;
	/** The plugin flows the rows reuse. */
	readonly plugins: PluginDependencies;
	/** The MCP flows the rows reuse. */
	readonly mcp: McpDependencies;
	readonly log: { warn(line: string): void };
}

function workspaceFolders(): IntegrationFolder[] {
	return (vscode.workspace.workspaceFolders ?? []).map(folder => ({ name: folder.name, path: folder.uri.fsPath }));
}

function folderOf(path: string): IntegrationFolder {
	return workspaceFolders().find(folder => folder.path === path) ?? { name: path, path };
}

/**
 * Creates the Integrations view, its commands and the one-time offers.
 *
 * Detection runs when the view opens, on the refresh command, after an
 * install, enable or add, and when workspace folders or the settings that
 * decide a row change. Nothing here sets a timer.
 */
export function registerIntegrations(context: vscode.ExtensionContext, wiring: IntegrationWiring): IntegrationsProvider {
	const { runner } = wiring;
	const ui = new EditorIntegrationUi();
	const config = new ProjectMcpConfig();
	const mcpFor = (folder: string) => new McpServerService({ runner, workspaceRoot: () => folder });

	const provider = new IntegrationsProvider(
		new IntegrationDetector({
			cli: async () => judgeCli(await runner.discover(), readExtensionSettings().minimumCliVersion),
			folders: workspaceFolders,
			suggested: () => readExtensionSettings().suggestedPlugins,
			plugins: folder =>
				new PluginService({ runner, workspaceRoot: () => folder, timeoutSeconds: () => readExtensionSettings().pluginTimeout }),
			mcp: mcpFor,
			mcpEnabled: mcpServerEnabledIn,
			config: folder => config.inspect(folder),
		}),
	);
	const refresh = () => provider.refresh();
	const addFlow = { config, mcp: mcpFor, ui, refresh };

	const offers = new IntegrationOffers({
		machine: context.globalState,
		workspace: context.workspaceState,
		enabled: () => readExtensionSettings().offerIntegrationInstall,
		install: name => installPluginCommand(wiring.plugins, name),
		addToProject: folder => addMcpToProject(addFlow, folder, true),
		refresh,
		ui,
	});

	const view = vscode.window.createTreeView('entirely.integrations', { treeDataProvider: provider });
	const showState = () => {
		view.message = provider.viewMessage;
		void vscode.commands.executeCommand('setContext', 'entirely.integrationsState', provider.state);
	};

	context.subscriptions.push(
		provider,
		view,
		provider.onDidChangeTreeData(showState),
		provider.onDidDetect(reading => {
			offers.offer(reading).catch((error: unknown) => {
				wiring.log.warn(`integration offer failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refreshIfStarted()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('entirely.suggestedPlugins') || event.affectsConfiguration('entirely.mcpServerEnabled')) {
				void provider.refreshIfStarted();
			}
		}),
		vscode.commands.registerCommand('entirely.refreshIntegrations', () => refresh()),
		vscode.commands.registerCommand('entirely.installIntegration', async (node?: unknown) => {
			const target = integrationTargetOf(node);
			if (target?.kind === 'plugin') {
				await installFromRow({ plugins: wiring.plugins, refresh }, target.name);
			}
		}),
		vscode.commands.registerCommand('entirely.enableMcpIntegration', async (node?: unknown) => {
			const target = integrationTargetOf(node);
			if (target?.kind === 'mcp-enable') {
				await enableMcpFromRow({ mcp: wiring.mcp, enabledFor: mcpServerEnabledIn, ui, refresh }, folderOf(target.folder));
			}
		}),
		vscode.commands.registerCommand('entirely.addMcpToProject', async (node?: unknown) => {
			const target = integrationTargetOf(node);
			if (target?.kind === 'mcp-config') {
				await addMcpToProject(addFlow, folderOf(target.folder), false);
			}
		}),
	);
	return provider;
}
