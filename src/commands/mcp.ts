import { describeMcpScope, mcpClientConfig } from '../lib/entire';
import type { McpServerSource } from '../services/mcpServer';

/** What the MCP commands need from the editor. */
export interface McpUi {
	warn(message: string): Promise<void>;
	inform(message: string): Promise<void>;
	/** Asks the editor to list its MCP servers, where one can be started. False when the editor cannot. */
	showServers(): Promise<boolean>;
	/** Offers to turn the setting on. True when the person accepts. */
	offerEnable(scope: string): Promise<boolean>;
	copy(text: string): Promise<void>;
}

export interface McpDependencies {
	readonly source: McpServerSource;
	readonly ui: McpUi;
	readonly enabled: () => boolean;
	readonly enable: () => Promise<void>;
	/** Names the setting `enable` changes, as the question puts it. Defaults to the user setting. */
	readonly scopeLabel?: () => string;
	/** Tells the editor to read the server list again. */
	readonly refresh: () => void;
}

export type McpResult = 'listed' | 'unavailable' | 'disabled' | 'copied';

/**
 * Makes the Entire MCP server available to the editor's agent and shows
 * where to start it.
 *
 * The server is offered through the editor's provider API, so no
 * configuration file is written. The editor starts the process itself.
 */
export async function startMcpServer(deps: McpDependencies): Promise<McpResult> {
	const { ui } = deps;
	if (!deps.enabled()) {
		if (!(await ui.offerEnable(deps.scopeLabel?.() ?? describeMcpScope('user')))) {
			return 'disabled';
		}
		await deps.enable();
	}
	const probe = await deps.source.probe();
	if (!probe.ok) {
		await ui.warn(`The Entire MCP server cannot be started: ${probe.detail}.`);
		return 'unavailable';
	}
	deps.refresh();
	if (!(await ui.showServers())) {
		await ui.inform('The Entire MCP server is available. Open the MCP servers list in the editor and start "Entire".');
	}
	return 'listed';
}

/** Copies a client configuration for an agent that is set up by hand. Nothing is written to disk. */
export async function copyMcpConfig(deps: Pick<McpDependencies, 'source' | 'ui'>): Promise<McpResult> {
	const probe = await deps.source.probe();
	if (!probe.ok) {
		await deps.ui.warn(`The MCP configuration cannot be made: ${probe.detail}.`);
		return 'unavailable';
	}
	await deps.ui.copy(mcpClientConfig(probe.launch));
	await deps.ui.inform('The MCP server configuration was copied. Paste it into your agent\'s MCP settings; Entirely did not change any file.');
	return 'copied';
}
