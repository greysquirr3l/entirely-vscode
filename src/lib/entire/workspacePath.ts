import * as path from 'path';

/**
 * The path of a file relative to the workspace root, or undefined when
 * the file is the root itself or lies outside it.
 *
 * Both `why` and `blame` take paths from the user's open editors, so the
 * check that keeps them inside the workspace lives in one place.
 */
export function workspaceRelative(root: string, file: string): string | undefined {
	const relative = path.relative(root, file);
	if (relative.length === 0 || isParentSegment(relative) || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative;
}

/** Whether a relative path climbs out of its root: `..` alone or `..` then a separator. */
function isParentSegment(relative: string): boolean {
	return (
		relative === '..' ||
		relative.startsWith('../') ||
		relative.startsWith(`..${path.sep}`)
	);
}

/**
 * Whether the file the CLI names is the file that was asked about.
 *
 * The CLI names the file relative to the repository root, and the
 * extension asks relative to the workspace root, so the two are compared
 * by their trailing segments.
 */
export function answerNamesFile(relative: string, answered: string): boolean {
	const asked = relative.split(path.sep).filter(segment => segment.length > 0);
	const named = answered.split('/').filter(segment => segment.length > 0);

	if (asked.length === 0 || named.length < asked.length) {
		return false;
	}

	const tail = named.slice(named.length - asked.length);
	return tail.every((segment, index) => segment === asked[index]);
}

/**
 * The absolute path of a file the CLI named relative to the repository root.
 *
 * The blame panel names a file that way, which is not the workspace root when
 * the workspace is a subfolder of the repository. An absolute path is kept.
 */
export function repositoryFileToAbsolute(repositoryRoot: string, file: string): string {
	return path.isAbsolute(file) ? file : path.join(repositoryRoot, file);
}
