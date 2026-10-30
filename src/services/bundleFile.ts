import * as crypto from 'crypto';
import { promises as fs, type Stats } from 'fs';
import * as path from 'path';

import { isZipSignature, type BundleReadback, type PathFacts } from '../lib/entire';

/** `lstat`, with a missing path as undefined and any other failure passed on. */
async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
	try {
		return await fs.lstat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
			return undefined;
		}
		throw error;
	}
}

/**
 * Reads what is at a chosen path and at its folder, without following links.
 *
 * `lstat` is used throughout, because `stat` would report what a link points
 * at and a link is exactly what the path check has to see.
 */
export async function inspectSaveTarget(file: string, workspaceRoots: readonly string[]): Promise<PathFacts> {
	const target = await lstatOrUndefined(file).catch(() => undefined);
	const parent = await lstatOrUndefined(path.dirname(file)).catch(() => undefined);
	return {
		exists: target !== undefined,
		isLink: target?.isSymbolicLink() ?? false,
		isDirectory: target?.isDirectory() ?? false,
		parentExists: parent !== undefined && (parent.isDirectory() || parent.isSymbolicLink()),
		parentIsLink: parent?.isSymbolicLink() ?? false,
		workspaceRoots,
	};
}

/** Reads a written bundle back: is a regular file there, and does it start like a zip archive. */
export async function verifyBundle(file: string): Promise<BundleReadback> {
	let stats: Stats | undefined;
	try {
		stats = await lstatOrUndefined(file);
	} catch {
		return { kind: 'missing' };
	}
	if (!stats) {
		return { kind: 'missing' };
	}
	if (!stats.isFile()) {
		return { kind: 'not-a-file' };
	}
	if (stats.size === 0) {
		return { kind: 'empty' };
	}
	const handle = await fs.open(file, 'r');
	try {
		const head = Buffer.alloc(4);
		const { bytesRead } = await handle.read(head, 0, 4, 0);
		return isZipSignature(head.subarray(0, bytesRead)) ? { kind: 'zip', bytes: stats.size } : { kind: 'not-a-zip' };
	} finally {
		await handle.close();
	}
}

export type SaveResult = { readonly ok: true; readonly bytes: number } | { readonly ok: false; readonly detail: string };

/**
 * Writes text to a file the person chose.
 *
 * The text goes to a temporary file in the same folder first and is renamed
 * into place, so a failure never leaves half a file where the person's file
 * should be. The temporary file is created with `wx`, so it cannot be a link
 * someone planted, and it is removed on every failure.
 */
export async function saveText(file: string, text: string): Promise<SaveResult> {
	const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
	try {
		const target = await lstatOrUndefined(file);
		if (target?.isSymbolicLink()) {
			return { ok: false, detail: 'the file is a symbolic link' };
		}
		await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
		await fs.rename(temporary, file);
		return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
	} catch (error) {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
}
