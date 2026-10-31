import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { GatedTrail, TrailComment, TrailFinding, WatchState } from '../lib/entire';
import { TrailsProvider, selectionOfTrailsNode, type ChangeNode, type TrailsNode } from '../providers/trailsProvider';
import type { ThreadGroupNode, ThreadNode } from '../providers/trailThreads';
import { createThreadSource, type ThreadSource } from '../services/trailThreadSource';
import type { TrailResult } from '../services/trailService';
import { SHOWN_CHANGE } from './support/trailCli';
import { depthRig } from './support/trailDepthHarness';

const ROOT = path.resolve(__dirname, '..', '..');

const TRAIL = { id: '01T', number: 40, title: 'Shape the thing', status: 'open' as const, partial: false, changes: [SHOWN_CHANGE] };
const GATED: GatedTrail = {
	trail: TRAIL,
	changes: [{ change: { ...SHOWN_CHANGE }, gate: { kind: 'open', approvals: [] } as never }],
};

const DISCUSSIONS: TrailComment[] = [
	{ id: 'd1', title: 'Naming', resolved: false, lastMessageAuthor: 'ada', messageCount: 2 },
	{ id: 'd2', resolved: true, lastMessageAuthor: 'grace', messageCount: 1 },
];
const FINDINGS: TrailFinding[] = [
	{ id: 'f1', title: 'Unchecked input', state: 'open', severity: 'high', file: 'src/a.ts', line: 12 },
	{ id: 'f2', body: 'A line is too long.\nSecond line.', state: 'open', severity: 'low' },
	{ id: 'f3', title: 'Old', state: 'resolved', severity: 'medium' },
	{ id: 'f4', title: 'Skipped', state: 'dismissed', severity: 'medium' },
];

/** A thread source that counts what it is asked, with answers that can be changed. */
class FakeThreads implements ThreadSource {
	discussionReads = 0;
	findingReads = 0;
	discussionAnswer: TrailResult<readonly TrailComment[]> = { kind: 'ok', value: DISCUSSIONS };
	findingAnswer: TrailResult<readonly TrailFinding[]> = { kind: 'ok', value: FINDINGS };
	watches = new Map<string, WatchState>();
	private readonly listeners = new Set<(key: string) => void>();

	async discussions(): Promise<TrailResult<readonly TrailComment[]>> {
		this.discussionReads += 1;
		return this.discussionAnswer;
	}
	async findings(): Promise<TrailResult<readonly TrailFinding[]>> {
		this.findingReads += 1;
		return this.findingAnswer;
	}
	watchState(key: string): WatchState | undefined {
		return this.watches.get(key);
	}
	onWatchChanged(listener: (key: string) => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}
	changeWatch(key: string, state: WatchState | undefined): void {
		if (state) {
			this.watches.set(key, state);
		} else {
			this.watches.delete(key);
		}
		for (const listener of this.listeners) {
			listener(key);
		}
	}
}

async function providerOver(threads: ThreadSource): Promise<{ provider: TrailsProvider; change: ChangeNode; fired: unknown[] }> {
	const provider = new TrailsProvider(
		async () => ({ project: 'gh/greysquirr3l', trails: [{ trail: TRAIL, changes: [] }] }),
		() => 0,
		{
			changes: {
				peek: () => GATED,
				clear: () => undefined,
				changesOf: async () => ({ kind: 'ok' as const, entry: GATED, loadedAt: 0 }),
				readBadge: async () => ({ open: 1, read: 1, awaiting: 0, failed: 0 }),
			},
			badgeLimit: () => 0,
		},
		threads,
	);
	await provider.refresh();
	const [trail] = provider.getChildren() as TrailsNode[];
	const [change] = (await provider.getChildren(trail)) as TrailsNode[];
	assert.strictEqual(change.kind, 'change');
	const fired: unknown[] = [];
	provider.onDidChangeTreeData(element => fired.push(element));
	return { provider, change: change as ChangeNode, fired };
}

const nodes = async (provider: TrailsProvider, parent: TrailsNode): Promise<ThreadNode[]> => (await provider.getChildren(parent)) as ThreadNode[];

