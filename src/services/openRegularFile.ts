import * as fs from 'fs';

/** What opening a file that must be a plain file came to. */
export type OpenedFile =
	| { readonly kind: 'ok'; readonly handle: fs.promises.FileHandle; readonly info: fs.Stats }
	| { readonly kind: 'absent' }
	| { readonly kind: 'link' }
	| { readonly kind: 'not-file' }
	| { readonly kind: 'error'; readonly detail: string };

function codeOf(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Opens a file for reading once, and checks the open handle.
 *
 * The file is never examined by name and then opened by name, because the
 * name can point somewhere else in between. Instead the file is opened with
 * `O_NOFOLLOW` (so a link at the file's place fails to open) and
 * `O_NONBLOCK` (so a named pipe cannot hold the open), and `fstat` on that
 * same handle confirms it is a regular file. The caller reads from the
 * handle and must close it.
 *
 * Windows has no `O_NOFOLLOW`. There the flag is zero, and a link is found
 * with `lstat` before the open instead; links need elevated rights to
 * create there, and the handle check still applies after the open.
 */
export async function openRegularFile(file: string): Promise<OpenedFile> {
	const nofollow = fs.constants.O_NOFOLLOW ?? 0;
	if (nofollow === 0) {
		try {
			if ((await fs.promises.lstat(file)).isSymbolicLink()) {
				return { kind: 'link' };
			}
		} catch (error) {
			return failure(error);
		}
	}
	let handle: fs.promises.FileHandle;
	try {
		handle = await fs.promises.open(file, fs.constants.O_RDONLY | nofollow | (fs.constants.O_NONBLOCK ?? 0));
	} catch (error) {
		return failure(error);
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			await handle.close();
			return { kind: 'not-file' };
		}
		return { kind: 'ok', handle, info };
	} catch (error) {
		await handle.close().catch(() => undefined);
		return failure(error);
	}
}

function failure(error: unknown): OpenedFile {
	const code = codeOf(error);
	if (code === 'ENOENT' || code === 'ENOTDIR') {
		return { kind: 'absent' };
	}
	// POSIX reports a link refused by O_NOFOLLOW as ELOOP (EMLINK on some BSDs).
	if (code === 'ELOOP' || code === 'EMLINK') {
		return { kind: 'link' };
	}
	return { kind: 'error', detail: error instanceof Error ? error.message : String(error) };
}
