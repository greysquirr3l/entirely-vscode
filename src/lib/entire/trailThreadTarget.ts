import type { TrailComment, TrailFinding } from './trail';
import type { TrailPick } from './trailPick';
import { pickFromTarget } from './trailTarget';

/**
 * What a discussion or finding command was pointed at.
 *
 * The rows under a change carry the change's own row, so a command run
 * from one knows the change without asking. An argument that is not such
 * a row gives nothing, and the command asks.
 */
export interface ThreadTarget {
	/** The change the row is under. */
	readonly pick: TrailPick;
	readonly discussion?: TrailComment;
	readonly finding?: TrailFinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a discussion row, a finding row or a group row of the Trails view. */
export function threadTargetOf(target: unknown): ThreadTarget | undefined {
	if (!isRecord(target) || !isRecord(target.change)) {
		return undefined;
	}
	const pick = pickFromTarget(target.change);
	if (!pick || pick.kind !== 'change') {
		return undefined;
	}
	if (target.kind === 'discussion' && isRecord(target.discussion) && typeof target.discussion.id === 'string') {
		return { pick, discussion: target.discussion as unknown as TrailComment };
	}
	if (target.kind === 'finding' && isRecord(target.finding) && typeof target.finding.id === 'string') {
		return { pick, finding: target.finding as unknown as TrailFinding };
	}
	if (target.kind === 'threadGroup') {
		return { pick };
	}
	return undefined;
}
