import * as assert from 'assert';

import {
	NO_BRANCH,
	branchLabel,
	decodeTrail,
	decodeTrailChange,
	decodeTrailDetail,
	decodeTrailList,
	describeGate,
	type Trail,
	type TrailApproval,
	type TrailMergePlan,
	type TrailSelector,
} from '../lib/entire';
import { TrailsProvider, describeBadge, type TrailNode, type TrailsNode } from '../providers/trailsProvider';
import { TrailChangesService, type TrailChangesSource } from '../services/trailChanges';
import { createTrailListingSource } from '../services/trailListing';
import { TrailService, type TrailDetail, type TrailResult } from '../services/trailService';
import {
	MERGE_PLAN,
	SHOWN_CHANGE,
	TRAIL_LIST,
	TRAIL_SHOW,
	TRAIL_SHOW_MERGED,
	fakeTrailCli,
	invocations,
	listedTrail,
	shownTrail,
} from './support/trailCli';

const NOW = 1_000_000;

function openTrail(number: number): Trail {
	return {
		id: `t${number}`,
		number,
		title: `Trail ${number}`,
		status: 'open',
		changes: [],
		partial: false,
	};
}

/** A source that answers from memory and counts what it was asked, and how many reads ran at once. */
function memorySource(options: { closed?: number[]; failing?: number[]; delay?: () => Promise<void> } = {}) {
	const calls = { show: [] as number[], plan: [] as string[], approvals: [] as string[] };
	let running = 0;
	let widest = 0;
	const source: TrailChangesSource = {
		async show(selector: TrailSelector): Promise<TrailResult<TrailDetail>> {
			assert.strictEqual(selector.kind, 'trail');
			const number = selector.kind === 'trail' ? selector.number : 0;
			calls.show.push(number);
			running += 1;
			widest = Math.max(widest, running);
			try {
				await options.delay?.();
			} finally {
				running -= 1;
			}
			if (options.failing?.includes(number)) {
				return { kind: 'failed', detail: 'network down' };
			}
			const trail: Trail = {
				id: `t${number}`,
				number,
				title: `Trail ${number}`,
				status: options.closed?.includes(number) ? 'closed' : 'open',
				partial: false,
				changes: [{ id: `c${number}`, repository: 'widgets', branch: `b${number}`, number: number * 10, status: 'open' }],
			};
			return { kind: 'ok', value: { trail, project: 'gh/acme' } };
		},
		async mergePlan(selector): Promise<TrailResult<TrailMergePlan>> {
			calls.plan.push(selector.kind === 'change' ? `${selector.repository}/${selector.number}` : 'x');
			return {
				kind: 'ok',
				value: { change: 'c', mergeable: false, blockers: ['approval needed'], reasons: [], wouldBypass: false, merged: false },
			};
		},
		async approvals(selector): Promise<TrailResult<readonly TrailApproval[]>> {
			calls.approvals.push(selector.kind === 'change' ? `${selector.repository}/${selector.number}` : 'x');
			return { kind: 'ok', value: [] };
		},
	};
	return { source, calls, widest: () => widest };
}

suite('Entire trail changes: the real shapes', () => {
	test('the CLI list has no changes key, and every listed trail decodes with none', () => {
		const list = decodeTrailList(JSON.parse(JSON.stringify(TRAIL_LIST)));
		assert.ok(list.ok);
		assert.strictEqual(list.value.items.length, 1);
		assert.deepStrictEqual(list.value.items[0].changes, []);
		assert.ok(!('changes' in TRAIL_LIST.items[0]), 'the fixture is the shape the CLI sends');
		for (const key of ['assigneeAccountIds', 'assignees', 'authorAccountId', 'body', 'closedAt', 'createdAt', 'id', 'isPossiblyPartial', 'metadata', 'number', 'priority', 'projectId', 'repoIds', 'status', 'title', 'type', 'updatedAt']) {
			assert.ok(key in TRAIL_LIST.items[0], `${key} is a key of the real list`);
		}
	});

	test('trail show carries the changes, with the project and the url', () => {
		const shown = decodeTrailDetail(JSON.parse(JSON.stringify(TRAIL_SHOW)));
		assert.ok(shown.ok);
		assert.strictEqual(shown.value.trail.changes.length, 1);
		assert.strictEqual(shown.value.trail.changes[0].repository, 'entirely-vscode');
		assert.strictEqual(shown.value.trail.url, 'https://entire.example/trails/40');
		assert.strictEqual(shown.value.project.reference, 'gh/greysquirr3l');
	});

	test('empty-branch-change: a change with an empty branch decodes, and its label says it has none', () => {
		const empty = decodeTrailChange({ ...SHOWN_CHANGE, branch: '' }, 'change');
		assert.ok(empty.ok);
		assert.strictEqual(empty.value.branch, '');
		assert.strictEqual(branchLabel(empty.value), NO_BRANCH);
		assert.strictEqual(branchLabel({ branch: '   ' }), NO_BRANCH);
		assert.strictEqual(branchLabel({ branch: 'fix' }), 'fix');

		// A missing or null branch is read the same way and does not drop the change.
		const { branch: _removed, ...without } = SHOWN_CHANGE;
		for (const raw of [without, { ...SHOWN_CHANGE, branch: null }]) {
			const read = decodeTrailChange(raw, 'change');
			assert.ok(read.ok, 'the change was dropped');
			assert.strictEqual(read.value.branch, '');
		}
		assert.ok(!decodeTrailChange({ ...SHOWN_CHANGE, branch: 4 }, 'change').ok, 'a branch of the wrong kind is still an error');

		const trail = decodeTrail(JSON.parse(JSON.stringify(TRAIL_SHOW_MERGED)), 'trail');
		assert.ok(trail.ok);
		assert.strictEqual(trail.value.changes.length, 1, 'the merged change with an empty branch stays on its trail');
		assert.strictEqual(trail.value.changes[0].status, 'merged');
	});
});

