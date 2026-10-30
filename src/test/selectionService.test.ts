import * as assert from 'assert';

import {
	buildChangeDetail,
	initialDetail,
	selectionKey,
	type DetailModel,
	type GatedChange,
	type Selection,
	type Trail,
	type ViewerState,
} from '../lib/entire';
import { MAX_CACHED_DETAILS, SelectionService, type LoadOutcome, type SelectionLoader } from '../services/selection';

const TRAIL: Trail = { id: 't', number: 12, title: 'Trail', status: 'open', changes: [], partial: false };

function change(number: number): Selection {
	const entry: GatedChange = {
		change: { id: `c${number}`, repository: 'widgets', branch: `b${number}`, number },
		gate: { kind: 'open', approvals: 1 },
	};
	return { kind: 'change', trail: TRAIL, entry };
}

const session = (id: string, status = 'active'): Selection => ({ kind: 'session', session: { id, agent: 'claude-code', status } });
const commit: Selection = { kind: 'commit', entry: { text: 'a1b2c3d title  acme/app', id: 'a1b2c3d', title: 'title', repo: 'acme/app' } };

/** A model that says which load produced it, so a test can tell one read from another. */
function modelFor(selection: Selection, marker = 'first'): DetailModel {
	const base = initialDetail(selection);
	return { ...base, rows: [...base.rows, { label: 'Read', value: marker }] };
}

interface Pending {
	readonly selection: Selection;
	resolve(outcome: LoadOutcome): void;
	progress(model: DetailModel): void;
}

/** A loader the test answers by hand, in any order. */
function manualLoader(): { loader: SelectionLoader; pending: Pending[]; calls: string[] } {
	const pending: Pending[] = [];
	const calls: string[] = [];
	const loader: SelectionLoader = (selection, progress) =>
		new Promise<LoadOutcome>(resolve => {
			calls.push(selectionKey(selection));
			pending.push({ selection, resolve, progress });
		});
	return { loader, pending, calls };
}

/** A loader that answers at once and counts what it was asked. */
function instantLoader(results: Record<string, LoadOutcome> = {}): { loader: SelectionLoader; calls: string[] } {
	const calls: string[] = [];
	let reads = 0;
	const loader: SelectionLoader = async selection => {
		const key = selectionKey(selection);
		calls.push(key);
		reads += 1;
		return results[key] ?? { kind: 'ready', model: modelFor(selection, `read ${reads}`) };
	};
	return { loader, calls };
}

function harness(loader: SelectionLoader, ttl = 30) {
	const clock = { now: 1_000_000 };
	const service = new SelectionService({ loader, ttlSeconds: () => ttl, now: () => clock.now });
	const states: ViewerState[] = [];
	service.onDidChange(state => states.push(state));
	return { service, clock, states };
}

/** The kind of what the viewer shows now, read fresh so a test is not narrowed by an earlier check. */
const stateKind = (service: SelectionService): string => service.state.kind;

const kinds = (states: readonly ViewerState[]): string[] => states.map(state => state.kind);

