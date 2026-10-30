import { isPluginName } from './plugins';
import { parseCliVersion, compareCliVersions } from './cliVersion';

/** The plugins suggested until the user's setting says otherwise. */
export const DEFAULT_SUGGESTED_PLUGINS: readonly string[] = ['graph', 'investigate', 'brain'];

/** The most plugin names the suggestion setting is read for. */
export const MAX_SUGGESTED_PLUGINS = 24;

/**
 * Reads the suggested plugin names from a setting value.
 *
 * A value that is not a list falls back to the defaults. In a list, an
 * entry that cannot name a plugin is dropped, and a name given twice is
 * kept once, so a typo in the setting never reaches the CLI.
 */
export function readSuggestedPlugins(value: unknown, fallback: readonly string[] = DEFAULT_SUGGESTED_PLUGINS): readonly string[] {
	if (!Array.isArray(value)) {
		return fallback;
	}
	const names: string[] = [];
	for (const entry of value as readonly unknown[]) {
		if (typeof entry !== 'string') {
			continue;
		}
		const name = entry.trim();
		if (isPluginName(name) && !names.some(known => known.toLowerCase() === name.toLowerCase())) {
			names.push(name);
		}
		if (names.length >= MAX_SUGGESTED_PLUGINS) {
			break;
		}
	}
	return names;
}

/** Whether the CLI can be asked about integrations at all. */
export type CliAvailability =
	| { readonly kind: 'ready' }
	| { readonly kind: 'absent' }
	| { readonly kind: 'broken'; readonly detail: string }
	| { readonly kind: 'old'; readonly version: string; readonly minimum: string };

/** What discovery found, in the shape this module needs. */
export type DiscoveredCli =
	| { readonly state: 'absent' }
	| { readonly state: 'available'; readonly version: string }
	| { readonly state: 'broken'; readonly detail: string };

/** Judges a discovery result against the oldest CLI the extension reads. */
export function judgeCli(discovery: DiscoveredCli, minimum: string): CliAvailability {
	if (discovery.state === 'absent') {
		return { kind: 'absent' };
	}
	if (discovery.state === 'broken') {
		return { kind: 'broken', detail: discovery.detail };
	}
	const found = parseCliVersion(discovery.version);
	const wanted = parseCliVersion(minimum);
	if (found && wanted && compareCliVersions(found, wanted) < 0) {
		return { kind: 'old', version: discovery.version, minimum };
	}
	return { kind: 'ready' };
}

/** What the view says when the CLI cannot be used, with the way out. */
export function describeCliUnavailable(cli: Exclude<CliAvailability, { kind: 'ready' }>): string {
	switch (cli.kind) {
		case 'absent':
			return 'The Entire CLI is not installed. Install it, then refresh this view.';
		case 'broken':
			return `The Entire CLI cannot be used: ${cli.detail}. Fix it or set entirely.cliPath, then refresh this view.`;
		case 'old':
			return `The Entire CLI is version ${cli.version}, older than the ${cli.minimum} this extension reads. Update the CLI, then refresh this view.`;
	}
}

/** Where a plugin is, as far as the CLI says. */
export type PluginState =
	/** Listed by `entire plugin list`. */
	| { readonly kind: 'installed'; readonly detail: string }
	/** Not listed, but the CLI answers for it (an `entire-<name>` binary on the PATH). */
	| { readonly kind: 'on-path' }
	/** The CLI says no such plugin is installed. */
	| { readonly kind: 'missing' }
	/** The CLI could not say. A plain failure is never read as missing. */
	| { readonly kind: 'unknown'; readonly detail: string };

export interface PluginRow {
	readonly name: string;
	/** Whether the name is one of the suggested plugins, rather than one that was found installed. */
	readonly suggested: boolean;
	readonly state: PluginState;
}

/** The words for a plugin's state. */
export function describePluginState(state: PluginState): string {
	switch (state.kind) {
		case 'installed':
			return state.detail.length > 0 ? `installed · ${state.detail}` : 'installed';
		case 'on-path':
			return 'available on PATH';
		case 'missing':
			return 'not installed';
		case 'unknown':
			return `unknown · ${state.detail}`;
	}
}

