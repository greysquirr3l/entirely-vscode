import type { Trail, TrailChange } from './trail';
import type { TrailPick } from './trailPick';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrail(value: unknown): value is Trail {
	return isRecord(value) && typeof value.number === 'number' && typeof value.id === 'string';
}

function isChange(value: unknown): value is TrailChange {
	return (
		isRecord(value) &&
		typeof value.repository === 'string' &&
		typeof value.number === 'number' &&
		typeof value.branch === 'string'
	);
}

function trailPickOf(trail: Trail): TrailPick {
	return { kind: 'trail', trail, selector: { kind: 'trail', number: trail.number } };
}

function changePickOf(trail: Trail, change: TrailChange): TrailPick {
	return {
		kind: 'change',
		trail,
		change,
		selector: { kind: 'change', repository: change.repository, number: change.number },
	};
}

/**
 * What a review command was pointed at, when it was pointed at something.
 *
 * The commands run from the palette take no argument and ask the reviewer
 * to choose. From a row in the Trails view or the Details viewer they get
 * that row, and act on it without asking again which one is meant. An
 * argument that is not a row of either kind is ignored, so the command
 * falls back to asking.
 */
export function pickFromTarget(target: unknown): TrailPick | undefined {
	if (!isRecord(target)) {
		return undefined;
	}

	// A row of the Details viewer carries the pick it was built from.
	const carried = target.pick;
	if (isRecord(carried)) {
		const trail = carried.trail;
		const change = carried.change;
		if (isTrail(trail) && carried.kind === 'change' && isChange(change)) {
			return changePickOf(trail, change);
		}
		if (isTrail(trail) && carried.kind === 'trail') {
			return trailPickOf(trail);
		}
	}

	// A change row of the Trails view.
	const entry = target.entry;
	if (isRecord(entry)) {
		const trail = target.trail;
		const change = entry.change;
		if (target.kind === 'change' && isTrail(trail) && isChange(change)) {
			return changePickOf(trail, change);
		}
		// A trail row of the Trails view.
		const own = entry.trail;
		if (target.kind === 'trail' && isTrail(own)) {
			return trailPickOf(own);
		}
	}

	return undefined;
}

/** The trail a pick is about, as a pick of its own, for the commands that act on a trail. */
export function asTrailPick(pick: TrailPick): TrailPick {
	return pick.kind === 'trail' ? pick : trailPickOf(pick.trail);
}

/** The pick, when it is about a change. */
export function asChangePick(pick: TrailPick | undefined): TrailPick | undefined {
	return pick?.kind === 'change' ? pick : undefined;
}

/**
 * The selection keys whose cached detail a change to this pick makes out of date.
 *
 * Acting on a change alters the change and its trail. Acting on a trail
 * alters the trail and every change on it.
 */
export function touchedKeys(pick: TrailPick): string[] {
	const keys = [`trail:${pick.trail.number}`];
	if (pick.kind === 'change') {
		keys.push(`change:${pick.change.repository}/${pick.change.number}`);
	} else {
		keys.push(...pick.trail.changes.map(change => `change:${change.repository}/${change.number}`));
	}
	return keys;
}
