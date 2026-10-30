import * as vscode from 'vscode';

import {
	describeCliUnavailable,
	describeMcpConfig,
	describeMcpEditor,
	describePluginState,
	isInstallable,
	type FolderIntegrations,
	type IntegrationReading,
	type IntegrationTarget,
	type PluginRow,
} from '../lib/entire';
import type { IntegrationSource } from '../services/integrationDetection';
import { BUILT_IN_DETAIL } from '../services/plugins';

export type IntegrationNode =
	| {
			readonly kind: 'group';
			readonly label: string;
			readonly description?: string;
			readonly icon: string;
			readonly children: readonly IntegrationNode[];
	  }
	| {
			readonly kind: 'row';
			readonly label: string;
			readonly description: string;
			readonly tooltip: string;
			readonly icon: string;
			readonly contextValue?: string;
			readonly target?: IntegrationTarget;
	  };

/** The context values the manifest's inline actions match on. */
export const PLUGIN_MISSING = 'entirely.integrationPluginMissing';
export const MCP_OFF = 'entirely.integrationMcpOff';
export const MCP_CONFIG_ADDABLE = 'entirely.integrationMcpConfigAddable';

function pluginNode(folder: FolderIntegrations, row: PluginRow): IntegrationNode {
	const installable = isInstallable(row.state);
	const icons = { installed: 'check', 'on-path': 'check', missing: 'cloud-download', unknown: 'question' } as const;
	return {
		kind: 'row',
		label: row.name,
		description: describePluginState(row.state),
		tooltip: installable
			? `The "${row.name}" plugin is not installed for ${folder.name}. Use Install to run "entire plugin install ${row.name}" after a question.`
			: row.state.kind === 'unknown' && row.state.detail === BUILT_IN_DETAIL
				? `"${row.name}" is also an Entire CLI command, so it cannot be told apart from a plugin on the PATH.`
				: `${row.name}: ${describePluginState(row.state)}`,
		icon: icons[row.state.kind],
		contextValue: installable ? PLUGIN_MISSING : undefined,
		target: installable ? { kind: 'plugin', name: row.name, folder: folder.path } : undefined,
	};
}

function mcpNode(folder: FolderIntegrations): IntegrationNode {
	const { editor, config } = folder.mcp;
	if (editor.kind === 'unavailable') {
		const detail = describeMcpEditor(editor);
		return {
			kind: 'row',
			label: 'MCP server',
			description: config.kind === 'configured' ? `${detail} · ${describeMcpConfig(config)}` : detail,
			tooltip: `The Entire MCP server cannot be offered here: ${editor.detail}.`,
			icon: 'circle-slash',
		};
	}
	const editorOff = editor.kind === 'off';
	const addable = config.kind !== 'configured';
	return {
		kind: 'group',
		label: 'MCP server',
		description: `${describeMcpEditor(editor)} · ${describeMcpConfig(config)}`,
		icon: 'plug',
		children: [
			{
				kind: 'row',
				label: 'In the editor',
				description: describeMcpEditor(editor),
				tooltip: editorOff
					? 'The Entire MCP server is turned off here by entirely.mcpServerEnabled. Use Turn On to change the setting.'
					: 'The editor lists the Entire MCP server and starts it when asked.',
				icon: editorOff ? 'circle-outline' : 'check',
				contextValue: editorOff ? MCP_OFF : undefined,
				target: editorOff ? { kind: 'mcp-enable', folder: folder.path } : undefined,
			},
			{
				kind: 'row',
				label: 'In the project',
				description: describeMcpConfig(config),
				tooltip:
					config.kind === 'configured'
						? `${config.file} lists the Entire server; nothing is added.`
						: config.kind === 'unreadable'
							? `${config.file} ${config.detail}, so Entirely will not change it. Use Add to see what to add by hand.`
							: `Use Add to put the Entire server in ${config.target.file}. A question names the file first.`,
				icon: config.kind === 'configured' ? 'check' : 'circle-outline',
				contextValue: addable ? MCP_CONFIG_ADDABLE : undefined,
				target: addable ? { kind: 'mcp-config', folder: folder.path } : undefined,
			},
		],
	};
}

