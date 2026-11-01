import * as vscode from 'vscode';

import { integrationTargetOf } from '../lib/entire';
import { EditorPluginManagementUi } from '../providers/pluginManagementUi';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { CliRunner } from '../services/cli';
import { readExtensionSettings } from '../services/configuration';
import { PluginManagementService, type PluginManagementSource } from '../services/pluginManagement';
import { PluginService } from '../services/plugins';
import {
	checkPlugins,
	removePlugin,
	searchPluginIndex,
	showPluginInfo,
	updatePluginIndex,
	upgradeAllPlugins,
	upgradePlugin,
	withSafeNotifications,
	type PluginManagementDependencies,
} from './pluginManagement';
import { installPluginCommand, type PluginDependencies } from './plugins';

export interface PluginManagementWiring {
	readonly runner: CliRunner;
	/** The existing plugin flows: login, suggestions and the shared busy flag. */
	readonly plugins: PluginDependencies;
	readonly documents: GeneratedDocuments;
	/** Detects the Integrations view again after a change. */
	readonly refresh: () => Promise<void>;
}

/** The plugin name a row or a caller passed, when it is one. */
function nameOf(arg: unknown): string | undefined {
	if (typeof arg === 'string') {
		return arg;
	}
	const target = integrationTargetOf(arg);
	return target?.kind === 'plugin' ? target.name : undefined;
}

function folderOf(arg: unknown): string | undefined {
	return integrationTargetOf(arg)?.folder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Registers Plugin Info, Search, Update Index, Upgrade, Upgrade All, Remove and Check.
 *
 * Each command runs against the folder of the clicked row, or the first
 * workspace folder from the palette, so the CLI sees that folder's plugin
 * directory. Every disposable goes on `context.subscriptions`.
 */
export function registerPluginManagementCommands(
	context: vscode.ExtensionContext,
	wiring: PluginManagementWiring,
): { readonly checkSource: () => PluginManagementSource } {
	const ui = withSafeNotifications(new EditorPluginManagementUi(wiring.documents));
	const timeoutSeconds = () => readExtensionSettings().pluginTimeout;

	const pluginServiceFor = (folder: string | undefined) => new PluginService({ runner: wiring.runner, workspaceRoot: () => folder, timeoutSeconds });
	const sourceFor = (folder: string | undefined): PluginManagementSource =>
		new PluginManagementService({ runner: wiring.runner, plugins: pluginServiceFor(folder), workspaceRoot: () => folder, timeoutSeconds });
	const depsFor = (folder: string | undefined): PluginManagementDependencies => ({
		source: sourceFor(folder),
		acting: wiring.plugins.acting,
		ui,
		suggested: wiring.plugins.suggested,
		install: name => installPluginCommand({ ...wiring.plugins, source: pluginServiceFor(folder) }, name),
		refresh: wiring.refresh,
		running: wiring.plugins.running,
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.pluginInfo', async (arg?: unknown) => {
			await showPluginInfo(depsFor(folderOf(arg)), nameOf(arg));
		}),
		vscode.commands.registerCommand('entirely.searchPluginIndex', async () => {
			await searchPluginIndex(depsFor(folderOf(undefined)));
		}),
		vscode.commands.registerCommand('entirely.updatePluginIndex', async () => {
			await updatePluginIndex(depsFor(folderOf(undefined)));
		}),
		vscode.commands.registerCommand('entirely.upgradePlugin', async (arg?: unknown) => {
			await upgradePlugin(depsFor(folderOf(arg)), nameOf(arg));
		}),
		vscode.commands.registerCommand('entirely.upgradeAllPlugins', async (arg?: unknown) => {
			await upgradeAllPlugins(depsFor(folderOf(arg)));
		}),
		vscode.commands.registerCommand('entirely.removePlugin', async (arg?: unknown) => {
			await removePlugin(depsFor(folderOf(arg)), nameOf(arg));
		}),
		vscode.commands.registerCommand('entirely.checkPlugins', async (arg?: unknown) => {
			await checkPlugins(depsFor(folderOf(arg)));
		}),
	);
	return { checkSource: () => sourceFor(folderOf(undefined)) };
}
