import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	describeGate,
	pendingApprovals,
	readTrailGate,
	scopeToProject,
	type Trail,
	type TrailMergePlan,
} from '../lib/entire';
import { TrailsProvider, type TrailsNode } from '../providers/trailsProvider';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { createTrailListingSource } from '../services/trailListing';
import { TrailChangesService } from '../services/trailChanges';
import { TrailService } from '../services/trailService';
import { MERGE_PLAN, TRAIL_LIST, fakeTrailCli, invocations } from './support/trailCli';

const APPROVED = JSON.stringify({
	approvals: [{ id: 'a1', author: 'someone', event: 'approved' }],
});

/** A merge plan the CLI reports, with the fields a test cares about. */
function plan(overrides: Partial<TrailMergePlan> = {}): TrailMergePlan {
	return {
		change: 'entirely-vscode/17',
		mergeable: true,
		blockers: [],
		reasons: [],
		wouldBypass: false,
		merged: false,
		...overrides,
	};
}

/** A trail with changes in the given repositories. */
function trailIn(...repositories: string[]): Trail {
	return {
		id: 't',
		number: 1,
		status: 'open',
		partial: false,
		changes: repositories.map((repository, index) => ({
			id: `c${index}`,
			repository,
			branch: 'b',
			number: index + 1,
		})),
	};
}

/** A listing source over a fake CLI. */
function sourceFor(answers: Parameters<typeof fakeTrailCli>[0]) {
	const cli = fakeTrailCli(answers);
	const trails = new TrailService({
		runner: cli.runner,
		workspaceRoot: () => process.cwd(),
		actingHandle: () => undefined,
	});
	const changes = new TrailChangesService({ trails, ttlSeconds: () => 30 });
	return {
		cli,
		trails,
		changes,
		source: createTrailListingSource(trails),
		/** What the provider reads changes through, with the badge read limited as given. */
		reading: (badgeLimit = 10) => ({ changes, badgeLimit: () => badgeLimit }),
	};
}

