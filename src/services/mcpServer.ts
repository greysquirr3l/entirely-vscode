import { describeMcpUnavailable, describesMcpServer, type McpLaunch } from '../lib/entire';
import type { CliRunner } from './cli';

export type McpProbe =
	| { readonly ok: true; readonly launch: McpLaunch }
	| { readonly ok: false; readonly reason: 'absent' | 'old' | 'broken'; readonly detail: string };

export interface McpServerSource {
	/** Works out how to launch the server, or why it cannot be. Never starts it. */
	probe(): Promise<McpProbe>;
}

export interface McpServerOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
}

/**
 * Decides whether `entire mcp` can be offered to the editor, and how to launch it.
 *
 * The server is a long-running stdio process. This class only reads the
 * command's help and works out the launch line; the editor starts and
 * stops the process, so nothing is spawned from here.
 */
export class McpServerService implements McpServerSource {
	constructor(private readonly options: McpServerOptions) {}

	async probe(): Promise<McpProbe> {
		const help = await this.options.runner.help('mcp', { cwd: this.options.workspaceRoot() });
		if (!help.ok) {
			if (help.reason === 'absent') {
				return { ok: false, reason: 'absent', detail: describeMcpUnavailable('absent') };
			}
			if (help.reason === 'broken' || help.reason === 'spawn-failed' || help.reason === 'timeout') {
				return { ok: false, reason: 'broken', detail: describeMcpUnavailable('broken', help.detail) };
			}
			return { ok: false, reason: 'old', detail: describeMcpUnavailable('old') };
		}
		if (!describesMcpServer(help.value.raw)) {
			return { ok: false, reason: 'old', detail: describeMcpUnavailable('old') };
		}
		const command = await this.options.runner.terminalCommand(['mcp']);
		if (!command.ok) {
			return { ok: false, reason: 'broken', detail: describeMcpUnavailable('broken', command.detail) };
		}
		return { ok: true, launch: { command: command.path, args: command.args, env: command.env } };
	}
}
