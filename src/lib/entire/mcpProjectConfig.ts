import type { McpConfigFile, McpConfigTarget, McpServersKey } from './integrations';
import type { ControlConfirmation } from './controlPlaneActions';

/** The name the Entire server is listed under in a project's MCP configuration. */
export const PROJECT_SERVER_NAME = 'entire';

/** The largest MCP configuration file the extension reads. */
export const MAX_CONFIG_BYTES = 1_000_000;

export const ROOT_CONFIG: McpConfigTarget = { file: '.mcp.json', key: 'mcpServers' };
export const EDITOR_CONFIG: McpConfigTarget = { file: '.vscode/mcp.json', key: 'servers' };

/**
 * Which file a new entry goes in.
 *
 * `.mcp.json` at the folder root is read by agents other than the editor.
 * `.vscode/mcp.json` is the editor's older place, so it is used only when
 * it is already there and the root file is not.
 */
export function chooseConfigTarget(exists: { readonly root: boolean; readonly editor: boolean }): McpConfigTarget {
	return exists.editor && !exists.root ? EDITOR_CONFIG : ROOT_CONFIG;
}

/** The target for a file name, for the files this module writes. */
export function targetFor(file: McpConfigFile): McpConfigTarget {
	return file === EDITOR_CONFIG.file ? EDITOR_CONFIG : ROOT_CONFIG;
}

/**
 * The launch arguments to write to a shared file.
 *
 * The CLI's own launch line starts with `--context NAME` when a login is
 * pinned. A committed file must not carry the name of anyone's login, so
 * that pair is dropped and the rest is kept as the CLI gave it.
 */
export function projectMcpArguments(launchArgs: readonly string[]): readonly string[] {
	const args = [...launchArgs];
	while (args[0] === '--context' && args.length >= 2) {
		args.splice(0, 2);
	}
	return args.filter(arg => !arg.startsWith('--context='));
}

/** The entry for a target, in the shape that file's readers expect. */
export function serverEntry(target: McpConfigTarget, args: readonly string[]): Record<string, unknown> {
	const entry: Record<string, unknown> = target.key === 'servers' ? { type: 'stdio' } : {};
	entry.command = 'entire';
	entry.args = [...args];
	return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a command is the Entire CLI, by the name of its file. */
function namesEntire(command: unknown): boolean {
	if (typeof command !== 'string') {
		return false;
	}
	const base = command.split(/[\\/]/).pop() ?? '';
	return /^entire(\.exe|\.cmd)?$/i.test(base);
}

/** Whether a parsed configuration already lists the Entire server, in any shape. */
export function hasEntireEntry(config: unknown): boolean {
	if (!isRecord(config)) {
		return false;
	}
	for (const key of ['mcpServers', 'servers'] as const) {
		const servers = config[key];
		if (!isRecord(servers)) {
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(servers, PROJECT_SERVER_NAME)) {
			return true;
		}
		for (const entry of Object.values(servers)) {
			if (isRecord(entry) && namesEntire(entry.command) && Array.isArray(entry.args) && (entry.args as unknown[]).includes('mcp')) {
				return true;
			}
		}
	}
	return false;
}

export type ParsedConfig =
	| { readonly ok: true; readonly value: Record<string, unknown> }
	| { readonly ok: false; readonly detail: string };

/**
 * Reads a configuration file as plain JSON.
 *
 * No parser for JSON with comments is a dependency of the extension, so a
 * file with comments or trailing commas is not read, and is never
 * rewritten. A blank file counts as an empty object.
 */
export function parseConfig(text: string): ParsedConfig {
	if (text.trim().length === 0) {
		return { ok: true, value: {} };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, detail: 'it is not plain JSON (it may hold comments or a trailing comma)' };
	}
	return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false, detail: 'its top level is not an object' };
}

/** The indentation the file uses, or two spaces when it has none to copy. */
export function detectIndent(text: string): string {
	const match = /^([ \t]+)\S/m.exec(text);
	return match ? match[1] : '  ';
}

export type MergeResult =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly reason: 'present' | 'not-json' | 'shape'; readonly detail: string };

/**
 * Adds the Entire entry to a configuration, leaving every other key and
 * server where it is.
 *
 * Without text the file is new. The entry goes last, so nothing before it
 * is reordered. The file's indentation, line endings and final newline
 * are kept. Nothing is returned when the file cannot be changed safely.
 */
export function mergeEntireServer(text: string | undefined, target: McpConfigTarget, args: readonly string[]): MergeResult {
	const source = text ?? '';
	const parsed = parseConfig(source);
	if (!parsed.ok) {
		return { ok: false, reason: 'not-json', detail: parsed.detail };
	}
	if (hasEntireEntry(parsed.value)) {
		return { ok: false, reason: 'present', detail: 'the file already lists the Entire server' };
	}
	const existing = parsed.value[target.key as McpServersKey];
	if (existing !== undefined && !isRecord(existing)) {
		return { ok: false, reason: 'shape', detail: `"${target.key}" is not an object` };
	}
	const servers: Record<string, unknown> = existing ?? {};
	servers[PROJECT_SERVER_NAME] = serverEntry(target, args);
	const merged: Record<string, unknown> = { ...parsed.value, [target.key]: servers };

	const crlf = source.includes('\r\n');
	let out = JSON.stringify(merged, null, detectIndent(source));
	if (crlf) {
		out = out.replace(/\n/g, '\r\n');
	}
	const newline = source.length === 0 || /\n$/.test(source) ? (crlf ? '\r\n' : '\n') : '';
	return { ok: true, text: `${out}${newline}` };
}

/** What a person adds by hand when the file cannot be changed for them. */
export function manualSnippet(target: McpConfigTarget, args: readonly string[]): string {
	return JSON.stringify({ [target.key]: { [PROJECT_SERVER_NAME]: serverEntry(target, args) } }, null, 2);
}

/** The question before the entry is written. It names the file, the folder and what goes in. */
export function confirmProjectMcp(target: McpConfigTarget, folder: string, exists: boolean): ControlConfirmation {
	const editorNote =
		target.file === EDITOR_CONFIG.file
			? '\n\nVS Code already gets the server from this extension, so an entry here may show it twice.'
			: '';
	return {
		message: `Add the Entire MCP server to ${target.file}?`,
		detail:
			`${folder}\n\nThis ${exists ? 'adds an "entire" entry to' : 'creates'} ${target.file}` +
			`${exists ? '' : ' with an "entire" entry'}: command "entire", arguments "mcp". ` +
			`Every other entry and key stays as it is. The file is often committed, so it holds no login name and no path to this machine's CLI.${editorNote}`,
		action: `Add to ${target.file}`,
	};
}
