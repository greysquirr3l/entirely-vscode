import * as crypto from 'crypto';
import { promises as fs, type Stats } from 'fs';
import * as path from 'path';

import { openRegularFile } from './openRegularFile';
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

/**
 * Reads a written bundle back through one open handle: the file is opened
 * without following a link, and the size, the file type and the zip signature
 * all come from that same handle, so the name cannot point elsewhere between
 * the check and the read.
 */
export async function verifyBundle(file: string): Promise<BundleReadback> {
	const opened = await openRegularFile(file);
	switch (opened.kind) {
		case 'absent':
		case 'error':
			return { kind: 'missing' };
		case 'link':
		case 'not-file':
			return { kind: 'not-a-file' };
		case 'ok':
			break;
	}
	try {
		if (opened.info.size === 0) {
			return { kind: 'empty' };
		}
		const head = Buffer.alloc(4);
		const { bytesRead } = await opened.handle.read(head, 0, 4, 0);
		return isZipSignature(head.subarray(0, bytesRead)) ? { kind: 'zip', bytes: opened.info.size } : { kind: 'not-a-zip' };
	} finally {
		await opened.handle.close();
	}
}

/** A hidden name beside the chosen file, still ending in .zip, for the CLI to write to first. */
export function temporaryBundlePath(file: string): string {
	return path.join(path.dirname(file), `.entirely-${crypto.randomBytes(8).toString('hex')}.zip`);
}

export type MoveResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/**
 * Puts a finished file where the person chose, then leaves no temporary file.
 *
 * With a confirmed overwrite the file is renamed over the target, which
 * replaces what is there (a link included) without following it. Without one,
 * a hard link is made, which fails with EEXIST rather than replace anything,
 * and the temporary name is removed afterwards.
 */
export async function moveIntoPlace(
	temporary: string,
	target: string,
	overwrite: boolean,
	link: (existing: string, created: string) => Promise<void> = fs.link,
): Promise<MoveResult> {
	try {
		if (overwrite) {
			await fs.rename(temporary, target);
		} else {
			await link(temporary, target);
			await fs.rm(temporary, { force: true });
		}
		return { ok: true };
	} catch (error) {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			return { ok: false, detail: `a file appeared at ${target} while the bundle was being written, so it was not replaced; the new bundle was discarded` };
		}
		const code = (error as NodeJS.ErrnoException).code;
		const why = error instanceof Error ? error.message : String(error);
		return { ok: false, detail: code === 'EPERM' || code === 'ENOTSUP' ? `the file could not be placed at ${target} (${why}); the new bundle was discarded` : why };
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
		await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
		await fs.rename(temporary, file);
		return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
	} catch (error) {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
}
