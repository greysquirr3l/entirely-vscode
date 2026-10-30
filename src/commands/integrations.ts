import { confirmProjectMcp, projectMcpArguments, type ControlConfirmation } from '../lib/entire';
import type { IntegrationFolder } from '../services/integrationDetection';
import type { McpServerSource } from '../services/mcpServer';
import type { ProjectMcpSource } from '../services/projectMcpConfig';
import { startMcpServer, type McpDependencies } from './mcp';
import { installPluginCommand, type PluginDependencies, type PluginResult } from './plugins';

/** What the integration flows ask of the editor. */
export interface IntegrationUi {
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
	/** Says why a file was left alone and offers the text to add by hand. */
	showSnippet(message: string, snippet: string): Promise<void>;
}

export interface AddMcpDependencies {
	readonly config: ProjectMcpSource;
	/** The source whose launch line is the CLI's own `mcp` arguments, for the folder. */
	readonly mcp: (folder: string) => McpServerSource;
	readonly ui: IntegrationUi;
	readonly refresh: () => Promise<void>;
}

export type AddMcpResult = 'added' | 'present' | 'cancelled' | 'unavailable' | 'refused' | 'failed';

/**
 * Adds the Entire server to the folder's project MCP configuration.
 *
 * `confirmed` is true when the question was already put to the person in
 * a form that named the file (the one-time offer). A row's action asks
 * its own question first. Nothing is written when the file cannot be
 * changed without disturbing it; the text to add is shown instead.
 */
export async function addMcpToProject(deps: AddMcpDependencies, folder: IntegrationFolder, confirmed: boolean): Promise<AddMcpResult> {
	const { ui } = deps;
	const probe = await deps.mcp(folder.path).probe();
	if (!probe.ok) {
		await ui.warn(`The Entire MCP server cannot be added: ${probe.detail}.`);
		return 'unavailable';
	}
	const args = projectMcpArguments(probe.launch.args);
	if (args.length === 0) {
		await ui.warn('The Entire MCP server cannot be added: the CLI gave no launch arguments.');
		return 'unavailable';
	}
	if (!confirmed) {
		const { target, exists } = await deps.config.plan(folder.path);
		if (!(await ui.confirm(confirmProjectMcp(target, folder.path, exists)))) {
			return 'cancelled';
		}
	}
	const outcome = await deps.config.add(folder.path, args);
	switch (outcome.kind) {
		case 'added':
			await ui.inform(`The Entire MCP server was ${outcome.created ? 'added to a new' : 'added to'} ${outcome.file}. Other entries were not changed.`);
			await deps.refresh();
			return 'added';
		case 'present':
			await ui.inform(`${outcome.file} already lists the Entire server. Nothing was changed.`);
			await deps.refresh();
			return 'present';
		case 'refused':
			await ui.showSnippet(`${outcome.file} was not changed: ${outcome.detail}. Add this to it yourself:`, outcome.snippet);
			return 'refused';
		case 'failed':
			await ui.warn(`${outcome.file} could not be written: ${outcome.detail}.`);
			return 'failed';
	}
}

export interface InstallFromRowDependencies {
	readonly plugins: PluginDependencies;
	readonly refresh: () => Promise<void>;
}

/** Runs the plugin install flow for a row, then detects again. */
export async function installFromRow(deps: InstallFromRowDependencies, name: string): Promise<PluginResult> {
	const result = await installPluginCommand(deps.plugins, name);
	await deps.refresh();
	return result;
}

export interface EnableMcpDependencies {
	readonly mcp: McpDependencies;
	/** The effective `entirely.mcpServerEnabled` for the folder. */
	readonly enabledFor: (folder: string) => boolean;
	readonly ui: IntegrationUi;
	readonly refresh: () => Promise<void>;
}

/**
 * Turns the MCP server on for a folder through the existing flow that
 * asks before it changes the setting, then detects again.
 *
 * The flow changes the user setting. A workspace setting that says
 * otherwise still wins, and the row is left off; the person is told why.
 */
export async function enableMcpFromRow(deps: EnableMcpDependencies, folder: IntegrationFolder): Promise<string> {
	const result = await startMcpServer({ ...deps.mcp, enabled: () => deps.enabledFor(folder.path) });
	await deps.refresh();
	if (result !== 'disabled' && result !== 'unavailable' && !deps.enabledFor(folder.path)) {
		await deps.ui.warn(`The Entire MCP server is still off in ${folder.name}: a setting in that workspace overrides your user setting. Change "entirely.mcpServerEnabled" there.`);
	}
	return result;
}
