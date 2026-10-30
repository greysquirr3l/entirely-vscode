import {
	readTrailGate,
	scopeToProject,
	type GatedChange,
	type GatedTrail,
	type Trail,
	type TrailListing,
} from '../lib/entire';
import type { TrailService } from './trailService';

/** Reads the trails section's content. */
export type TrailListingSource = () => Promise<TrailListing>;

/** How many changes have their gate read at once. */
const GATE_CONCURRENCY = 4;

/**
 * Reads the trails of the workspace's project, with the gate of each
 * open change.
 *
 * The project comes from `repo view`, the trails from `trail list` and
 * the gate from the CLI's own merge check. A closed trail has nothing
 * left to gate, so it is listed without asking.
 */
export function createTrailListingSource(trails: TrailService): TrailListingSource {
	return async (): Promise<TrailListing> => {
		const workspace = await trails.workspace();
		if (workspace.kind === 'failed') {
			return { trails: [], emptyReason: workspace.detail };
		}

		const project = workspace.value.project;
		const list = await trails.list(project);
		if (list.kind === 'failed') {
			return { project, trails: [], emptyReason: list.detail };
		}

		const scoped = scopeToProject(list.value.items, project);
		const gated = await gateTrails(trails, scoped);

		return {
			project,
			trails: gated,
			emptyReason: gated.length === 0 ? `${project} has no trails.` : undefined,
		};
	};
}

/** Reads the gate of every change on the open trails, a few at a time. */
async function gateTrails(trails: TrailService, scoped: readonly Trail[]): Promise<GatedTrail[]> {
	const rows = scoped.map(trail => ({ trail, changes: [] as GatedChange[] }));
	const work: (() => Promise<void>)[] = [];

	for (const { trail, changes } of rows) {
		for (const change of trail.changes) {
			if (trail.status === 'closed') {
				changes.push({ change, gate: { kind: 'unknown', detail: 'the trail is closed' } });
				continue;
			}

			work.push(async () => {
				const selector = { kind: 'change', repository: change.repository, number: change.number } as const;
				const [plan, approvals] = await Promise.all([
					trails.mergePlan(selector),
					trails.approvals(selector),
				]);

				const gate = readTrailGate(
					plan.kind === 'ok' ? plan.value : undefined,
					approvals.kind === 'ok' ? approvals.value : undefined,
					plan.kind === 'failed' ? plan.detail : undefined,
				);
				changes.push({ change, gate });
			});
		}
	}

	let next = 0;
	const runners = Array.from({ length: Math.min(GATE_CONCURRENCY, work.length) }, async () => {
		while (next < work.length) {
			const job = work[next++];
			await job();
		}
	});
	await Promise.all(runners);

	// Reading finishes in any order; the CLI's order is the one shown.
	for (const entry of rows) {
		const order = new Map(entry.trail.changes.map((change, position) => [change, position]));
		entry.changes.sort(
			(left, right) => (order.get(left.change) ?? 0) - (order.get(right.change) ?? 0),
		);
	}

	return rows;
}
