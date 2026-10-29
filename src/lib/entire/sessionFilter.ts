import type { Session } from './types';

/** What the workspace-only filter shows. */
export interface OwnSessionResult {
	readonly sessions: readonly Session[];
	/** Why the list is empty, when it is. */
	readonly emptyReason?: string;
}

/** Shown when the CLI knows no session for this worktree. */
export const NO_OWN_SESSION = 'This workspace has no session of its own.';

/**
 * Narrows a session list to the one session that belongs to this workspace.
 *
 * `session current` falls back to the newest session anywhere in the
 * repository's shared store, and says so with `resolution:
 * "other-worktree"`. That session is somebody else's, so it is not offered
 * as the workspace's own.
 */
export function ownSessionOnly(
	sessions: readonly Session[],
	current: Session | undefined,
): OwnSessionResult {
	if (!current || current.resolution === 'other-worktree') {
		return { sessions: [], emptyReason: NO_OWN_SESSION };
	}

	const own = sessions.filter(session => session.id === current.id);
	return own.length > 0 ? { sessions: own } : { sessions: [], emptyReason: NO_OWN_SESSION };
}
