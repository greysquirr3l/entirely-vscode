import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { truncatePrompt, type Session, type SessionListing } from '../lib/entire';
import { buildGroups, describeSession, SessionsProvider } from '../providers/sessionsProvider';
import { SessionDetailProvider } from '../providers/sessionDetailProvider';

/** A session as the CLI reports one. */
function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'abc-123',
		agent: 'Copilot CLI',
		status: 'active',
		worktreePath: '/work/sandbox',
		branch: 'master',
		turns: 3,
		pendingTurns: 0,
		checkpoints: 2,
		lastPrompt: 'add a test',
		...overrides,
	};
}

/** A provider over a fixed listing. */
function providerFor(listing: SessionListing): SessionsProvider {
	return new SessionsProvider(async () => listing, () => 0);
}

suite('Entire sessions tree', () => {
	test('renders one group per status with the right number of children', async () => {
		const provider = providerFor({
			sessions: [
				makeSession({ id: 'a', status: 'active' }),
				makeSession({ id: 'b', status: 'active' }),
				makeSession({ id: 'c', status: 'finished' }),
			],
		});

		try {
			await provider.refresh();

			const groups = provider.getChildren();
			assert.strictEqual(groups.length, 2);

			const active = groups[0];
			assert.strictEqual(active.kind, 'group');
			assert.strictEqual(active.kind === 'group' && active.status, 'active');
			assert.strictEqual(provider.getChildren(active).length, 2);

			const finished = groups[1];
			assert.strictEqual(finished.kind === 'group' && finished.status, 'finished');
			assert.strictEqual(provider.getChildren(finished).length, 1);
		} finally {
			provider.dispose();
		}
	});

	test('puts an active session group at the top', async () => {
		const provider = providerFor({
			sessions: [
				makeSession({ id: 'a', status: 'archived' }),
				makeSession({ id: 'b', status: 'active' }),
				makeSession({ id: 'c', status: 'finished' }),
			],
		});

		try {
			await provider.refresh();
			const groups = provider.getChildren();
			assert.strictEqual(groups[0].kind === 'group' && groups[0].status, 'active');
			assert.strictEqual(groups[1].kind === 'group' && groups[1].status, 'archived');
			assert.strictEqual(groups[2].kind === 'group' && groups[2].status, 'finished');
		} finally {
			provider.dispose();
		}
	});

	test('reports the right parent for a session', async () => {
		const provider = providerFor({
			sessions: [
				makeSession({ id: 'a', status: 'active' }),
				makeSession({ id: 'b', status: 'finished' }),
			],
		});

		try {
			await provider.refresh();
			const groups = provider.getChildren();
			const active = groups[0];
			const finished = groups[1];

			const activeChild = provider.getChildren(active)[0];
			const finishedChild = provider.getChildren(finished)[0];

			assert.strictEqual(provider.getParent(activeChild), active);
			assert.strictEqual(provider.getParent(finishedChild), finished);
			assert.strictEqual(provider.getParent(active), undefined);
		} finally {
			provider.dispose();
		}
	});

	test('shows the agent, status, branch and counts on a session item', async () => {
		const provider = providerFor({ sessions: [makeSession()] });

		try {
			await provider.refresh();
			const group = provider.getChildren()[0];
			const item = provider.getChildren(group)[0];
			const treeItem = provider.getTreeItem(item);

			assert.strictEqual(treeItem.label, 'Copilot CLI — add a test');
			assert.match(String(treeItem.description), /Active/);
			assert.match(String(treeItem.description), /master/);
			assert.match(String(treeItem.description), /3 turns/);
			assert.match(String(treeItem.description), /2 checkpoints/);
		} finally {
			provider.dispose();
		}
	});

	test('truncates the last prompt to a single line', () => {
		assert.strictEqual(truncatePrompt('first line\nsecond line'), 'first line');
		assert.strictEqual(truncatePrompt('  spaced   out  '), 'spaced out');

		const long = 'x'.repeat(200);
		const truncated = truncatePrompt(long);
		assert.ok(truncated.length < long.length);
		assert.ok(truncated.endsWith('…'));
	});

	test('shows a prompt with newlines on one line only', async () => {
		const provider = providerFor({
			sessions: [makeSession({ lastPrompt: 'do the thing\nand then the other thing' })],
		});

		try {
			await provider.refresh();
			const group = provider.getChildren()[0];
			const item = provider.getChildren(group)[0];
			const treeItem = provider.getTreeItem(item);

			assert.strictEqual(treeItem.label, 'Copilot CLI — do the thing');
		} finally {
			provider.dispose();
		}
	});

	test('shows an empty tree for a repository with no sessions', async () => {
		const provider = providerFor({ sessions: [] });

		try {
			await provider.refresh();
			assert.deepStrictEqual(provider.getChildren(), []);
			assert.strictEqual(provider.emptyReason, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('explains why the tree is empty when the source says so', async () => {
		const provider = providerFor({ sessions: [], emptyReason: 'the CLI is not installed' });

		try {
			await provider.refresh();
			assert.deepStrictEqual(provider.getChildren(), []);
			assert.strictEqual(provider.emptyReason, 'the CLI is not installed');
		} finally {
			provider.dispose();
		}
	});

	test('re-queries the source when refreshed', async () => {
		let listings: SessionListing[] = [
			{ sessions: [makeSession({ id: 'a' })] },
			{ sessions: [makeSession({ id: 'a' }), makeSession({ id: 'b', status: 'finished' })] },
		];
		const provider = new SessionsProvider(async () => listings.shift() ?? { sessions: [] }, () => 0);

		try {
			await provider.refresh();
			assert.strictEqual(provider.getChildren().length, 1);

			await provider.refresh();
			assert.strictEqual(provider.getChildren().length, 2);
		} finally {
			provider.dispose();
		}
	});

	test('groups sessions built outside the provider', () => {
		const groups = buildGroups([makeSession({ status: 'active' })]);
		assert.strictEqual(groups.length, 1);
		assert.strictEqual(groups[0].items.length, 1);
	});

	test('describes a session with no branch', () => {
		assert.match(describeSession(makeSession({ branch: undefined })), /no branch/);
	});
});

suite('Entire session detail', () => {
	test('shows the fields of the selected session', () => {
		const detail = new SessionDetailProvider();
		try {
			detail.show(makeSession({ lastPrompt: 'add a test' }));
			const rows = detail.getChildren();

			const labels = rows
				.filter(row => row.kind !== 'line')
				.map(row => (row.kind === 'field' ? row.label : row.label));
			assert.ok(labels.includes('Agent'));
			assert.ok(labels.includes('Status'));
			assert.ok(labels.includes('Branch'));
			assert.ok(labels.includes('Checkpoints'));
			assert.ok(labels.includes('Last prompt'));

			const checkpoints = rows.find(row => row.kind === 'field' && row.label === 'Checkpoints');
			assert.ok(checkpoints);
			assert.strictEqual(checkpoints.kind === 'field' ? checkpoints.value : '', '2');
		} finally {
			detail.dispose();
		}
	});

	test('shows the last prompt as expandable lines', () => {
		const detail = new SessionDetailProvider();
		try {
			detail.show(makeSession({ lastPrompt: 'first\nsecond' }));
			const prompt = detail.getChildren().find(row => row.kind === 'text');
			assert.ok(prompt);
			assert.strictEqual(prompt.kind === 'text' ? prompt.lines.length : 0, 2);
			assert.strictEqual(detail.getChildren(prompt).length, 2);
		} finally {
			detail.dispose();
		}
	});

	test('shows nothing when no session is selected', () => {
		const detail = new SessionDetailProvider();
		try {
			detail.show(undefined);
			assert.deepStrictEqual(detail.getChildren(), []);
		} finally {
			detail.dispose();
		}
	});
});

suite('Entire sessions empty state', () => {
	test('the manifest explains how sessions are recorded', () => {
		const root = path.resolve(__dirname, '..', '..');
		const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
			contributes?: { viewsWelcome?: { view: string; contents: string }[] };
		};

		const welcome = manifest.contributes?.viewsWelcome ?? [];
		const sessions = welcome.find(entry => entry.view === 'entirely.sessions');
		assert.ok(sessions, 'the sessions view has no welcome message');

		assert.match(sessions.contents, /recorded/i);
		assert.match(sessions.contents, /command:entirely\.refresh/);
	});
});