suite('Entire trail changes: reading on demand', function () {
	this.timeout(30_000);

	test('expand-reads-show: listing reads no trail, expanding reads trail show once, and changes appear', async () => {
		const cli = fakeTrailCli();
		const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
		const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
		const provider = new TrailsProvider(createTrailListingSource(trails), () => 0, { changes, badgeLimit: () => 0 });
		try {
			await provider.refresh();
			const [node] = provider.getChildren() as TrailNode[];
			assert.match(String(provider.getTreeItem(node).description), /changes not loaded/);
			assert.ok(!/0 changes/.test(String(provider.getTreeItem(node).description)), 'a trail that was never read claims no changes');
			assert.deepStrictEqual(invocations(cli.log).filter(line => line.startsWith('trail show')), []);

			const children = (await provider.getChildren(node)) as TrailsNode[];
			assert.strictEqual(children.length, 1);
			assert.strictEqual(provider.getTreeItem(children[0]).label, 'Shape the thing');
			assert.deepStrictEqual(invocations(cli.log).filter(line => line.startsWith('trail show')), ['trail show 40 --json']);
			assert.match(String(provider.getTreeItem(node).description), /1 change/);

			// Collapsing and expanding again reads nothing.
			await provider.getChildren(node);
			assert.strictEqual(invocations(cli.log).filter(line => line.startsWith('trail show')).length, 1);
		} finally {
			provider.dispose();
		}
	});

	test('one read per trail inside the cache lifetime, and one more after it', async () => {
		let now = NOW;
		const { source, calls } = memorySource();
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => now });
		const trail = openTrail(7);

		await service.changesOf(trail);
		await service.changesOf(trail);
		now += 29_000;
		await service.read(7);
		assert.deepStrictEqual(calls.show, [7]);
		assert.strictEqual(calls.plan.length, 1, 'the gate was read once as well');

		now += 2_000;
		await service.changesOf(trail);
		assert.deepStrictEqual(calls.show, [7, 7], 'after the lifetime it is read again');
	});

	test('the viewer and the tree share the read: selecting a trail that was expanded reads nothing more', async () => {
		const { source, calls } = memorySource();
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => NOW });
		await service.changesOf(openTrail(3));
		await service.read(3);
		assert.deepStrictEqual(calls.show, [3]);
	});

	test('a call while the first read is running joins it, even with the cache off', async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		const { source, calls } = memorySource({ delay: () => gate });
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 0, now: () => NOW });
		const first = service.changesOf(openTrail(4));
		const second = service.changesOf(openTrail(4));
		release();
		await Promise.all([first, second]);
		assert.deepStrictEqual(calls.show, [4]);

		await service.changesOf(openTrail(4));
		assert.deepStrictEqual(calls.show, [4, 4], 'with the cache off, the next call reads again');
	});

	test('a read that was invalidated while it ran is dropped and not kept', async () => {
		let release: () => void = () => undefined;
		let held = true;
		const { source, calls } = memorySource({
			delay: () => (held ? new Promise<void>(resolve => (release = resolve)) : Promise.resolve()),
		});
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => NOW });
		const stale = service.changesOf(openTrail(5));
		await new Promise(resolve => setImmediate(resolve));
		service.invalidate([5]);
		held = false;
		release();
		await stale;
		assert.strictEqual(service.peek(5), undefined, 'the dropped read was stored');

		await service.changesOf(openTrail(5));
		assert.deepStrictEqual(calls.show, [5, 5]);
		assert.ok(service.peek(5));
	});

	test('a failed read is reported, not kept, and the next expand reads again', async () => {
		const { source, calls } = memorySource({ failing: [9] });
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => NOW });
		const provider = new TrailsProvider(
			async () => ({ trails: [{ trail: openTrail(9), changes: [] }] }),
			() => 0,
			{ changes: service, badgeLimit: () => 0 },
		);
		try {
			await provider.refresh();
			const [node] = provider.getChildren() as TrailNode[];
			const first = (await provider.getChildren(node)) as TrailsNode[];
			assert.strictEqual(first.length, 1);
			assert.strictEqual(first[0].kind, 'note');
			assert.match(provider.getTreeItem(first[0]).label as string, /Could not load the changes of #9: network down/);
			assert.strictEqual(provider.getTreeItem(first[0]).command, undefined, 'a note selects nothing');

			await provider.getChildren(node);
			assert.deepStrictEqual(calls.show, [9, 9]);
		} finally {
			provider.dispose();
		}
	});

	test('merged-change: a merged change is listed, says merged, and its gate is not read', async () => {
		const cli = fakeTrailCli({ show: JSON.stringify(TRAIL_SHOW_MERGED) });
		const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
		const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
		const provider = new TrailsProvider(createTrailListingSource(trails), () => 0, { changes, badgeLimit: () => 10 });
		try {
			await provider.refresh();
			const [node] = provider.getChildren() as TrailNode[];
			const [row] = (await provider.getChildren(node)) as TrailsNode[];
			const item = provider.getTreeItem(row);
			assert.strictEqual(item.label, 'Shape the thing');
			assert.strictEqual(item.description, 'entirely-vscode/17 · merged');
			assert.strictEqual(item.tooltip, 'No branch');
			assert.strictEqual(describeGate({ kind: 'unknown', detail: 'something else' }), 'gate unknown');
			assert.deepStrictEqual(
				invocations(cli.log).filter(line => /^trail (merge|approvals)/.test(line)),
				[],
				'no merge check was run for a merged change',
			);
			assert.strictEqual(provider.pendingCount, 0);
			assert.strictEqual(provider.badge, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a change with no title and no branch is still a row with a name', async () => {
		const bare = { ...SHOWN_CHANGE, title: undefined, branch: '' };
		const cli = fakeTrailCli({ show: JSON.stringify({ ...TRAIL_SHOW, changes: [bare] }) });
		const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
		const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
		const provider = new TrailsProvider(createTrailListingSource(trails), () => 0, { changes, badgeLimit: () => 0 });
		try {
			await provider.refresh();
			const [node] = provider.getChildren() as TrailNode[];
			const [row] = (await provider.getChildren(node)) as TrailsNode[];
			assert.strictEqual(provider.getTreeItem(row).label, 'entirely-vscode/17');
		} finally {
			provider.dispose();
		}
	});
});

