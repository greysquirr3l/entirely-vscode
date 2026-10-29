import type { Session } from './types';

/**
 * The sessions tracked for a repository.
 *
 * The list spans every worktree of the repository, not only the folder that
 * happens to be open.
 */
export interface SessionListing {
	readonly sessions: readonly Session[];
	/**
	 * Why there is nothing to show, when there is nothing to show.
	 *
	 * Shown in place of the sessions so the user is told what happened
	 * rather than left with a blank panel.
	 */
	readonly emptyReason?: string;
}

/** What the tree asks the source for. */
export interface SessionQuery {
	/** Only the session that belongs to this workspace. */
	readonly ownOnly?: boolean;
}

/** Where the sessions come from. */
export type SessionSource = (query?: SessionQuery) => Promise<SessionListing>;
