import {
	CLOSED_DETAIL,
	MERGED_DETAIL,
	isFresh,
	readTrailGate,
	type GatedChange,
	type GatedTrail,
	type Trail,
	type TrailApproval,
	type TrailChange,
	type TrailGate,
	type TrailMergePlan,
	type TrailSelector,
} from '../lib/entire';
import type { TrailDetail, TrailResult } from './trailService';

/** What the trail reads need from the CLI. */
export interface TrailChangesSource {
	show(selector: TrailSelector): Promise<TrailResult<TrailDetail>>;
	mergePlan(selector: TrailSelector): Promise<TrailResult<TrailMergePlan>>;
	approvals(selector: TrailSelector): Promise<TrailResult<readonly TrailApproval[]>>;
}

/** What reading a trail's changes came to. */
export type ChangesRead =
	| { readonly kind: 'ok'; readonly entry: GatedTrail; readonly loadedAt: number }
	| { readonly kind: 'failed'; readonly detail: string };

/** What the badge read covered. */
export interface BadgeCoverage {
	/** Open trails in the listing. */
	readonly open: number;
	/** Open trails whose changes were read for the badge. */
	readonly read: number;
	/** Changes found awaiting approval among the trails read. */
	readonly awaiting: number;
	/** Trails whose read failed. */
	readonly failed: number;
}

export interface TrailChangesOptions {
	readonly trails: TrailChangesSource;
	/** The cache lifetime in seconds, read each time it is needed. Zero keeps nothing. */
	readonly ttlSeconds: () => number;
	/** The clock. The cache expires by comparing times, never by a timer. */
	readonly now?: () => number;
}

/** How many gates are read at once for one trail. */
const GATE_CONCURRENCY = 4;

/** How many trails are read at once for the badge. */
export const BADGE_CONCURRENCY = 3;

/** Whether a change has reached an end state: there is no gate left to read. */
function isSettled(change: TrailChange): boolean {
	return change.status === 'merged' || change.status === 'closed';
}

/**
 * Which trails to read for a choice of change, in order: open trails that
 * carry no changes yet, as many as `limit` allows. Closed trails are left
 * out, because their changes are not ones to act on.
 */
export function readingOrder(
	trails: readonly Trail[],
	limit: number,
): { readonly trail: Trail; readonly index: number }[] {
	return trails
		.map((trail, index) => ({ trail, index }))
		.filter(({ trail }) => trail.status === 'open' && trail.changes.length === 0)
		.slice(0, Math.max(0, limit));
}

interface Held<T> {
	readonly value: T;
	readonly loadedAt: number;
}

/**
 * Reads a trail's changes on demand and remembers them.
 *
 * The CLI's `trail list` carries no changes, so a trail's changes come from
 * one `trail show`, and each open change's gate from the merge check and the
 * approvals. A read is kept for the cache lifetime, shared by the Trails view
 * and the detail panel, so expanding a trail and then selecting it reads the
 * trail once. A read that is still on its way when the trail is
 * invalidated is dropped. Nothing here uses a timer.
 */
export class TrailChangesService {
	private readonly shown = new Map<number, Held<TrailDetail>>();
	private readonly changes = new Map<number, Held<GatedTrail>>();
	private readonly showLoads = new Map<number, { id: number; promise: Promise<TrailResult<TrailDetail>> }>();
	private readonly changeLoads = new Map<number, { id: number; promise: Promise<ChangesRead> }>();
	private sequence = 0;

	constructor(private readonly options: TrailChangesOptions) {}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private fresh<T>(held: Held<T> | undefined): held is Held<T> {
		return held !== undefined && isFresh(held.loadedAt, this.now(), this.options.ttlSeconds());
	}

	/** The changes already read for a trail, when they are still inside the cache lifetime. */
	peek(number: number): GatedTrail | undefined {
		const held = this.changes.get(number);
		return this.fresh(held) ? held.value : undefined;
	}

	/** Forgets what was read for these trails, and drops any read of them still on its way. */
	invalidate(numbers: readonly number[]): void {
		for (const number of numbers) {
			this.shown.delete(number);
			this.changes.delete(number);
			this.showLoads.delete(number);
			this.changeLoads.delete(number);
		}
	}

	/** Forgets everything. */
	clear(): void {
		this.shown.clear();
		this.changes.clear();
		this.showLoads.clear();
		this.changeLoads.clear();
	}

	/**
	 * One `trail show` of a trail, kept for the cache lifetime.
	 *
	 * A second call inside the lifetime, or while the first is running,
	 * reads nothing. `refresh` reads again.
	 */
	read(number: number, options: { readonly refresh?: boolean } = {}): Promise<TrailResult<TrailDetail>> {
		const held = this.shown.get(number);
		if (!options.refresh && this.fresh(held)) {
			return Promise.resolve({ kind: 'ok', value: held.value });
		}
		const running = this.showLoads.get(number);
		if (running && !options.refresh) {
			return running.promise;
		}

		const id = ++this.sequence;
		const promise = this.options.trails.show({ kind: 'trail', number }).then(result => {
			// Only the read that is still the latest for this trail may store.
			if (this.showLoads.get(number)?.id === id) {
				this.showLoads.delete(number);
				if (result.kind === 'ok' && this.options.ttlSeconds() > 0) {
					this.shown.set(number, { value: result.value, loadedAt: this.now() });
				}
			}
			return result;
		});
		this.showLoads.set(number, { id, promise });
		return promise;
	}