suite('Entire trail changes: the badge', function () {
	this.timeout(30_000);

	test('trail-badge-is-bounded: at most the limit of open trails is read, three at a time, closed trails not at all', async () => {
		const { source, calls, widest } = memorySource({ delay: () => new Promise<void>(resolve => setImmediate(resolve)) });
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => NOW });
		const trails: Trail[] = [
			...Array.from({ length: 14 }, (_, index) => openTrail(index + 1)),
			{ ...openTrail(90), status: 'closed' },
			{ ...openTrail(91), status: 'closed' },
		];

		const coverage = await service.readBadge(trails, 10);

		assert.deepStrictEqual(coverage, { open: 14, read: 10, awaiting: 10, failed: 0 });
		assert.strictEqual(new Set(calls.show).size, 10);
		assert.ok(calls.show.every(number => number <= 10), 'the first ten open trails, in order');
		assert.ok(widest() <= 3, `${widest()} reads ran at once`);
		assert.ok(widest() >= 2, 'the reads were not run at a limited concurrency at all');
		assert.strictEqual((await service.readBadge(trails, 0)).read, 0);
		assert.strictEqual(new Set(calls.show).size, 10, 'a limit of zero read nothing');
	});

	test('a failed trail is counted as failed, and the others still count', async () => {
		const { source } = memorySource({ failing: [2] });
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 30, now: () => NOW });
		const coverage = await service.readBadge([openTrail(1), openTrail(2), openTrail(3)], 10);
		assert.deepStrictEqual(coverage, { open: 3, read: 2, awaiting: 2, failed: 1 });
	});

	test('a user refresh reads for the badge once, a background refresh reads no trail, and the tooltip says what it covers', async () => {
		const answers = {
			list: JSON.stringify({ items: [listedTrail(40, 'One'), listedTrail(41, 'Two'), listedTrail(42, 'Three'), listedTrail(43, 'Old', 'closed')] }),
			shows: {
				40: JSON.stringify(shownTrail(listedTrail(40, 'One'), [SHOWN_CHANGE])),
				41: JSON.stringify(shownTrail(listedTrail(41, 'Two'), [{ ...SHOWN_CHANGE, id: 'c2', number: 18 }])),
				42: JSON.stringify(shownTrail(listedTrail(42, 'Three'), [{ ...SHOWN_CHANGE, id: 'c3', number: 19 }])),
			},
			merge: JSON.stringify({ ...MERGE_PLAN, mergeable: false, blockers: ['approvals: 1 required, 0 given'] }),
		};
		const cli = fakeTrailCli(answers);
		const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
		const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
		const provider = new TrailsProvider(createTrailListingSource(trails), () => 0, { changes, badgeLimit: () => 2 });
		const shows = (): string[] => invocations(cli.log).filter(line => line.startsWith('trail show'));
		const badge = (): { readonly value: number; readonly tooltip: string } | undefined => provider.badge;
		try {
			assert.strictEqual(badge(), undefined, 'no badge before anything is read');

			await provider.refresh();
			assert.strictEqual(shows().length, 2, 'the limit of two was not honoured');
			assert.ok(!shows().some(line => line.includes(' 43 ')), 'a closed trail was read');
			assert.strictEqual(provider.pendingCount, 2);
			assert.strictEqual(badge()?.value, 2);
			assert.match(badge()?.tooltip ?? '', /2 changes not yet approved, counted from 2 of 3 open trails; 1 open trail not read, expand one to read it/);

			// The timer's refresh keeps what it has and reads no trail.
			const before = invocations(cli.log).length;
			await provider.refresh('background');
			assert.deepStrictEqual(
				invocations(cli.log).slice(before).filter(line => /^trail (show|merge|approvals)/.test(line)),
				[],
			);
			assert.strictEqual(badge()?.value, 2, 'the background refresh dropped the badge');

			// Expanding the third trail adds to the count.
			const nodes = provider.getChildren() as TrailNode[];
			const third = nodes.find(node => node.entry.trail.number === 42);
			assert.ok(third);
			await provider.getChildren(third);
			assert.strictEqual(provider.pendingCount, 3);

			// A refresh a person asks for forgets and reads again.
			await provider.refresh();
			assert.ok(shows().length >= 4);
		} finally {
			provider.dispose();
		}
	});

	test('a badge limit of zero reads nothing and shows no badge', async () => {
		const cli = fakeTrailCli();
		const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
		const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
		const provider = new TrailsProvider(createTrailListingSource(trails), () => 0, { changes, badgeLimit: () => 0 });
		try {
			await provider.refresh();
			assert.deepStrictEqual(invocations(cli.log).filter(line => line.startsWith('trail show')), []);
			assert.strictEqual(provider.badge, undefined);
			assert.strictEqual(provider.pendingCount, 0);
		} finally {
			provider.dispose();
		}
	});

	test('the badge words say what was counted', () => {
		assert.strictEqual(
			describeBadge(1, { open: 12, read: 10, awaiting: 1, failed: 0 }, 10),
			'1 change not yet approved, counted from 10 of 12 open trails; 2 open trails not read, expand one to read it',
		);
		assert.strictEqual(
			describeBadge(2, { open: 3, read: 3, awaiting: 2, failed: 0 }, 3),
			'2 changes not yet approved, counted from 3 of 3 open trails',
		);
		assert.strictEqual(describeBadge(1, undefined, 1), '1 change not yet approved, counted from the 1 trail whose changes were read');
	});

	test('the review commands find a change to act on from trail show, not from the list', async () => {
		const { source } = memorySource();
		const service = new TrailChangesService({ trails: source, ttlSeconds: () => 0, now: () => NOW });
		const listed = [openTrail(1), openTrail(2), { ...openTrail(3), status: 'closed' as const }];
		const filled = await service.withChanges(listed, 50);
		assert.deepStrictEqual(filled.map(trail => trail.changes.length), [1, 1, 1]);

		const limited = await service.withChanges(listed, 1);
		assert.deepStrictEqual(limited.map(trail => trail.changes.length), [1, 0, 0]);
	});
});
