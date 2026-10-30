import type { Trail, TrailApproval, TrailChange, TrailGate, TrailMergePlan } from './trail';
import { pluralise } from './text';

/** The details of the `unknown` gate a change gets when it has nothing left to gate. */
export const MERGED_DETAIL = 'the change is merged';
export const CLOSED_DETAIL = 'the trail is closed';

/** A change together with the state of its gate. */
export interface GatedChange {
	readonly change: TrailChange;
	readonly gate: TrailGate;
}

/** A trail whose changes carry their gate state. */
export interface GatedTrail {
	readonly trail: Trail;
	readonly changes: readonly GatedChange[];
}

/** What the trails section shows. */
export interface TrailListing {
	/** The project the trails belong to, when the workspace has one. */
	readonly project?: string;
	readonly trails: readonly GatedTrail[];
	/** Why there is nothing to show, when there is nothing to show. */
	readonly emptyReason?: string;
}

/**
 * Reads the gate of a change from what the CLI said about it.
 *
 * The CLI's merge check (`trail merge --dry-run`) is the one place it
 * reports its gates, so the state is taken from that answer. The count
 * of approvals is carried for display and never decides the state: a
 * gate can require more than one approval, a particular reviewer, or
 * none at all, and only the CLI knows which.
 *
 * With no answer from the CLI the state is `unknown`.
 */
export function readTrailGate(
	plan: TrailMergePlan | undefined,
	approvals: readonly TrailApproval[] | undefined,
	failure = 'the CLI did not report the gate',
): TrailGate {
	if (!plan) {
		return { kind: 'unknown', detail: failure };
	}

	const count = (approvals ?? []).filter(approval => /approv/i.test(approval.event)).length;
	const blockers = [...plan.blockers, ...plan.reasons];

	if (plan.mergeable && blockers.length === 0) {
		return { kind: 'open', approvals: count };
	}

	if (plan.blockers.some(isApprovalBlocker)) {
		return { kind: 'awaiting-approval', approvals: count, blockers };
	}

	return { kind: 'blocked', approvals: count, blockers };
}

/**
 * Whether a blocker is the approval gate.
 *
 * The CLI gives blockers as free text with no code, so this matches its
 * wording ("approval" in the gate's reason). `scripts/check-cli-contract.js`
 * checks that the CLI still talks about approvals in `trail merge`.
 */
function isApprovalBlocker(blocker: string): boolean {
	return /\bapprov/i.test(blocker);
}

/** The changes, across all trails, that are waiting on an approval. */
export function pendingApprovals(trails: readonly GatedTrail[]): readonly GatedChange[] {
	return trails.flatMap(entry =>
		entry.changes.filter(change => change.gate.kind === 'awaiting-approval'),
	);
}

/** The words for a gate, for the line beside a change. */
export function describeGate(gate: TrailGate): string {
	switch (gate.kind) {
		case 'open':
			return `ready to merge · ${pluralise(gate.approvals, 'approval')}`;
		case 'awaiting-approval':
			return 'awaiting approval';
		case 'blocked':
			return gate.blockers.length > 0 ? `blocked · ${gate.blockers[0]}` : 'blocked';
		case 'unknown':
			if (gate.detail === MERGED_DETAIL) {
				return 'merged';
			}
			return gate.detail === CLOSED_DETAIL ? 'trail closed' : 'gate unknown';
	}
}

/**
 * Keeps the trails of one project.
 *
 * The CLI is asked for the workspace's project only, so this is the
 * second line of defence: a change that names a repository in a
 * different project is not shown, and a trail left with no changes
 * because of that goes with them.
 */
export function scopeToProject(trails: readonly Trail[], project: string): readonly Trail[] {
	const prefix = `${project}/`;
	const inProject = (change: TrailChange): boolean =>
		!change.repository.includes('/') || change.repository.startsWith(prefix);

	return trails.flatMap(trail => {
		if (trail.changes.length === 0) {
			return [trail];
		}

		const kept = trail.changes.filter(inProject);
		return kept.length === 0 ? [] : [{ ...trail, changes: kept }];
	});
}