/** Whether the plugin can be installed from its row. */
export function isInstallable(state: PluginState): boolean {
	return state.kind === 'missing';
}

/** Whether the editor is offered the server, as far as this folder's settings go. */
export type McpEditorState =
	| { readonly kind: 'offered' }
	| { readonly kind: 'off' }
	| { readonly kind: 'unavailable'; readonly reason: 'absent' | 'old' | 'broken'; readonly detail: string };

export function describeMcpEditor(state: McpEditorState): string {
	switch (state.kind) {
		case 'offered':
			return 'offered to the editor';
		case 'off':
			return 'off in this workspace';
		case 'unavailable':
			return state.reason === 'old' ? 'the CLI lacks mcp' : state.detail;
	}
}

/** The project files an Entire MCP entry can live in. */
export type McpConfigFile = '.mcp.json' | '.vscode/mcp.json';

/** The key the file lists its servers under. */
export type McpServersKey = 'mcpServers' | 'servers';

export interface McpConfigTarget {
	readonly file: McpConfigFile;
	readonly key: McpServersKey;
}

export type McpConfigState =
	| { readonly kind: 'configured'; readonly file: McpConfigFile }
	| { readonly kind: 'not-configured'; readonly target: McpConfigTarget }
	| { readonly kind: 'unreadable'; readonly file: McpConfigFile; readonly detail: string };

export function describeMcpConfig(state: McpConfigState): string {
	switch (state.kind) {
		case 'configured':
			return `in ${state.file}`;
		case 'not-configured':
			return `not in ${state.target.file}`;
		case 'unreadable':
			return `${state.file} is not plain JSON`;
	}
}

export interface FolderIntegrations {
	readonly name: string;
	readonly path: string;
	/** Suggested plugins first, then every other plugin the CLI lists. */
	readonly plugins: readonly PluginRow[];
	/** Set when the plugin list could not be read at all. */
	readonly pluginsDetail?: string;
	readonly mcp: {
		readonly editor: McpEditorState;
		readonly config: McpConfigState;
	};
}

export type IntegrationReading =
	| { readonly kind: 'no-cli'; readonly cli: Exclude<CliAvailability, { kind: 'ready' }> }
	| { readonly kind: 'no-folder' }
	| { readonly kind: 'folders'; readonly folders: readonly FolderIntegrations[] };

/** The suggested plugins the CLI says are missing in at least one folder, each once. */
export function missingPlugins(reading: IntegrationReading): readonly string[] {
	if (reading.kind !== 'folders') {
		return [];
	}
	const names: string[] = [];
	for (const folder of reading.folders) {
		for (const row of folder.plugins) {
			if (row.suggested && row.state.kind === 'missing' && !names.includes(row.name)) {
				names.push(row.name);
			}
		}
	}
	return names;
}

/** What a row's action acts on. */
export type IntegrationTarget =
	| { readonly kind: 'plugin'; readonly name: string; readonly folder: string }
	| { readonly kind: 'mcp-enable'; readonly folder: string }
	| { readonly kind: 'mcp-config'; readonly folder: string };

/** Reads the target out of the tree node a view command is given. */
export function integrationTargetOf(node: unknown): IntegrationTarget | undefined {
	if (typeof node !== 'object' || node === null || !('target' in node)) {
		return undefined;
	}
	const target = (node as { target: unknown }).target;
	if (typeof target !== 'object' || target === null) {
		return undefined;
	}
	const { kind, folder, name } = target as Record<string, unknown>;
	if (typeof folder !== 'string' || folder.length === 0) {
		return undefined;
	}
	if (kind === 'plugin') {
		return typeof name === 'string' && isPluginName(name) ? { kind, name, folder } : undefined;
	}
	return kind === 'mcp-enable' || kind === 'mcp-config' ? { kind, folder } : undefined;
}
