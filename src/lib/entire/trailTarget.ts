import type { DetailModel } from './selection';
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
 * to choose. From a row in the Trails view they get that row, and act on it
 * without asking again which one is meant. An argument that is not a row
 * is ignored, so the command falls back to asking.
 */
export function pickFromTarget(target: unknown): TrailPick | undefined {
	if (!isRecord(target)) {
		return undefined;
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

/**
 * What a review command was pointed at, from a tree row or from the detail
 * panel's link.
 *
 * A link in the panel carries the row id of the item as text. It is trusted
 * for nothing but naming the item on show: an id that is not the shown
 * item's gives nothing, so the command asks which item is meant.
 */
export function pickFromTargetOrShown(target: unknown, shown: DetailModel | undefined): TrailPick | undefined {
	if (typeof target === 'string') {
		return shown !== undefined && shown.key === target ? shown.pick : undefined;
	}
	return pickFromTarget(target);
}
