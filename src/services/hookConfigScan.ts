import * as fs from 'fs';
import * as path from 'path';

import { findHookVerbs } from '../lib/entire';
import { openRegularFile } from './openRegularFile';

/** A configuration file that holds `entire hooks` commands. */
export interface HookConfigFile {
	/** Relative to the workspace root, with `/` separators. */
	readonly file: string;
	readonly text: string;
}

/** The limits that keep a scan cheap in a large repository. */
export const SCAN_LIMITS = {
	/** How many directories deep below the workspace root to look. */
	depth: 3,
	/** The largest file that is read. */
	bytes: 256 * 1024,
	/** The most files that are read. */
	files: 300,
} as const;

const CONFIG_EXTENSIONS = new Set(['.json', '.jsonc', '.toml', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.ts', '.sh']);
const SKIPPED_DIRECTORIES = new Set(['.git', '.entire', 'node_modules', '.venv', '.cache', '.npm', '.next']);

/**
 * Finds the files in the workspace's dot-directories that call `entire hooks`.
 *
 * Each agent keeps its hook configuration in its own dot-directory
 * (a folder named for the agent, or `.github/hooks`). The scan does not name
 * them: it reads the small configuration files under any dot-directory at
 * the root and keeps those that mention `entire hooks`. It is bounded in
 * depth, size and count, and uses asynchronous reads so it never holds up
 * the editor.
 */
export async function scanHookConfig(root: string): Promise<readonly HookConfigFile[]> {
	const found: HookConfigFile[] = [];
	let budget: number = SCAN_LIMITS.files;

	async function visit(directory: string, depth: number): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (budget <= 0) {
				return;
			}
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (depth < SCAN_LIMITS.depth && !SKIPPED_DIRECTORIES.has(entry.name)) {
					await visit(full, depth + 1);
				}
			} else if (entry.isFile() && CONFIG_EXTENSIONS.has(path.extname(entry.name))) {
				budget -= 1;
				const text = await readSmall(full);
				if (text !== undefined && text.includes('entire hooks')) {
					found.push({ file: path.relative(root, full).split(path.sep).join('/'), text });
				}
			}
		}
	}

	let top: fs.Dirent[];
	try {
		top = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	for (const entry of top) {
		if (entry.isDirectory() && entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
			await visit(path.join(root, entry.name), 1);
		}
	}
	return found;
}

async function readSmall(file: string): Promise<string | undefined> {
	const opened = await openRegularFile(file);
	if (opened.kind !== 'ok') {
		return undefined;
	}
	try {
		return opened.info.size > SCAN_LIMITS.bytes ? undefined : await opened.handle.readFile({ encoding: 'utf8' });
	} catch {
		return undefined;
	} finally {
		await opened.handle.close().catch(() => undefined);
	}
}

/** The verbs an agent's hooks call, and the files they were found in. */
export function hooksOf(
	agent: string,
	files: readonly HookConfigFile[],
): { readonly verbs: readonly string[]; readonly files: readonly string[] } {
	const verbs = new Set<string>();
	const where: string[] = [];
	for (const file of files) {
		const found = findHookVerbs(agent, file.text);
		if (found.length > 0) {
			where.push(file.file);
			found.forEach(verb => verbs.add(verb));
		}
	}
	return { verbs: [...verbs], files: where };
}