	/**
	 * A trail's changes with their gates: one `trail show`, then the merge
	 * check and approvals of each open change, a few at a time.
	 */
	changesOf(trail: Trail, options: { readonly refresh?: boolean } = {}): Promise<ChangesRead> {
		const held = this.changes.get(trail.number);
		if (!options.refresh && this.fresh(held)) {
			return Promise.resolve({ kind: 'ok', entry: held.value, loadedAt: held.loadedAt });
		}
		const running = this.changeLoads.get(trail.number);
		if (running && !options.refresh) {
			return running.promise;
		}

		const id = ++this.sequence;
		const promise = this.load(trail, id, options.refresh === true);
		this.changeLoads.set(trail.number, { id, promise });
		return promise;
	}

	private async load(trail: Trail, id: number, refresh: boolean): Promise<ChangesRead> {
		const shown = await this.read(trail.number, { refresh });
		if (shown.kind === 'failed') {
			if (this.changeLoads.get(trail.number)?.id === id) {
				this.changeLoads.delete(trail.number);
			}
			return { kind: 'failed', detail: shown.detail };
		}

		const detail = shown.value.trail;
		const gated = await this.gate(detail);
		const entry: GatedTrail = { trail: detail, changes: gated };
		const loadedAt = this.now();
		if (this.changeLoads.get(trail.number)?.id === id) {
			this.changeLoads.delete(trail.number);
			if (this.options.ttlSeconds() > 0) {
				this.changes.set(trail.number, { value: entry, loadedAt });
			}
		}
		return { kind: 'ok', entry, loadedAt };
	}

	private async gate(trail: Trail): Promise<GatedChange[]> {
		const rows: GatedChange[] = trail.changes.map(change => ({
			change,
			gate: this.settledGate(trail, change) ?? { kind: 'unknown', detail: 'not read yet' },
		}));
		const work = rows
			.map((row, index) => ({ row, index }))
			.filter(({ row }) => this.settledGate(trail, row.change) === undefined);

		let next = 0;
		const runners = Array.from({ length: Math.min(GATE_CONCURRENCY, work.length) }, async () => {
			while (next < work.length) {
				const job = work[next++];
				const selector: TrailSelector = {
					kind: 'change',
					repository: job.row.change.repository,
					number: job.row.change.number,
				};
				const [plan, approvals] = await Promise.all([
					this.options.trails.mergePlan(selector),
					this.options.trails.approvals(selector),
				]);
				const gate = readTrailGate(
					plan.kind === 'ok' ? plan.value : undefined,
					approvals.kind === 'ok' ? approvals.value : undefined,
					plan.kind === 'failed' ? plan.detail : undefined,
				);
				rows[job.index] = { change: job.row.change, gate };
			}
		});
		await Promise.all(runners);
		return rows;
	}

	/** The gate of a change that has nothing left to gate, or `undefined` for one that is open. */
	private settledGate(trail: Trail, change: TrailChange): TrailGate | undefined {
		if (trail.status === 'closed') {
			return { kind: 'unknown', detail: CLOSED_DETAIL };
		}
		return isSettled(change) ? { kind: 'unknown', detail: MERGED_DETAIL } : undefined;
	}

	/**
	 * The trails with the changes `trail show` reports, for the first `limit`
	 * of them, a few at a time. A trail that cannot be read keeps the
	 * changes it was listed with.
	 *
	 * This is for choosing a change to act on: the CLI's list carries no
	 * changes, so a choice made from the list alone has nothing to choose.
	 */
	async withChanges(
		trails: readonly Trail[],
		limit: number,
		isCancelled: () => boolean = () => false,
	): Promise<Trail[]> {
		const out = [...trails];
		const wanted = readingOrder(out, limit);

		let next = 0;
		const runners = Array.from({ length: Math.min(BADGE_CONCURRENCY, wanted.length) }, async () => {
			while (next < wanted.length && !isCancelled()) {
				const job = wanted[next++];
				const shown = await this.read(job.trail.number);
				if (shown.kind === 'ok') {
					out[job.index] = { ...job.trail, changes: shown.value.trail.changes };
				}
			}
		});
		await Promise.all(runners);
		return out;
	}

	/**
	 * Reads the changes of the first `limit` open trails, a few trails at a
	 * time, for the count of changes awaiting approval.
	 *
	 * This is called once per Trails refresh and never from a timer. A trail
	 * already read inside the cache lifetime costs no read.
	 */
	async readBadge(trails: readonly Trail[], limit: number): Promise<BadgeCoverage> {
		const open = trails.filter(trail => trail.status === 'open');
		const chosen = open.slice(0, Math.max(0, limit));
		let read = 0;
		let awaiting = 0;
		let failed = 0;

		let next = 0;
		const runners = Array.from({ length: Math.min(BADGE_CONCURRENCY, chosen.length) }, async () => {
			while (next < chosen.length) {
				const trail = chosen[next++];
				const result = await this.changesOf(trail);
				if (result.kind === 'failed') {
					failed += 1;
					continue;
				}
				read += 1;
				awaiting += result.entry.changes.filter(({ gate }) => gate.kind === 'awaiting-approval').length;
			}
		});
		await Promise.all(runners);
		return { open: open.length, read, awaiting, failed };
	}
}
