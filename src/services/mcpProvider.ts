import * as vscode from 'vscode';

import { MCP_PROVIDER_ID, MCP_SERVER_LABEL } from '../lib/entire';
import type { McpServerSource } from './mcpServer';

/**
 * Offers `entire mcp` to the editor's own agent.
 *
 * Registering a provider writes no configuration: the editor lists the
 * server and starts the process itself, as a child of the extension
 * host, and stops it when it is turned off or the host exits. The
 * launch line is worked out again each time, so a moved CLI or a
 * changed login is followed.
 */
export class EntireMcpProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeMcpServerDefinitions: vscode.Event<void> = this.changed.event;

	constructor(
		private readonly source: McpServerSource,
		private readonly enabled: () => boolean,
	) {}

	/** Tells the editor to ask for the servers again. */
	refresh(): void {
		this.changed.fire();
	}

	async provideMcpServerDefinitions(): Promise<vscode.McpStdioServerDefinition[]> {
		if (!this.enabled()) {
			return [];
		}
		const probe = await this.source.probe();
		return probe.ok ? [definitionFor(probe.launch)] : [];
	}

	async resolveMcpServerDefinition(server: vscode.McpStdioServerDefinition): Promise<vscode.McpStdioServerDefinition | undefined> {
		const probe = await this.source.probe();
		if (!probe.ok) {
			void vscode.window.showWarningMessage(`The Entire MCP server cannot start: ${probe.detail}.`);
			return undefined;
		}
		server.command = probe.launch.command;
		server.args = [...probe.launch.args];
		server.env = { ...probe.launch.env };
		return server;
	}

	dispose(): void {
		this.changed.dispose();
	}
}

function definitionFor(launch: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> }): vscode.McpStdioServerDefinition {
	return new vscode.McpStdioServerDefinition(MCP_SERVER_LABEL, launch.command, [...launch.args], { ...launch.env });
}

/** Registers the provider under the id the manifest declares. */
export function registerMcpProvider(provider: EntireMcpProvider): vscode.Disposable {
	return vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider);
}
