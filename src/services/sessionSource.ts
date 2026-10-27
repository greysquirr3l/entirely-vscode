import { decodeSessionList, unwrap, type SessionListing, type SessionSource } from '../lib/entire';
import { CliRunner } from './cli';

/**
 * Reads the sessions the CLI tracks for the repository.
 *
 * `entire session list --json` spans every worktree of the repository, not
 * only the folder that happens to be open, so the tree shows the whole
 * repository's sessions rather than the current folder's.
 */
export function createSessionSource(
	runner: CliRunner,
	workspaceRoot: () => string | undefined,
): SessionSource {
	return async (): Promise<SessionListing> => {
		const result = await runner.runJson(
			['session', 'list', '--json'],
			value => unwrap(decodeSessionList(value)),
			{ cwd: workspaceRoot() },
		);

		if (!result.ok) {
			return { sessions: [], emptyReason: result.detail };
		}

		return { sessions: result.value };
	};
}
