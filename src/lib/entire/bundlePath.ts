import * as path from 'path';

/** What the service learned about a chosen path, with `lstat` so a link is seen as a link. */
export interface PathFacts {
	readonly exists: boolean;
	readonly isLink: boolean;
	readonly isDirectory: boolean;
	readonly parentExists: boolean;
	readonly parentIsLink: boolean;
	readonly workspaceRoots: readonly string[];
}

export type PathCheck =
	| { readonly ok: true; readonly overwrites: boolean; readonly insideWorkspace: boolean }
	| { readonly ok: false; readonly reason: string };

/** Folders the extension never writes a file of its own into: the repository's data and the CLI's logs. */
const PROTECTED_SEGMENTS = ['.git', '.entire'];

/**
 * Decides whether a path the person chose is safe to write to.
 *
 * It is a pure check over facts gathered by the caller. A refusal says why,
 * and nothing is created to make a path valid: a missing folder stays missing.
 */
export function checkSavePath(file: string, facts: PathFacts, extensions: readonly string[]): PathCheck {
	if (file.includes('\0')) {
		return { ok: false, reason: 'the path contains a NUL character' };
	}
	if (!path.isAbsolute(file)) {
		return { ok: false, reason: 'the path is not absolute; choose a full path' };
	}
	const segments = file.split(/[\\/]+/);
	if (segments.includes('..')) {
		return { ok: false, reason: 'the path goes up through ".." segments; choose a path without them' };
	}
	const extension = path.extname(file).toLowerCase();
	if (!extensions.includes(extension)) {
		return { ok: false, reason: `the file name must end in ${extensions.join(' or ')}` };
	}
	if (segments.some(segment => PROTECTED_SEGMENTS.includes(segment.toLowerCase()))) {
		return { ok: false, reason: 'the path is inside a .git or .entire folder, which hold the repository and the CLI\'s own data' };
	}
	if (!facts.parentExists) {
		return { ok: false, reason: 'the folder does not exist; Entirely does not create folders' };
	}
	if (facts.parentIsLink) {
		return { ok: false, reason: 'the folder is a symbolic link' };
	}
	if (facts.isLink) {
		return { ok: false, reason: 'the file is a symbolic link' };
	}
	if (facts.isDirectory) {
		return { ok: false, reason: 'the path is a folder, not a file' };
	}

	const normalised = path.normalize(file);
	const insideWorkspace = facts.workspaceRoots.some(root => {
		const relative = path.relative(path.normalize(root), normalised);
		return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
	});
	return { ok: true, overwrites: facts.exists, insideWorkspace };
}

/** `checkSavePath` for a diagnostic bundle, which is a zip archive. */
export function checkBundlePath(file: string, facts: PathFacts): PathCheck {
	return checkSavePath(file, facts, ['.zip']);
}

/** `checkSavePath` for a saved copy of a log, trace or report. */
export function checkTextPath(file: string, facts: PathFacts): PathCheck {
	return checkSavePath(file, facts, ['.txt', '.log']);
}

/** The default name offered for a bundle, dated in UTC. */
export function defaultBundleName(now: Date): string {
	return `entire-diagnostics-${now.toISOString().slice(0, 10)}.zip`;
}

/** The default name offered for a saved output. */
export function defaultOutputName(kind: string, now: Date): string {
	return `entire-${kind}-${now.toISOString().slice(0, 10)}.txt`;
}

/** Whether the first bytes of a file are a zip signature: a local header, or the end record of an empty archive. */
export function isZipSignature(bytes: Uint8Array): boolean {
	if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
		return false;
	}
	return (bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06);
}
