import { execute } from './cli/exec';

/** How long counting refs may take. It reads local refs only. */
const COUNT_TIMEOUT_MS = 10_000;

/**
 * Counts the refs under a prefix with `git for-each-ref`.
 *
 * git is run directly, never through a shell, and the count is undefined
 * when git cannot be run or the folder is not a repository: a count the
 * caller cannot trust is not the same as zero.
 */
export async function countRefs(cwd: string | undefined, prefix: string): Promise<number | undefined> {
	if (!cwd) {
		return undefined;
	}
	const result = await execute('git', ['for-each-ref', '--format=%(refname)', prefix], { cwd, timeoutMs: COUNT_TIMEOUT_MS });
	if (!result.ok) {
		return undefined;
	}
	return result.stdout.split('\n').filter(line => line.trim().length > 0).length;
}