suite('Entire trail surface', () => {
	test('list-trails: the trail list is populated from the CLI trail list, and carries no changes', async () => {
		const { cli, source, reading } = sourceFor({});
		const listing = await source();

		assert.strictEqual(listing.project, 'gh/greysquirr3l');
		assert.strictEqual(listing.trails.length, 1);
		assert.strictEqual(listing.trails[0].trail.number, 40);
		assert.strictEqual(listing.trails[0].changes.length, 0, 'the CLI list has no changes key');

		const asked = invocations(cli.log).find(line => line.startsWith('trail list'));
		assert.ok(asked, 'the CLI was asked for the list');
		assert.match(asked, /--project gh\/greysquirr3l/);

		const provider = new TrailsProvider(source, () => 0, reading(0));
		await provider.refresh();
		const [node] = provider.getChildren() as TrailsNode[];
		assert.strictEqual(provider.getTreeItem(node).label, '#40 Shape the thing');
		assert.match(String(provider.getTreeItem(node).description), /changes not loaded/);
		assert.deepStrictEqual(
			invocations(cli.log).filter(line => line.startsWith('trail show')),
			[],
			'listing and rendering read no trail',
		);

		const children = await provider.getChildren(node);
		assert.strictEqual(children.length, 1);
		assert.match(String(provider.getTreeItem(node).description), /1 change/);
		provider.dispose();
	});

	test('pending-approval: a change the CLI says is awaiting approval is surfaced', async () => {
		const { source, reading } = sourceFor({
			merge: JSON.stringify({
				...MERGE_PLAN,
				mergeable: false,
				blockers: ['approvals: 1 required, 0 given'],
			}),
		});
		const provider = new TrailsProvider(source, () => 0, reading());
		await provider.refresh();

		assert.strictEqual(provider.pendingCount, 1);
		const [trail] = provider.getChildren() as TrailsNode[];
		const [change] = (await provider.getChildren(trail)) as TrailsNode[];
		assert.match(String(provider.getTreeItem(change).description), /awaiting approval/);
		assert.match(String(provider.getTreeItem(trail).description), /1 awaiting approval/);
		provider.dispose();
	});

	test('other-project: a trail from another project does not appear', async () => {
		const list = JSON.stringify({
			items: [
				{ ...TRAIL_LIST.items[0] },
				{
					id: 'other',
					number: 41,
					title: 'Elsewhere',
					status: 'open',
					changes: [
						{ id: 'x', repository: 'gh/other/app', branch: 'b', number: 3 },
					],
				},
			],
		});
		const { source } = sourceFor({ list });
		const listing = await source();

		assert.deepStrictEqual(
			listing.trails.map(entry => entry.trail.number),
			[40],
		);
	});

	test('scopeToProject keeps qualified repositories of the project only', () => {
		const kept = scopeToProject(
			[trailIn('app'), trailIn('gh/mine/app'), trailIn('gh/other/app')],
			'gh/mine',
		);
		assert.strictEqual(kept.length, 2);
	});

	test('the gate comes from the CLI rather than from a count of approvals', async () => {
		const approved = readTrailGate(plan({ mergeable: false, blockers: ['approvals missing'] }), [
			{ id: 'a', author: 'x', event: 'approved' },
		]);
		assert.strictEqual(approved.kind, 'awaiting-approval');

		const none = readTrailGate(plan(), []);
		assert.strictEqual(none.kind, 'open');

		// End to end: one approval on record, but the CLI still blocks.
		const { source, changes } = sourceFor({
			approvals: APPROVED,
			merge: JSON.stringify({ ...MERGE_PLAN, mergeable: false, blockers: ['approval gate'] }),
		});
		const listing = await source();
		const read = await changes.changesOf(listing.trails[0].trail);
		assert.strictEqual(read.kind, 'ok');
		assert.strictEqual(pendingApprovals(read.kind === 'ok' ? [read.entry] : []).length, 1);
	});

	test('another blocker is not an approval wait, and no answer is unknown', () => {
		const blocked = readTrailGate(plan({ mergeable: false, blockers: ['CI failed'] }), []);
		assert.strictEqual(blocked.kind, 'blocked');
		assert.strictEqual(describeGate(blocked), 'blocked · CI failed');

		const unknown = readTrailGate(undefined, undefined);
		assert.strictEqual(unknown.kind, 'unknown');
		assert.strictEqual(describeGate(unknown), 'gate unknown');
	});

	test('a missing CLI leaves the section empty with a reason', async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-no-cli-'));
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const trails = new TrailService({
			runner,
			workspaceRoot: () => process.cwd(),
			actingHandle: () => undefined,
		});

		const listing = await createTrailListingSource(trails)();

		assert.strictEqual(listing.trails.length, 0);
		assert.ok(listing.emptyReason && listing.emptyReason.length > 0);
	});
	test('a refresh that arrives while one is running is skipped', async () => {
		let calls = 0;
		let release: () => void = () => undefined;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		const provider = new TrailsProvider(async () => {
			calls += 1;
			await gate;
			return { trails: [] };
		}, () => 0);

		try {
			const first = provider.refresh();
			const second = provider.refresh();
			release();
			await Promise.all([first, second]);

			assert.strictEqual(calls, 1);

			await provider.refresh();
			assert.strictEqual(calls, 2, 'the guard was not released after the refresh');
		} finally {
			provider.dispose();
		}
	});

	test('polling only reads: no review action is run on a timer', async () => {
		const { cli, source } = sourceFor({});
		const provider = new TrailsProvider(source, () => 0.05);

		try {
			await new Promise(resolve => setTimeout(resolve, 600));
		} finally {
			provider.dispose();
		}

		const acted = invocations(cli.log).filter(line =>
			/^trail (approve|comment|finding add|merge(?!.*--dry-run)|checkout|resume|link|unlink)/.test(line),
		);

		assert.deepStrictEqual(acted, []);
		assert.ok(invocations(cli.log).length > 0, 'the poll never ran');
	});
});
