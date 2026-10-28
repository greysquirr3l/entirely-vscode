import * as fs from 'fs';
import * as path from 'path';

/**
 * Whether a folder is a git repository.
 *
 * The `.git` entry is what git itself looks for, so this is the same
 * question the CLI answers when it says a workspace is not a repository.
 */
export function isGitRepository(folder: string | undefined): boolean {
	if (!folder) {
		return false;
	}

	try {
		return fs.existsSync(path.join(folder, '.git'));
	} catch {
		return false;
	}
}
