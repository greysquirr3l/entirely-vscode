import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const created = new Set<string>();

/**
 * Creates a temporary directory that is removed when the whole test run ends.
 *
 * Removal happens in a root-level hook, after every suite, so a directory is
 * never deleted while a later test still uses it (a fake CLI reused across
 * tests, for one), and it still happens when a test fails. A suite that
 * wants a directory gone sooner can call `removeTempDir`.
 */
export function makeTempDir(prefix: string): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	created.add(directory);
	return directory;
}

/** Removes a directory made by `makeTempDir` now, rather than at the end. */
export function removeTempDir(directory: string): void {
	fs.rmSync(directory, { recursive: true, force: true });
	created.delete(directory);
}

/** Removes each directory in the list, ignoring ones already gone. */
export function removeDirs(directories: Iterable<string>): void {
	for (const directory of [...directories]) {
		fs.rmSync(directory, { recursive: true, force: true });
		created.delete(directory);
	}
}

// A top-level hook is a root hook: it runs once, after every suite in the run.
suiteTeardown(() => {
	removeDirs(created);
});