suite('Entire selection service', () => {
	test('select-each-kind: three selections show three items, each titled with its name', async () => {
		const { loader } = instantLoader();
		const { service, states } = harness(loader);
		try {
			await service.select(session('sess-1'), 'sessions');
			await service.select(change(34), 'trails');
			await service.select(commit, 'activity');

			const ready = states.filter(state => state.kind === 'ready');
			assert.deepStrictEqual(
				ready.map(state => (state.kind === 'ready' ? state.model.title : '')),
				['claude-code', 'widgets/34', 'a1b2c3d title'],
			);
			assert.strictEqual(service.state.kind, 'ready');
		} finally {
			service.dispose();
		}
	});

	test('rapid-selection: a first read that returns last never overwrites the second', async () => {
		const { loader, pending } = manualLoader();
		const { service, states } = harness(loader);
		try {
			const first = service.select(change(1), 'trails');
			const second = service.select(change(2), 'trails');
			assert.strictEqual(pending.length, 2);

			pending[1].resolve({ kind: 'ready', model: modelFor(pending[1].selection) });
			await second;
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection, 'late') });
			await first;

			const last = states[states.length - 1];
			assert.strictEqual(last.kind, 'ready');
			assert.strictEqual(last.kind === 'ready' ? last.model.title : '', 'widgets/2');
			assert.ok(
				!states.some(state => state.kind === 'ready' && state.model.title === 'widgets/1'),
				'the first item was shown after the second was chosen',
			);
		} finally {
			service.dispose();
		}
	});

	test('a read that returns for a row no longer selected is kept for next time', async () => {
		const { loader, pending, calls } = manualLoader();
		const { service } = harness(loader);
		try {
			const first = service.select(change(1), 'trails');
			void service.select(change(2), 'trails');
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection) });
			await first;

			// Going back to the first row finds its answer and reads nothing new.
			await service.select(change(1), 'trails');
			assert.deepStrictEqual(calls, ['change:widgets/1', 'change:widgets/2']);
			assert.strictEqual(service.state.kind, 'ready');
		} finally {
			service.dispose();
		}
	});

	test('selecting A, then B, then A while A is still being read starts one read of A', async () => {
		const { loader, pending, calls } = manualLoader();
		const { service } = harness(loader);
		try {
			void service.select(change(1), 'trails');
			void service.select(change(2), 'trails');
			const again = service.select(change(1), 'trails');
			assert.deepStrictEqual(calls, ['change:widgets/1', 'change:widgets/2']);
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection) });
			await again;
			assert.strictEqual(service.state.kind, 'ready');
			assert.strictEqual(service.state.kind === 'ready' ? service.state.model.title : '', 'widgets/1');
		} finally {
			service.dispose();
		}
	});

	test('keyboard-selects-once: a click and a selection change in the same turn make one read', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			const click = service.select(change(5), 'trails');
			const keyboard = service.select(change(5), 'trails');
			await Promise.all([click, keyboard]);
			assert.deepStrictEqual(calls, ['change:widgets/5']);
		} finally {
			service.dispose();
		}
	});

	test('same-row-twice: the second selection inside the lifetime reads nothing, and one after it reads once', async () => {
		const { loader, calls } = instantLoader();
		const { service, clock } = harness(loader, 30);
		try {
			await service.select(change(5), 'trails');
			clock.now += 29_000;
			await service.select(change(5), 'trails');
			assert.strictEqual(calls.length, 1);

			clock.now += 2_000;
			await service.select(change(5), 'trails');
			assert.strictEqual(calls.length, 2);
		} finally {
			service.dispose();
		}
	});

	test('reselecting a row after another reads nothing inside the lifetime, and shows when it was read', async () => {
		const { loader, calls } = instantLoader();
		const { service, states, clock } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			await service.select(change(2), 'trails');
			clock.now += 5_000;
			await service.select(change(1), 'trails');

			assert.strictEqual(calls.length, 2);
			const last = states[states.length - 1];
			assert.strictEqual(last.kind, 'ready');
			assert.strictEqual(last.kind === 'ready' ? last.asOf : undefined, 1_000_000);
			assert.strictEqual(last.kind === 'ready' ? last.refreshing : undefined, false);
		} finally {
			service.dispose();
		}
	});

	test('a lifetime of zero reads every time', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader, 0);
		try {
			await service.select(change(5), 'trails');
			await service.select(change(5), 'trails');
			assert.strictEqual(calls.length, 2);
		} finally {
			service.dispose();
		}
	});

	test('after the lifetime the old content shows at once and the read replaces it', async () => {
		const { loader, pending } = manualLoader();
		const { service, states, clock } = harness(loader, 30);
		try {
			const first = service.select(change(5), 'trails');
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection, 'old') });
			await first;

			clock.now += 31_000;
			const again = service.select(change(5), 'trails');
			const shownAtOnce = states[states.length - 1];
			assert.strictEqual(shownAtOnce.kind, 'ready');
			assert.strictEqual(shownAtOnce.kind === 'ready' ? shownAtOnce.refreshing : undefined, true);
			assert.strictEqual(
				shownAtOnce.kind === 'ready' ? shownAtOnce.model.rows.find(row => row.label === 'Read')?.value : '',
				'old',
			);
			assert.strictEqual(pending.length, 2, 'one read to revalidate');

			pending[1].resolve({ kind: 'ready', model: modelFor(pending[1].selection, 'new') });
			await again;
			const last = states[states.length - 1];
			assert.strictEqual(last.kind === 'ready' ? last.model.rows.find(row => row.label === 'Read')?.value : '', 'new');
			assert.strictEqual(last.kind === 'ready' ? last.refreshing : undefined, undefined);
			assert.strictEqual(last.kind === 'ready' ? last.asOf : undefined, undefined);
		} finally {
			service.dispose();
		}
	});

	test('a revalidation that returns after another row was chosen does not replace that row', async () => {
		const { loader, pending } = manualLoader();
		const { service, states, clock } = harness(loader, 30);
		try {
			const a = service.select(change(1), 'trails');
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection, 'old') });
			await a;
			clock.now += 31_000;
			void service.select(change(1), 'trails');
			void service.select(change(2), 'trails');
			pending[1].resolve({ kind: 'ready', model: modelFor(pending[1].selection, 'new') });
			await Promise.resolve();
			pending[2].resolve({ kind: 'ready', model: modelFor(pending[2].selection) });
			await new Promise(resolve => setImmediate(resolve));

			const last = states[states.length - 1];
			assert.strictEqual(last.kind === 'ready' ? last.model.title : '', 'widgets/2');
		} finally {
			service.dispose();
		}
	});

	test('a failed revalidation keeps the content and adds the could-not-refresh note', async () => {
		let fail = false;
		const loader: SelectionLoader = async selection =>
			fail ? { kind: 'failed', reason: 'network down' } : { kind: 'ready', model: modelFor(selection, 'kept') };
		const { service, states, clock } = harness(loader, 30);
		try {
			await service.select(change(5), 'trails');
			clock.now += 31_000;
			fail = true;
			await service.select(change(5), 'trails');

			const last = states[states.length - 1];
			assert.strictEqual(last.kind, 'ready');
			assert.strictEqual(last.kind === 'ready' ? last.refreshFailure : '', 'network down');
			assert.strictEqual(last.kind === 'ready' ? last.model.rows.find(row => row.label === 'Read')?.value : '', 'kept');
			assert.ok(!states.some(state => state.kind === 'failed'), 'the viewer was never blanked');
		} finally {
			service.dispose();
		}
	});

	test('an ended session is still cached after the lifetime and expires after ten times it', async () => {
		const { loader, calls } = instantLoader();
		const { service, clock } = harness(loader, 30);
		try {
			await service.select(session('ended-1', 'ended'), 'sessions');
			clock.now += 31_000;
			await service.select(session('ended-1', 'ended'), 'sessions');
			assert.strictEqual(calls.length, 1, 'an ended session is cached past the plain lifetime');
			clock.now += 270_000;
			await service.select(session('ended-1', 'ended'), 'sessions');
			assert.strictEqual(calls.length, 2, 'and expires after ten times it');

			await service.select(session('live-1', 'active'), 'sessions');
			clock.now += 31_000;
			await service.select(session('live-1', 'active'), 'sessions');
			assert.strictEqual(calls.filter(key => key === 'session:live-1').length, 2, 'an active session uses the plain lifetime');
		} finally {
			service.dispose();
		}
	});

	test('activity rows are kept ten times the lifetime too', async () => {
		const { loader, calls } = instantLoader();
		const { service, clock } = harness(loader, 30);
		try {
			await service.select(commit, 'activity');
			clock.now += 200_000;
			await service.select(commit, 'activity');
			assert.strictEqual(calls.length, 1);
		} finally {
			service.dispose();
		}
	});

	test('refresh bypasses the cache for the selected item only', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			await service.select(change(2), 'trails');
			await service.refresh();
			assert.deepStrictEqual(calls, ['change:widgets/1', 'change:widgets/2', 'change:widgets/2']);

			// The other row is still cached.
			await service.select(change(1), 'trails');
			assert.strictEqual(calls.length, 3);
		} finally {
			service.dispose();
		}
	});

	test('clearing the cache makes the next selection read again', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			await service.select(commit, 'activity');
			service.clearCache(['commit:']);
			await service.select(change(1), 'trails');
			await service.select(commit, 'activity');
			assert.deepStrictEqual(calls, ['change:widgets/1', 'commit:a1b2c3d@acme/app', 'commit:a1b2c3d@acme/app']);
			service.clearCache();
			await service.select(change(1), 'trails');
			assert.strictEqual(calls.length, 4);
		} finally {
			service.dispose();
		}
	});

	test('keeps the fifty most recent details', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			for (let number = 1; number <= MAX_CACHED_DETAILS + 1; number += 1) {
				await service.select(change(number), 'trails');
			}
			await service.select(change(MAX_CACHED_DETAILS + 1), 'trails');
			assert.strictEqual(calls.length, MAX_CACHED_DETAILS + 1);
			await service.select(change(1), 'trails');
			assert.strictEqual(calls.length, MAX_CACHED_DETAILS + 2, 'the oldest was dropped');
		} finally {
			service.dispose();
		}
	});

	test('failed-read-is-a-row: a rejected loader gives a failed state and nothing else', async () => {
		const loader: SelectionLoader = async () => {
			throw new Error('boom');
		};
		const { service, states } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			const last = states[states.length - 1];
			assert.strictEqual(last.kind, 'failed');
			assert.strictEqual(last.kind === 'failed' ? last.reason : '', 'boom');
			assert.strictEqual(last.kind === 'failed' ? last.model.title : '', 'widgets/1', 'the item keeps its name');
		} finally {
			service.dispose();
		}
	});

	test('a failed read is not cached, so selecting the row again tries again', async () => {
		let answers: LoadOutcome[] = [{ kind: 'failed', reason: 'down' }];
		const calls: string[] = [];
		const loader: SelectionLoader = async selection => {
			calls.push(selectionKey(selection));
			return answers.shift() ?? { kind: 'ready', model: modelFor(selection) };
		};
		const { service, states } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			await service.select(change(1), 'trails');
			assert.strictEqual(calls.length, 2);
			assert.deepStrictEqual(kinds(states).filter(kind => kind !== 'loading'), ['failed', 'ready']);
			answers = [];
		} finally {
			service.dispose();
		}
	});

	test('gone-item: a not-found answer gives a gone state with the CLI wording', async () => {
		const { loader } = instantLoader({
			'change:widgets/1': { kind: 'gone', reason: 'widgets/1 is no longer available. It may have been merged or deleted.' },
		});
		const { service, states } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			const last = states[states.length - 1];
			assert.strictEqual(last.kind, 'gone');
			assert.match(last.kind === 'gone' ? last.reason : '', /no longer available/);
		} finally {
			service.dispose();
		}
	});

	test('a loader that cannot reach the CLI still lets the other kinds load', async () => {
		const loader: SelectionLoader = async selection => {
			if (selection.kind === 'change') {
				const base = buildChangeDetail(selection);
				return {
					kind: 'ready',
					model: { ...base, rows: [...base.rows, { label: 'Trail details', value: 'Trail details need a newer Entire CLI' }] },
					cache: false,
				};
			}
			return { kind: 'ready', model: modelFor(selection) };
		};
		const { service, states } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			const unavailable = states[states.length - 1];
			assert.strictEqual(unavailable.kind, 'ready');
			assert.ok(unavailable.kind === 'ready' && unavailable.model.rows.some(row => row.label === 'Trail details'));
			assert.ok(unavailable.kind === 'ready' && unavailable.model.rows.some(row => row.label === 'Branch'), 'the listing fields stay');

			await service.select(session('s1'), 'sessions');
			await service.select(commit, 'activity');
			assert.strictEqual(service.state.kind, 'ready');
			assert.strictEqual(service.state.kind === 'ready' ? service.state.model.kind : '', 'commit');

			// An answer that is not cached is asked for again.
			await service.select(change(1), 'trails');
			assert.strictEqual(service.state.kind, 'ready');
		} finally {
			service.dispose();
		}
	});

	test('shows a loading state, with the row the listing gave, while the read is on its way', async () => {
		const { loader, pending } = manualLoader();
		const { service, states } = harness(loader);
		try {
			const read = service.select(change(1), 'trails');
			assert.strictEqual(states[0].kind, 'loading');
			assert.strictEqual(states[0].kind === 'loading' ? states[0].model.heading : '', 'b1');

			pending[0].progress(modelFor(pending[0].selection, 'part'));
			assert.strictEqual(states[states.length - 1].kind, 'loading');
			pending[0].resolve({ kind: 'ready', model: modelFor(pending[0].selection) });
			await read;
			assert.strictEqual(states[states.length - 1].kind, 'ready');
		} finally {
			service.dispose();
		}
	});

	test('steps of a read that is no longer wanted are dropped', async () => {
		const { loader, pending } = manualLoader();
		const { service, states } = harness(loader);
		try {
			void service.select(change(1), 'trails');
			void service.select(change(2), 'trails');
			const before = states.length;
			pending[0].progress(modelFor(pending[0].selection, 'stale step'));
			assert.strictEqual(states.length, before);
		} finally {
			service.dispose();
		}
	});

	test('selection-moves-between-views: selecting in Trails after Sessions announces the new view', async () => {
		const { loader } = instantLoader();
		const { service } = harness(loader);
		const announced: string[] = [];
		service.onDidSelect(event => announced.push(`${event.source}:${event.key}`));
		try {
			await service.select(session('sess-1'), 'sessions');
			await service.select(change(34), 'trails');
			await service.select(change(34), 'trails');
			assert.deepStrictEqual(announced, ['sessions:session:sess-1', 'trails:change:widgets/34']);
		} finally {
			service.dispose();
		}
	});

	test('nothing-selected: starts empty, clears to empty, and a row that disappears empties it', async () => {
		const { loader } = instantLoader();
		const { service, states } = harness(loader);
		try {
			assert.strictEqual(stateKind(service), 'empty');

			await service.select(change(1), 'trails');
			service.reconcile('sessions', () => false);
			assert.strictEqual(stateKind(service), 'ready', 'another view refreshing does not matter');
			service.reconcile('trails', () => undefined);
			assert.strictEqual(stateKind(service), 'ready', 'a view that cannot tell yet does not clear');
			service.reconcile('trails', () => true);
			assert.strictEqual(stateKind(service), 'ready');
			service.reconcile('trails', () => false);
			assert.strictEqual(stateKind(service), 'empty');
			assert.strictEqual(service.currentSelection, undefined);

			await service.select(commit, 'activity');
			service.clear();
			assert.strictEqual(states[states.length - 1].kind, 'empty');
		} finally {
			service.dispose();
		}
	});

	test('an item changed by an action is read again, and one that is not listed any more empties the viewer', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			service.invalidate(['change:widgets/1']);
			service.reloadFrom({ find: key => (key === 'change:widgets/1' ? change(1) : undefined) });
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(calls.length, 2);

			service.invalidate(['change:widgets/1']);
			service.reloadFrom({ find: () => undefined });
			assert.strictEqual(service.state.kind, 'empty');
		} finally {
			service.dispose();
		}
	});

	test('an action invalidates only the keys it touched', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			await service.select(change(2), 'trails');
			service.invalidate(['change:widgets/1']);
			await service.select(change(2), 'trails');
			assert.strictEqual(calls.length, 2, 'the untouched row is still cached');
			await service.select(change(1), 'trails');
			assert.strictEqual(calls.length, 3);
		} finally {
			service.dispose();
		}
	});

	test('no timer is created: a fake clock is the only thing that moves the cache', async () => {
		const timers: string[] = [];
		const original = { setTimeout: global.setTimeout, setInterval: global.setInterval };
		const watched = ((...args: Parameters<typeof setTimeout>) => {
			timers.push('timeout');
			return original.setTimeout(...args);
		}) as typeof setTimeout;
		global.setTimeout = watched;
		global.setInterval = ((...args: Parameters<typeof setInterval>) => {
			timers.push('interval');
			return original.setInterval(...args);
		}) as typeof setInterval;
		const { loader } = instantLoader();
		const { service, clock } = harness(loader);
		try {
			await service.select(change(1), 'trails');
			clock.now += 100_000;
			await service.select(change(1), 'trails');
			await service.refresh();
			service.clearCache();
			service.clear();
			assert.deepStrictEqual(timers, []);
		} finally {
			global.setTimeout = original.setTimeout;
			global.setInterval = original.setInterval;
			service.dispose();
		}
	});

	test('selections after dispose do nothing', async () => {
		const { loader, calls } = instantLoader();
		const { service } = harness(loader);
		service.dispose();
		await service.select(change(1), 'trails');
		assert.deepStrictEqual(calls, []);
	});
});
