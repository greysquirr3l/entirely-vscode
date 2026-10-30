import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
	EDITOR_CONFIG,
	MAX_CONFIG_BYTES,
	ROOT_CONFIG,
	chooseConfigTarget,
	hasEntireEntry,
	manualSnippet,
	mergeEntireServer,
	parseConfig,
	type McpConfigFile,
	type McpConfigState,
	type McpConfigTarget,
} from '../lib/entire';
import { openRegularFile } from './openRegularFile';

export type AddOutcome =
	| { readonly kind: 'added'; readonly file: McpConfigFile; readonly created: boolean }
	| { readonly kind: 'present'; readonly file: McpConfigFile }
	| { readonly kind: 'refused'; readonly file: McpConfigFile; readonly detail: string; readonly snippet: string }
	| { readonly kind: 'failed'; readonly file: McpConfigFile; readonly detail: string };

/** What the integration flows need from a project's MCP configuration. */
export interface ProjectMcpSource {
	inspect(folder: string): Promise<McpConfigState>;
	/** The file an entry would be written to for this folder, and whether it exists. */
	plan(folder: string): Promise<{ readonly target: McpConfigTarget; readonly exists: boolean }>;
	add(folder: string, args: readonly string[]): Promise<AddOutcome>;
}

type Read =
	| { readonly kind: 'absent' }
	| { readonly kind: 'text'; readonly text: string; readonly mode: number }
	| { readonly kind: 'refused'; readonly detail: string };

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Reads and adds to a workspace folder's MCP configuration files.
 *
 * Only the two files this class names are touched, and only inside the
 * folder: a link at the file's place is refused, and so is a `.vscode`
 * directory that leads outside. A file is replaced by writing a temporary
 * file beside it and renaming it over the original, so a failure leaves
 * the original as it was.
 */
export class ProjectMcpConfig implements ProjectMcpSource {
	private async insideFolder(folder: string, file: string): Promise<boolean> {
		try {
			const root = await fs.realpath(folder);
			const directory = await fs.realpath(path.dirname(file));
			const relative = path.relative(root, directory);
			return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
		} catch {
			return false;
		}
	}

	private async read(folder: string, target: McpConfigTarget): Promise<Read> {
		const file = path.join(folder, ...target.file.split('/'));
		const opened = await openRegularFile(file);
		switch (opened.kind) {
			case 'absent':
				return { kind: 'absent' };
			case 'link':
				return { kind: 'refused', detail: `${target.file} is a link, so it is left alone` };
			case 'not-file':
				return { kind: 'refused', detail: `${target.file} is not a file` };
			case 'error':
				return { kind: 'refused', detail: opened.detail };
			case 'ok':
				break;
		}
		try {
			if (opened.info.size > MAX_CONFIG_BYTES) {
				return { kind: 'refused', detail: `${target.file} is larger than ${MAX_CONFIG_BYTES} bytes` };
			}
			if (!(await this.insideFolder(folder, file))) {
				return { kind: 'refused', detail: `${target.file} is not inside the workspace folder` };
			}
			return { kind: 'text', text: await opened.handle.readFile({ encoding: 'utf8' }), mode: opened.info.mode & 0o777 };
		} catch (error) {
			return { kind: 'refused', detail: message(error) };
		} finally {
			await opened.handle.close().catch(() => undefined);
		}
	}

	async plan(folder: string): Promise<{ readonly target: McpConfigTarget; readonly exists: boolean }> {
		const [root, editor] = await Promise.all([this.read(folder, ROOT_CONFIG), this.read(folder, EDITOR_CONFIG)]);
		const target = chooseConfigTarget({ root: root.kind !== 'absent', editor: editor.kind !== 'absent' });
		return { target, exists: (target.file === ROOT_CONFIG.file ? root : editor).kind !== 'absent' };
	}

	async inspect(folder: string): Promise<McpConfigState> {
		const targets = [ROOT_CONFIG, EDITOR_CONFIG];
		const reads = await Promise.all(targets.map(target => this.read(folder, target)));
		let unreadable: McpConfigState | undefined;
		for (const [index, read] of reads.entries()) {
			const file = targets[index].file;
			if (read.kind === 'text') {
				const parsed = parseConfig(read.text);
				if (!parsed.ok) {
					unreadable ??= { kind: 'unreadable', file, detail: parsed.detail };
				} else if (hasEntireEntry(parsed.value)) {
					return { kind: 'configured', file };
				}
			} else if (read.kind === 'refused') {
				unreadable ??= { kind: 'unreadable', file, detail: read.detail };
			}
		}
		if (unreadable) {
			return unreadable;
		}
		return { kind: 'not-configured', target: chooseConfigTarget({ root: reads[0].kind !== 'absent', editor: reads[1].kind !== 'absent' }) };
	}

	async add(folder: string, args: readonly string[]): Promise<AddOutcome> {
		const { target } = await this.plan(folder);
		const file = path.join(folder, ...target.file.split('/'));
		const read = await this.read(folder, target);
		if (read.kind === 'refused') {
			return { kind: 'refused', file: target.file, detail: read.detail, snippet: manualSnippet(target, args) };
		}
		const merged = mergeEntireServer(read.kind === 'text' ? read.text : undefined, target, args);
		if (!merged.ok) {
			return merged.reason === 'present'
				? { kind: 'present', file: target.file }
				: { kind: 'refused', file: target.file, detail: merged.detail, snippet: manualSnippet(target, args) };
		}
		if (read.kind === 'absent' && !(await this.insideFolder(folder, file))) {
			return { kind: 'failed', file: target.file, detail: 'the folder is not available' };
		}
		const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
		try {
			await fs.writeFile(temporary, merged.text, { encoding: 'utf8', flag: 'wx', mode: read.kind === 'text' ? read.mode : 0o644 });
			await fs.rename(temporary, file);
		} catch (error) {
			await fs.rm(temporary, { force: true });
			return { kind: 'failed', file: target.file, detail: message(error) };
		}
		return { kind: 'added', file: target.file, created: read.kind === 'absent' };
	}
}
