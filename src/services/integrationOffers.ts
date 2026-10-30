import { missingPlugins, type IntegrationReading, type McpConfigFile } from '../lib/entire';
import type { IntegrationFolder } from './integrationDetection';

/** The part of the editor's `Memento` the offers need. */
export interface OfferState {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): PromiseLike<void>;
}

export type PluginOfferAnswer = 'install' | 'not-now';
export type ProjectOfferAnswer = 'add' | 'not-now' | 'never';

/** The questions the offers ask. A dismissed question comes back as undefined. */
export interface OfferUi {
	offerPlugins(names: readonly string[]): Promise<PluginOfferAnswer | undefined>;
	/** Which of the missing plugins to install; none or undefined means none. */
	pickPlugins(names: readonly string[]): Promise<readonly string[] | undefined>;
	offerProjectConfig(folder: IntegrationFolder, file: McpConfigFile): Promise<ProjectOfferAnswer | undefined>;
}

export interface OfferDependencies {
	/** Machine-wide: the editor's global state. */
	readonly machine: OfferState;
	/** Per workspace: the editor's workspace state. */
	readonly workspace: OfferState;
	/** The `entirely.offerIntegrationInstall` setting. */
	readonly enabled: () => boolean;
	/** Runs the existing install flow, which asks its own question. */
	readonly install: (name: string) => Promise<unknown>;
	/** Adds the Entire server to the folder's MCP configuration; the offer was the confirmation. */
	readonly addToProject: (folder: IntegrationFolder) => Promise<unknown>;
	readonly refresh: () => Promise<void>;
	readonly ui: OfferUi;
}

/** The key that remembers the plugin offer was shown on this machine. */
export const PLUGIN_OFFER_KEY = 'entirely.integrationInstallOffered';

/** The key that remembers the MCP configuration question was asked for a project. */
export function projectOfferKey(folder: string): string {
	return `entirely.mcpConfigOffered:${folder}`;
}

/**
 * The two one-time questions: install the missing plugins (once per
 * machine) and add the MCP server to a project's configuration (once per
 * project).
 *
 * Each is recorded when it is shown, before the answer, so a dismissed
 * notification counts the same as a refusal and the question is never
 * asked twice. A reading that is not about a usable CLI asks nothing.
 */
export class IntegrationOffers {
	private busy = false;
	private readonly asking = new Set<string>();

	constructor(private readonly deps: OfferDependencies) {}

	/** Offers the missing suggested plugins. True when the question was shown. */
	async offerPlugins(reading: IntegrationReading): Promise<boolean> {
		const names = missingPlugins(reading);
		if (!this.deps.enabled() || this.busy || names.length === 0 || this.deps.machine.get<boolean>(PLUGIN_OFFER_KEY) === true) {
			return false;
		}
		this.busy = true;
		try {
			await this.deps.machine.update(PLUGIN_OFFER_KEY, true);
			if ((await this.deps.ui.offerPlugins(names)) !== 'install') {
				return true;
			}
			const picked = (await this.deps.ui.pickPlugins(names)) ?? [];
			for (const name of picked.filter(item => names.includes(item))) {
				await this.deps.install(name);
			}
			if (picked.length > 0) {
				await this.deps.refresh();
			}
			return true;
		} finally {
			this.busy = false;
		}
	}

	/** Asks, once per project, whether to add the server to the project's MCP configuration. Returns the folders asked about. */
	async offerProjects(reading: IntegrationReading): Promise<readonly string[]> {
		if (reading.kind !== 'folders' || !this.deps.enabled()) {
			return [];
		}
		const asked: string[] = [];
		for (const folder of reading.folders) {
			const key = projectOfferKey(folder.path);
			if (
				folder.mcp.editor.kind === 'unavailable' ||
				folder.mcp.config.kind !== 'not-configured' ||
				this.asking.has(key) ||
				this.deps.workspace.get<boolean>(key) === true
			) {
				continue;
			}
			this.asking.add(key);
			try {
				await this.deps.workspace.update(key, true);
				asked.push(folder.path);
				const answer = await this.deps.ui.offerProjectConfig(folder, folder.mcp.config.target.file);
				if (answer === 'add') {
					await this.deps.addToProject(folder);
				}
			} finally {
				this.asking.delete(key);
			}
		}
		return asked;
	}

	/** Runs both offers, plugins first. */
	async offer(reading: IntegrationReading): Promise<void> {
		await this.offerPlugins(reading);
		await this.offerProjects(reading);
	}
}
