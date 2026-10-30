import * as path from 'path';

/**
 * Whether a repository named by a search hit is the one the CLI detected.
 *
 * The CLI names the detected repository with its forge prefix
 * (`gh/owner/name`) and a hit without one (`owner/name`), so the prefix is
 * dropped before comparing. Case does not matter on either forge.
 */
export function isSameRepository(hitRepo: string | undefined, currentRepo: string | undefined): boolean {
	if (!hitRepo || !currentRepo) {
		return false;
	}
	const strip = (repo: string): string => repo.replace(/^(?:gh|et)\//i, '').toLowerCase();
	return strip(hitRepo) === strip(currentRepo);
}

/**
 * The absolute path of a repository-relative file inside a root, or
 * undefined when the path would leave the root.
 *
 * The path comes from the CLI's answer, so it is treated as untrusted.
 */
export function resolveInRoot(root: string, relative: string): string | undefined {
	if (relative.length === 0 || relative.includes('\0') || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
		return undefined;
	}
	const segments = relative.split(/[\\/]/).filter(segment => segment.length > 0 && segment !== '.');
	if (segments.length === 0 || segments.includes('..')) {
		return undefined;
	}
	return path.join(root, ...segments);
}
