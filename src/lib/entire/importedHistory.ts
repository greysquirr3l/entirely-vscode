import type { Checkpoint, CheckpointDetail, Session } from './types';

/** What the tree says beside an imported checkpoint or session. */
export const IMPORTED_LABEL = 'Imported · read-only';

/**
 * Whether the CLI marks a session as imported history.
 *
 * `session list --json` sends `kind: "imported"` and `read_only: true` for
 * these; either one is taken as the CLI's word, because the two say the
 * same thing and a CLI that drops one still means it.
 */
export function isImportedSession(session: Pick<Session, 'kind' | 'readOnly'>): boolean {
	return session.readOnly === true || session.kind === 'imported';
}

/**
 * Marks the checkpoints that came from an import.
 *
 * `checkpoint list --json` carries no marker of its own, so a checkpoint is
 * imported when it holds sessions and every one of them is an imported
 * session in the CLI's session list. A checkpoint whose sessions the list
 * does not mention is left unmarked: an unknown is not a claim.
 */
export function markImported(
	checkpoints: readonly Checkpoint[],
	sessions: readonly Pick<Session, 'id' | 'kind' | 'readOnly'>[],
): readonly Checkpoint[] {
	const imported = new Set(sessions.filter(isImportedSession).map(session => session.id));
	if (imported.size === 0) {
		return checkpoints;
	}

	return checkpoints.map(checkpoint => {
		const ids = checkpoint.sessionIds.length > 0
			? checkpoint.sessionIds
			: checkpoint.sessionId !== undefined
				? [checkpoint.sessionId]
				: [];
		const allImported = ids.length > 0 && ids.every(id => imported.has(id));
		return allImported ? { ...checkpoint, imported: true } : checkpoint;
	});
}

/** Whether a checkpoint is read-only imported history, by the list or by its detail. */
export function isImportedCheckpoint(
	checkpoint: Pick<Checkpoint, 'imported'>,
	detail?: Pick<CheckpointDetail, 'strategy' | 'sessions'>,
): boolean {
	if (checkpoint.imported === true) {
		return true;
	}
	if (!detail) {
		return false;
	}
	if (detail.strategy === 'import') {
		return true;
	}
	return detail.sessions.length > 0 && detail.sessions.every(session => session.kind === 'imported');
}