function folderNodes(folder: FolderIntegrations): IntegrationNode[] {
	const nodes: IntegrationNode[] = folder.plugins.map(row => pluginNode(folder, row));
	if (folder.pluginsDetail !== undefined) {
		nodes.push({
			kind: 'row',
			label: 'Plugins',
			description: 'could not be listed',
			tooltip: `${folder.pluginsDetail}`,
			icon: 'warning',
		});
	}
	nodes.push(mcpNode(folder));
	return nodes;
}

/**
 * Lays a reading out as rows: directly for one folder, under a group per
 * folder when there are several.
 */
export function buildIntegrationNodes(reading: IntegrationReading): IntegrationNode[] {
	if (reading.kind !== 'folders') {
		return [];
	}
	if (reading.folders.length === 1) {
		return folderNodes(reading.folders[0]);
	}
	return reading.folders.map(folder => ({
		kind: 'group',
		label: folder.name,
		description: folder.path,
		icon: 'folder',
		children: folderNodes(folder),
	}));
}

/**
 * The Integrations view: which Entire plugins and the MCP server are
 * available in each workspace folder.
 *
 * It detects when it is first opened, when asked, and when the caller
 * says something relevant changed. It never detects on a timer.
 */
export class IntegrationsProvider implements vscode.TreeDataProvider<IntegrationNode>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<IntegrationNode | undefined>();
	private readonly detected = new vscode.EventEmitter<IntegrationReading>();
	private reading: IntegrationReading | undefined;
	private failure: string | undefined;
	private loading = false;
	private started = false;
	private generation = 0;

	readonly onDidChangeTreeData: vscode.Event<IntegrationNode | undefined> = this.changed.event;
	/** Fires after each detection that was not replaced by a newer one. */
	readonly onDidDetect: vscode.Event<IntegrationReading> = this.detected.event;

	constructor(private readonly source: IntegrationSource) {}

	/** Detects again. An answer to a detection that a newer one replaced is dropped. */
	async refresh(): Promise<void> {
		const generation = ++this.generation;
		this.started = true;
		this.loading = true;
		this.changed.fire(undefined);
		let reading: IntegrationReading | undefined;
		let failure: string | undefined;
		try {
			reading = await this.source.detect();
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		if (generation !== this.generation) {
			return;
		}
		this.loading = false;
		this.reading = reading;
		this.failure = failure;
		this.changed.fire(undefined);
		if (reading) {
			this.detected.fire(reading);
		}
	}

	/** Detects again only if something has detected before, so a setting change does not wake an unused view. */
	async refreshIfStarted(): Promise<void> {
		if (this.started) {
			await this.refresh();
		}
	}

	/** The context-key value the view's welcome content keys on. */
	get state(): 'no-cli' | 'no-folder' | 'ready' {
		return this.reading?.kind === 'no-cli' ? 'no-cli' : this.reading?.kind === 'no-folder' ? 'no-folder' : 'ready';
	}

	get viewMessage(): string | undefined {
		if (this.failure !== undefined) {
			return `Integrations could not be checked: ${this.failure}`;
		}
		if (this.loading && this.reading === undefined) {
			return 'Checking integrations…';
		}
		return this.reading?.kind === 'no-cli' ? describeCliUnavailable(this.reading.cli) : undefined;
	}

	getTreeItem(node: IntegrationNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = node.description;
			item.iconPath = new vscode.ThemeIcon(node.icon);
			return item;
		}
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
		item.description = node.description;
		item.tooltip = node.tooltip;
		item.iconPath = new vscode.ThemeIcon(node.icon);
		item.contextValue = node.contextValue;
		return item;
	}

	getChildren(node?: IntegrationNode): IntegrationNode[] {
		if (node) {
			return node.kind === 'group' ? [...node.children] : [];
		}
		if (!this.started) {
			void this.refresh();
			return [];
		}
		return this.reading ? buildIntegrationNodes(this.reading) : [];
	}

	dispose(): void {
		this.generation += 1;
		this.changed.dispose();
		this.detected.dispose();
	}
}
