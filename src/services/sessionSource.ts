import {
	NO_OWN_SESSION,
	decodeCurrentSession,
	decodeSessionList,
	ownSessionOnly,
	unwrap,
	type SessionListing,
	type SessionQuery,
	type SessionSource,
} from '../lib/entire';
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
	return async (query?: SessionQuery): Promise<SessionListing> => {
		const result = await runner.runJson(
			['session', 'list', '--json'],
			value => unwrap(decodeSessionList(value)),
			{ cwd: workspaceRoot() },
		);

		if (!result.ok) {
			return { sessions: [], emptyReason: result.detail };
		}

		if (!query?.ownOnly) {
			return { sessions: result.value };
		}

		// `session current` names the session that belongs to this
		// worktree. It exits non-zero when the CLI has no state for one,
		// which here is an answer rather than a fault.
		const current = await runner.runJson(
			['session', 'current', '--json'],
			value => unwrap(decodeCurrentSession(value)),
			{ cwd: workspaceRoot() },
		);

		if (!current.ok) {
			return {
				sessions: [],
				emptyReason: current.reason === 'exit-code' ? NO_OWN_SESSION : current.detail,
			};
		}

		return ownSessionOnly(result.value, current.value);
	};
}
