import { branchLabel, type Trail, type TrailChange, type TrailSelector } from './trail';

/**
 * What a reviewer can pick.
 *
 * A trail is a project-wide piece of work and a change is one branch
 * in one repository. Most review actions are about a change, because a
 * change is what is approved, commented on, merged and checked out.
 */
export type TrailPick =
	| {
			/** A change on a trail, which is what most actions are about. */
			readonly kind: 'change';
			readonly trail: Trail;
			readonly change: TrailChange;
			/** The selector the CLI takes for this change. */
			readonly selector: TrailSelector;
	  }
	| {
			/** The trail itself, which is what linking is about. */
			readonly kind: 'trail';
			readonly trail: Trail;
			readonly selector: TrailSelector;
	  };

/**
 * How a change is labelled in a list.
 *
 * The branch comes first because that is what a reviewer recognises:
 * two changes on different branches of the same repository are told
 * apart by their branch, not by their number.
 */
export function describePick(pick: TrailPick): string {
	if (pick.kind === 'trail') {
		return `#${pick.trail.number} ${pick.trail.title}`;
	}

	const title = pick.change.title ? ` — ${pick.change.title}` : '';

	return `${branchLabel(pick.change)} (${pick.change.repository}/${pick.change.number})${title}`;
}

/**
 * The trail's own description, shown underneath its label.
 */
export function describePickDetail(pick: TrailPick): string {
	if (pick.kind === 'trail') {
		return pick.trail.status;
	}

	return `#${pick.trail.number} ${pick.trail.title}`;
}

/**
 * The changes of a trail, as things a reviewer can pick.
 *
 * The changes come out in the order the CLI gave them, so the list
 * matches what the CLI shows rather than being re-sorted behind the
 * user's back.
 */
export function picksForTrail(trail: Trail): readonly TrailPick[] {
	return trail.changes.map(change => ({
		kind: 'change' as const,
		trail,
		change,
		selector: { kind: 'change' as const, repository: change.repository, number: change.number },
	}));
}

/**
 * The trails of a list, as things a reviewer can pick.
 *
 * This is for the actions that are about the trail rather than about
 * one of its changes.
 */
export function trailPicks(trails: readonly Trail[]): readonly TrailPick[] {
	return trails.map(trail => ({
		kind: 'trail' as const,
		trail,
		selector: { kind: 'trail' as const, number: trail.number },
	}));
}

/**
 * Every change of every trail, as things a reviewer can pick.
 *
 * A reviewer who wants to act on a change should not have to know
 * which trail it belongs to first, so the changes of every trail are
 * offered together.
 */
export function changePicks(trails: readonly Trail[]): readonly TrailPick[] {
	return trails.flatMap(picksForTrail);
}