suite('Comments and Findings under a change', () => {
	test('a change row is collapsible, and expanding it reads nothing', async () => {
		const threads = new FakeThreads();
		const { provider, change } = await providerOver(threads);

		assert.strictEqual(provider.getTreeItem(change).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		const groups = (await provider.getChildren(change)) as ThreadGroupNode[];
		assert.deepStrictEqual(groups.map(group => provider.getTreeItem(group).label), ['Comments', 'Findings']);
		assert.deepStrictEqual([threads.discussionReads, threads.findingReads], [0, 0], 'no listing until a group is expanded');
		provider.dispose();
	});

	test('each group reads only when expanded, and the other group stays unread', async () => {
		const threads = new FakeThreads();
		const { provider, change } = await providerOver(threads);
		const [comments, findings] = (await provider.getChildren(change)) as ThreadGroupNode[];

		await nodes(provider, comments);
		assert.deepStrictEqual([threads.discussionReads, threads.findingReads], [1, 0]);
		await nodes(provider, findings);
		assert.deepStrictEqual([threads.discussionReads, threads.findingReads], [1, 1]);
		provider.dispose();
	});

	test('discussions show their title, state, message count and last author, with the context value that decides the actions', async () => {
		const { provider, change } = await providerOver(new FakeThreads());
		const [comments] = (await provider.getChildren(change)) as ThreadGroupNode[];
		const rows = await nodes(provider, comments);
		const items = rows.map(row => provider.getTreeItem(row));

		assert.deepStrictEqual(items.map(item => item.label), ['Naming', 'Untitled discussion']);
		assert.deepStrictEqual(items.map(item => item.description), ['open · 2 messages · last by ada', 'resolved · 1 message · last by grace']);
		assert.deepStrictEqual(items.map(item => item.contextValue), ['entirely.discussion', 'entirely.discussion.resolved']);
		assert.deepStrictEqual(items.map(item => (item.iconPath as vscode.ThemeIcon).id), ['comment-discussion', 'pass']);
		assert.ok(items.every(item => item.collapsibleState === vscode.TreeItemCollapsibleState.None), 'messages are fetched only on demand');
		provider.dispose();
	});

	test('findings show severity, status and place, with an icon by severity and status', async () => {
		const { provider, change } = await providerOver(new FakeThreads());
		const [, findings] = (await provider.getChildren(change)) as ThreadGroupNode[];
		const items = (await nodes(provider, findings)).map(row => provider.getTreeItem(row));

		assert.deepStrictEqual(items.map(item => item.label), ['Unchecked input', 'A line is too long.', 'Old', 'Skipped']);
		assert.deepStrictEqual(items.map(item => item.description), ['high · open · src/a.ts:12', 'low · open', 'medium · resolved', 'medium · dismissed']);
		assert.deepStrictEqual(items.map(item => item.contextValue), ['entirely.finding.open', 'entirely.finding.open', 'entirely.finding.resolved', 'entirely.finding.dismissed']);
		assert.deepStrictEqual(items.map(item => (item.iconPath as vscode.ThemeIcon).id), ['error', 'info', 'pass', 'circle-slash']);
		provider.dispose();
	});

	test('an empty group says so', async () => {
		const threads = new FakeThreads();
		threads.discussionAnswer = { kind: 'ok', value: [] };
		threads.findingAnswer = { kind: 'ok', value: [] };
		const { provider, change } = await providerOver(threads);
		const [comments, findings] = (await provider.getChildren(change)) as ThreadGroupNode[];

		assert.deepStrictEqual((await nodes(provider, comments)).map(row => provider.getTreeItem(row).label), ['No discussions']);
		assert.deepStrictEqual((await nodes(provider, findings)).map(row => provider.getTreeItem(row).label), ['No findings']);
		provider.dispose();
	});

	test('a failed read shows its reason with a retry, is not kept, and expanding again reads again', async () => {
		const threads = new FakeThreads();
		threads.discussionAnswer = { kind: 'failed', detail: 'the CLI could not be reached' };
		const { provider, change, fired } = await providerOver(threads);
		const [comments] = (await provider.getChildren(change)) as ThreadGroupNode[];

		const [note] = await nodes(provider, comments);
		const item = provider.getTreeItem(note);
		assert.match(String(item.label), /Could not read the discussions: the CLI could not be reached/);
		assert.strictEqual(item.contextValue, 'entirely.threadFailed');

		threads.discussionAnswer = { kind: 'ok', value: DISCUSSIONS };
		provider.retryThreads(note);
		assert.ok(fired.includes(comments), 'the group is redrawn');
		assert.strictEqual((await nodes(provider, comments)).length, 2);
		assert.strictEqual(threads.discussionReads, 2);
		provider.dispose();
	});

	test('the view\'s own refresh keeps what was read, and a refresh the person asks for reads again', async () => {
		const threads = new FakeThreads();
		const { provider, change } = await providerOver(threads);
		const [comments] = (await provider.getChildren(change)) as ThreadGroupNode[];
		await nodes(provider, comments);

		await provider.refresh('background');
		await nodes(provider, comments);
		assert.strictEqual(threads.discussionReads, 1, 'the timer does not read discussions again');

		await provider.refresh('user');
		await nodes(provider, comments);
		assert.strictEqual(threads.discussionReads, 2);
		provider.dispose();
	});

	test('a write or a watch event forgets what was read for that change and redraws its drawn groups', async () => {
		const threads = new FakeThreads();
		const { provider, change, fired } = await providerOver(threads);
		const [comments, findings] = (await provider.getChildren(change)) as ThreadGroupNode[];
		await nodes(provider, comments);
		await nodes(provider, findings);
		fired.length = 0;

		provider.invalidateThreads('entirely-vscode/17');
		assert.deepStrictEqual(fired, [comments, findings]);
		await nodes(provider, comments);
		await nodes(provider, findings);
		assert.deepStrictEqual([threads.discussionReads, threads.findingReads], [2, 2]);

		fired.length = 0;
		provider.invalidateThreads('other/1');
		assert.deepStrictEqual(fired, [], 'another change is not touched');
		provider.dispose();
	});

	test('the change row shows that it is watched, and is redrawn when that changes', async () => {
		const threads = new FakeThreads();
		const { provider, change, fired } = await providerOver(threads);

		assert.strictEqual(provider.getTreeItem(change).contextValue, 'entirely.change');
		threads.changeWatch('entirely-vscode/17', { kind: 'watching', updates: 3 });
		assert.ok(fired.some(element => (element as ChangeNode).kind === 'change'), 'the change row is redrawn');
		const item = provider.getTreeItem(change);
		assert.match(String(item.description), /watching · 3 updates/);
		assert.strictEqual(item.contextValue, 'entirely.change.watched');

		threads.changeWatch('entirely-vscode/17', { kind: 'ended', reason: 'the stream ended' });
		const ended = provider.getTreeItem(change);
		assert.match(String(ended.description), /watch ended: the stream ended/);
		assert.strictEqual(ended.contextValue, 'entirely.change', 'an ended watch can be started again');

		threads.changeWatch('entirely-vscode/17', undefined);
		assert.doesNotMatch(String(provider.getTreeItem(change).description), /watch/);
		provider.dispose();
	});

	test('a watched change that awaits approval keeps both facts in its context value', async () => {
		const threads = new FakeThreads();
		const waiting: GatedTrail = { trail: TRAIL, changes: [{ change: { ...SHOWN_CHANGE }, gate: { kind: 'awaiting-approval', blockers: ['approvals: 1 required, 0 given'] } as never }] };
		const provider = new TrailsProvider(
			async () => ({ trails: [{ trail: TRAIL, changes: [] }] }),
			() => 0,
			{ changes: { peek: () => waiting, clear: () => undefined, changesOf: async () => ({ kind: 'ok' as const, entry: waiting, loadedAt: 0 }), readBadge: async () => ({ open: 1, read: 1, awaiting: 1, failed: 0 }) }, badgeLimit: () => 0 },
			threads,
		);
		await provider.refresh();
		const [trail] = provider.getChildren() as TrailsNode[];
		const [change] = (await provider.getChildren(trail)) as TrailsNode[];
		threads.changeWatch('entirely-vscode/17', { kind: 'watching', updates: 0 });
		assert.strictEqual(provider.getTreeItem(change).contextValue, 'entirely.change.awaitingApproval.watched');
		provider.dispose();
	});

	test('the parent of every row leads back to its change', async () => {
		const { provider, change } = await providerOver(new FakeThreads());
		const [comments, findings] = (await provider.getChildren(change)) as ThreadGroupNode[];
		const [discussion] = await nodes(provider, comments);
		const [finding] = await nodes(provider, findings);

		assert.strictEqual(provider.getParent(comments), change);
		assert.strictEqual(provider.getParent(discussion), comments);
		assert.strictEqual(provider.getParent(finding), findings);
		provider.dispose();
	});

	test('no row under a change selects anything in the detail panel', async () => {
		const { provider, change } = await providerOver(new FakeThreads());
		const [comments] = (await provider.getChildren(change)) as ThreadGroupNode[];
		assert.strictEqual(selectionOfTrailsNode(comments), undefined);
		assert.strictEqual(selectionOfTrailsNode((await nodes(provider, comments))[0]), undefined);
		assert.ok(selectionOfTrailsNode(change));
		provider.dispose();
	});

	test('a view without a thread source keeps the change row as it was', async () => {
		const provider = new TrailsProvider(async () => ({ trails: [{ trail: TRAIL, changes: [] }] }), () => 0, {
			changes: { peek: () => GATED, clear: () => undefined, changesOf: async () => ({ kind: 'ok' as const, entry: GATED, loadedAt: 0 }), readBadge: async () => ({ open: 1, read: 1, awaiting: 0, failed: 0 }) },
			badgeLimit: () => 0,
		});
		await provider.refresh();
		const [trail] = provider.getChildren() as TrailsNode[];
		const [change] = (await provider.getChildren(trail)) as TrailsNode[];
		assert.strictEqual(provider.getTreeItem(change).collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.deepStrictEqual(await provider.getChildren(change), []);
		provider.dispose();
	});
});

suite('Comments and Findings over a real service', () => {
	test('read the fake CLI\'s discussions and findings, every status', async () => {
		const rig = depthRig();
		const source = createThreadSource(rig.depth, rig.discussions, rig.findings, rig.watch, () => 'ada');
		const selector = { kind: 'change' as const, repository: 'entirely-vscode', number: 17 };

		const discussions = await source.discussions(selector);
		assert.ok(discussions.kind === 'ok');
		assert.deepStrictEqual(discussions.value.map(row => row.title), ['Naming']);
		const findings = await source.findings(selector);
		assert.ok(findings.kind === 'ok');
		assert.deepStrictEqual(findings.value.map(row => row.state), ['open', 'open', 'resolved']);
	});

	test('a collaborator without project access gets the honest message under the change, naming the web UI and the organisation workaround', async () => {
		const rig = depthRig({ projectNotFound: true });
		const source = createThreadSource(rig.depth, rig.discussions, rig.findings, rig.watch, () => 'ada');
		const selector = { kind: 'change' as const, repository: 'entirely-vscode', number: 17 };

		for (const read of [await source.discussions(selector), await source.findings(selector)]) {
			assert.ok(read.kind === 'failed');
			assert.match(read.detail, /login Entirely acted as \(ada\) has no access to the project gh\/greysquirr3l/);
			assert.match(read.detail, /how the CLI and the forge behave/);
			assert.match(read.detail, /web UI/);
			assert.match(read.detail, /GitHub organisation/);
			assert.doesNotMatch(read.detail, /grant/i);
		}
	});
});

interface MenuEntry {
	command: string;
	when?: string;
	group?: string;
}

suite('Trail depth manifest', () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: { command: string; title: string; icon?: string }[]; menus: Record<string, MenuEntry[]> };
	};

	/** Every context value the Trails view produces. */
	const CONTEXT_VALUES = [
		'entirely.trail',
		'entirely.trailNote',
		'entirely.change',
		'entirely.change.awaitingApproval',
		'entirely.change.watched',
		'entirely.change.awaitingApproval.watched',
		'entirely.threadGroup',
		'entirely.discussion',
		'entirely.discussion.resolved',
		'entirely.finding.open',
		'entirely.finding.resolved',
		'entirely.finding.dismissed',
		'entirely.threadFailed',
		'entirely.threadEmpty',
	];

	/** Which context values a menu entry's `viewItem` clause accepts. */
	function matches(when: string): string[] {
		const equal = /viewItem == ([\w.]+)/.exec(when);
		if (equal) {
			return CONTEXT_VALUES.filter(value => value === equal[1]);
		}
		const pattern = /viewItem =~ \/(.+)\/(?:\s|$)/.exec(when);
		assert.ok(pattern, `a viewItem clause in '${when}'`);
		const regex = new RegExp(pattern[1].replace(/\\\\/g, '\\'));
		return CONTEXT_VALUES.filter(value => regex.test(value));
	}

	const handlers = fs
		.readdirSync(path.join(ROOT, 'src', 'commands'))
		.filter(name => name.endsWith('.ts'))
		.map(name => fs.readFileSync(path.join(ROOT, 'src', 'commands', name), 'utf8'))
		.join('\n');
	const trailEntries = manifest.contributes.menus['view/item/context'].filter(entry => entry.when?.includes('view == entirely.trails'));

	test('every item action of the Trails view has a handler and a when clause that matches a real context value', () => {
		assert.ok(trailEntries.length >= 15);
		for (const entry of trailEntries) {
			assert.ok(handlers.includes(`registerCommand('${entry.command}'`), `${entry.command} has a handler`);
			assert.ok(entry.when, `${entry.command} has a when clause`);
			assert.ok(matches(entry.when).length > 0, `${entry.command}: '${entry.when}' matches no context value the view produces`);
		}
	});

	test('each row carries the inline actions the spec lists', () => {
		const inline = (value: string): string[] =>
			trailEntries
				.filter(entry => entry.group?.startsWith('inline') && entry.when && matches(entry.when).includes(value))
				.map(entry => entry.command.replace('entirely.', ''))
				.sort();
		assert.deepStrictEqual(inline('entirely.trail'), ['trailUpdate']);
		assert.deepStrictEqual(inline('entirely.change'), ['trailStartDiscussion', 'trailWatch']);
		assert.deepStrictEqual(inline('entirely.change.watched'), ['trailStartDiscussion', 'trailStopWatching']);
		assert.deepStrictEqual(inline('entirely.discussion'), ['trailReplyToDiscussion', 'trailResolveDiscussion', 'trailShowDiscussion']);
		assert.deepStrictEqual(inline('entirely.discussion.resolved'), ['trailReopenDiscussion', 'trailReplyToDiscussion', 'trailShowDiscussion']);
		assert.deepStrictEqual(inline('entirely.finding.open'), ['trailApplyFinding', 'trailDismissFinding', 'trailResolveFinding']);
		assert.deepStrictEqual(inline('entirely.finding.resolved'), ['trailReopenFinding']);
		assert.deepStrictEqual(inline('entirely.finding.dismissed'), ['trailReopenFinding']);
		assert.deepStrictEqual(inline('entirely.threadFailed'), ['trailRetryThreads']);
	});

	test('the rest are in the context menu', () => {
		const menu = (value: string): string[] =>
			trailEntries
				.filter(entry => !entry.group?.startsWith('inline') && entry.when && matches(entry.when).includes(value))
				.map(entry => entry.command.replace('entirely.', ''))
				.sort();
		assert.deepStrictEqual(menu('entirely.discussion'), ['trailDeleteMessage', 'trailEditMessage']);
		assert.deepStrictEqual(menu('entirely.finding.open'), ['trailShowFinding', 'trailUpdateFinding']);
	});

	test('Create Trail is in the Trails view title and every new command has a title and a place in the palette', () => {
		const titles = manifest.contributes.menus['view/title'].filter(entry => entry.when === 'view == entirely.trails');
		assert.deepStrictEqual(titles.map(entry => entry.command), ['entirely.trailCreate']);
		const palette = new Set(manifest.contributes.menus.commandPalette.filter(entry => entry.when === 'false').map(entry => entry.command));
		const added = manifest.contributes.commands.filter(command => /^entirely\.(trail(Create|Update|Watch|StopWatching|StopAllWatches|StartDiscussion|ReplyToDiscussion|EditMessage|DeleteMessage|ResolveDiscussion|ReopenDiscussion|ShowDiscussion|ResolveFinding|DismissFinding|ReopenFinding|UpdateFinding|ApplyFinding|ShowFinding|RetryThreads))$/.test(command.command));
		assert.strictEqual(added.length, 19);
		for (const command of added) {
			assert.ok(command.title.length > 0);
			assert.strictEqual(palette.has(command.command), command.command === 'entirely.trailRetryThreads', `${command.command} palette entry`);
		}
	});

	test('the settings for the watch are declared with their bounds', () => {
		const properties = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default: number; minimum: number; maximum: number }> } } }).contributes.configuration.properties;
		assert.deepStrictEqual(
			[properties['entirely.trailWatchLimit'].default, properties['entirely.trailWatchLimit'].minimum, properties['entirely.trailWatchLimit'].maximum],
			[3, 1, 10],
		);
		assert.deepStrictEqual(
			[properties['entirely.trailWatchRefreshDelay'].default, properties['entirely.trailWatchRefreshDelay'].minimum, properties['entirely.trailWatchRefreshDelay'].maximum],
			[2, 1, 30],
		);
	});
});
