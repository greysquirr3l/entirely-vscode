import {
	type CliAvailability,
	type FolderIntegrations,
	type InstalledPlugin,
	type IntegrationReading,
	type McpConfigState,
	type McpEditorState,
	type PluginRow,
} from '../lib/entire';
import type { McpServerSource } from './mcpServer';
import type { PluginAvailability } from './plugins';
import type { Read } from './controlPlane';

/** A workspace folder the integrations are read for. */
export interface IntegrationFolder {
	readonly name: string;
	readonly path: string;
}

/** What detection needs to know about plugins in one folder's environment. */
export interface PluginProbe {
	installed(): Promise<Read<readonly InstalledPlugin[]>>;
	availability(names: readonly string[]): Promise<ReadonlyMap<string, PluginAvailability>>;
}

export interface IntegrationDetectionOptions {
	readonly cli: () => Promise<CliAvailability>;
	readonly folders: () => readonly IntegrationFolder[];
	/** The suggested plugins, from the user's setting, read at each detection. */
	readonly suggested: () => readonly string[];
	/** A probe whose CLI calls run in this folder, so its PATH and plugin directory apply. */
	readonly plugins: (folder: string) => PluginProbe;
	readonly mcp: (folder: string) => McpServerSource;
	/** The effective `entirely.mcpServerEnabled` for the folder. */
	readonly mcpEnabled: (folder: string) => boolean;
	readonly config: (folder: string) => Promise<McpConfigState>;
}

export interface IntegrationSource {
	detect(): Promise<IntegrationReading>;
}

/**
 * Works out, for each workspace folder, which Entire integrations the CLI
 * can reach from there.
 *
 * Every CLI call runs with the folder as its working directory, because a
 * per-folder environment (direnv, `ENTIRE_PLUGIN_DIR`) decides which
 * plugins the CLI sees. Nothing is cached and nothing is scheduled: the
 * caller decides when to detect again.
 */
export class IntegrationDetector implements IntegrationSource {
	constructor(private readonly options: IntegrationDetectionOptions) {}

	async detect(): Promise<IntegrationReading> {
		const cli = await this.options.cli();
		if (cli.kind !== 'ready') {
			return { kind: 'no-cli', cli };
		}
		const folders = this.options.folders();
		if (folders.length === 0) {
			return { kind: 'no-folder' };
		}
		const suggested = this.options.suggested();
		return { kind: 'folders', folders: await Promise.all(folders.map(folder => this.detectFolder(folder, suggested))) };
	}

	private async detectFolder(folder: IntegrationFolder, suggested: readonly string[]): Promise<FolderIntegrations> {
		const [plugins, mcp, config] = await Promise.all([
			this.detectPlugins(folder.path, suggested),
			this.detectMcp(folder.path),
			this.options.config(folder.path),
		]);
		return { name: folder.name, path: folder.path, ...plugins, mcp: { editor: mcp, config } };
	}

	private async detectPlugins(
		folder: string,
		suggested: readonly string[],
	): Promise<{ readonly plugins: readonly PluginRow[]; readonly pluginsDetail?: string }> {
		const probe = this.options.plugins(folder);
		const listed = await probe.installed();
		if (!listed.ok) {
			return {
				plugins: suggested.map(name => ({ name, suggested: true, state: { kind: 'unknown', detail: listed.detail } })),
				pluginsDetail: listed.detail,
			};
		}
		const installed = listed.value;
		const held = (name: string) => installed.find(plugin => plugin.name.toLowerCase() === name.toLowerCase());
		const asked = await probe.availability(suggested.filter(name => held(name) === undefined));

		const rows: PluginRow[] = suggested.map(name => {
			const plugin = held(name);
			if (plugin) {
				return { name, suggested: true, state: { kind: 'installed', detail: plugin.detail } };
			}
			const answer = asked.get(name) ?? { kind: 'unknown', detail: 'the CLI gave no answer' };
			return { name, suggested: true, state: answer };
		});
		for (const plugin of installed) {
			if (!suggested.some(name => name.toLowerCase() === plugin.name.toLowerCase())) {
				rows.push({ name: plugin.name, suggested: false, state: { kind: 'installed', detail: plugin.detail } });
			}
		}
		return { plugins: rows };
	}

	private async detectMcp(folder: string): Promise<McpEditorState> {
		const probe = await this.options.mcp(folder).probe();
		if (!probe.ok) {
			return { kind: 'unavailable', reason: probe.reason, detail: probe.detail };
		}
		return this.options.mcpEnabled(folder) ? { kind: 'offered' } : { kind: 'off' };
	}
}
