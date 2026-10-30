/** How an editor or agent starts the Entire MCP server. */
export interface McpLaunch {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

/** The name the server is listed under. */
export const MCP_SERVER_LABEL = 'Entire';

/** The identifier of the provider the manifest declares. */
export const MCP_PROVIDER_ID = 'entirely.entireMcpServers';

/**
 * Whether this CLI has an MCP server, from its `--help` for the command.
 *
 * `agent-help` does not list the command, so its own help is the only
 * source. The help of an unknown command is the CLI's top-level help,
 * which does not describe a Model Context Protocol server.
 */
export function describesMcpServer(help: string): boolean {
	return /\bModel Context Protocol\b|\bMCP\b/.test(help) && /\bstdio\b/i.test(help);
}

/**
 * The MCP client configuration for an agent that is set up by hand.
 *
 * It is text for the clipboard. Nothing here writes a file.
 */
export function mcpClientConfig(launch: McpLaunch): string {
	const server: Record<string, unknown> = { command: launch.command, args: [...launch.args] };
	if (Object.keys(launch.env).length > 0) {
		server.env = { ...launch.env };
	}
	return `${JSON.stringify({ mcpServers: { entire: server } }, null, 2)}\n`;
}

/** What to say when the server cannot be offered. */
export function describeMcpUnavailable(reason: 'absent' | 'old' | 'broken', detail?: string): string {
	switch (reason) {
		case 'absent':
			return 'the Entire CLI is not installed; install it to run the Entire MCP server';
		case 'old':
			return 'this version of the Entire CLI has no MCP server; update the CLI';
		case 'broken':
			return detail ?? 'the Entire CLI is not usable';
	}
}
