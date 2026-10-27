import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	checkpointRef,
	decodeCheckpoint,
	decodeCheckpointDetail,
	decodeCheckpointList,
} from '../lib/entire';
import {
	CheckpointsProvider,
	describeCheckpoint,
	type CheckpointFileNode,
} from '../providers/checkpointsProvider';

/** A checkpoint as the CLI lists it. */
const CHECKPOINT = {
	checkpoint_id: 'abc123def456',
	session_id: 'session-1',
	agent: 'Copilot CLI',
	date: '2026-10-26T23:34:45Z',
	message: 'add a test',
	session_count: 1,
	session_ids: ['session-1'],
};

suite('Entire checkpoint decoding', () => {
	test('decodes a checkpoint from the list', () => {
		const decoded = decodeCheckpoint(CHECKPOINT);
		assert.ok(decoded.ok);

		assert.strictEqual(decoded.value.id, 'abc123def456');
		assert.strictEqual(decoded.value.message, 'add a test');
		assert.strictEqual(decoded.value.agent, 'Copilot CLI');
		assert.strictEqual(decoded.value.date?.raw, '2026-10-26T23:34:45Z');
		assert.strictEqual(decoded.value.sessionCount, 1);
		assert.deepStrictEqual(decoded.value.sessionIds, ['session-1']);
	});

	test('decodes a checkpoint with only the fields the CLI always sends', () => {
		const decoded = decodeCheckpoint({
			checkpoint_id: 'abc123def456',
			date: '2026-10-26T23:34:45Z',
		});

		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.message, undefined);
		assert.strictEqual(decoded.value.agent, undefined);
		assert.strictEqual(decoded.value.sessionCount, 0);
	});

	test('rejects a checkpoint with no id', () => {
		const decoded = decodeCheckpoint({ date: '2026-10-26T23:34:45Z' });
		assert.strictEqual(decoded.ok, false);
	});

	test('decodes the list', () => {
		const decoded = decodeCheckpointList([CHECKPOINT]);
		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.length, 1);
	});

	test('decodes an empty list', () => {
		const decoded = decodeCheckpointList([]);
		assert.ok(decoded.ok);
		assert.deepStrictEqual(decoded.value, []);
	});

	test('rejects a list that is not a list', () => {
		const decoded = decodeCheckpointList({ checkpoints: [] });
		assert.strictEqual(decoded.ok, false);
	});

	test('decodes the envelope with the files it touched', () => {
		const decoded = decodeCheckpointDetail({
			checkpoint_id: 'abc123def456',
			strategy: 'git-refs',
			branch: 'main',
			checkpoints_count: 1,
			files_touched: ['src/index.ts', 'README.md'],
			session_count: 1,
			sessions: [
				{
					index: 0,
					session_id: 'session-1',
					agent: 'Copilot CLI',
					files_touched: ['src/index.ts'],
				},
			],
		});

		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.id, 'abc123def456');
		assert.deepStrictEqual(decoded.value.filesTouched, ['src/index.ts', 'README.md']);
		assert.strictEqual(decoded.value.sessions.length, 1);
		assert.deepStrictEqual(decoded.value.sessions[0].filesTouched, ['src/index.ts']);
	});

	test('decodes an envelope with no sessions', () => {
		const decoded = decodeCheckpointDetail({
			checkpoint_id: 'abc123def456',
			checkpoints_count: 0,
			session_count: 0,
			sessions: [],
		});

		assert.ok(decoded.ok);
		assert.deepStrictEqual(decoded.value.filesTouched, []);
	});

	test('names the ref a checkpoint is stored under', () => {
		assert.strictEqual(
			checkpointRef('abc123def456'),
			'refs/entire/checkpoints/56/abc123def456',
		);
	});
});

suite('Entire checkpoints tree', () => {
	test('lists the checkpoints the source reports', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow(CHECKPOINT)] }),
			async () => undefined,
			() => 0,
		);

		try {
			await provider.refresh();
			const nodes = provider.getChildren();
			assert.strictEqual(nodes.length, 1);
			assert.strictEqual(nodes[0].kind, 'checkpoint');
		} finally {
			provider.dispose();
		}
	});

	test('shows the message, agent and time on a checkpoint item', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow(CHECKPOINT)] }),
			async () => undefined,
			() => 0,
		);

		try {
			await provider.refresh();
			const item = provider.getTreeItem(provider.getChildren()[0]);

			assert.strictEqual(item.label, 'add a test');
			assert.match(String(item.description), /Copilot CLI/);
			assert.match(String(item.description), /2026-10-26T23:34:45Z/);
			assert.match(String(item.description), /1 session/);
		} finally {
			provider.dispose();
		}
	});

	test('falls back to the id when a checkpoint has no message', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow({ ...CHECKPOINT, message: undefined })] }),
			async () => undefined,
			() => 0,
		);

		try {
			await provider.refresh();
			const item = provider.getTreeItem(provider.getChildren()[0]);
			assert.strictEqual(item.label, 'abc123def456');
		} finally {
			provider.dispose();
		}
	});

	test('shows the files a checkpoint touched', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow(CHECKPOINT)] }),
			async id => ({
				id,
				filesTouched: ['src/index.ts', 'README.md'],
				sessionCount: 1,
				sessions: [],
				partial: false,
			}),
			() => 0,
		);

		try {
			await provider.refresh();
			const checkpoint = provider.getChildren()[0];

			// The first read asks for the detail; the tree fills in when it
			// arrives.
			assert.deepStrictEqual(provider.getChildren(checkpoint), []);

			await waitFor(() => provider.getChildren(checkpoint).length > 0);

			const files = provider.getChildren(checkpoint);
			assert.strictEqual(files.length, 2);
			assert.strictEqual(files[0].kind, 'file');
			assert.strictEqual(files[0].kind === 'file' ? files[0].path : '', 'src/index.ts');
		} finally {
			provider.dispose();
		}
	});

	test('reports the parent of a file', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow(CHECKPOINT)] }),
			async id => ({
				id,
				filesTouched: ['src/index.ts'],
				sessionCount: 1,
				sessions: [],
				partial: false,
			}),
			() => 0,
		);

		try {
			await provider.refresh();
			const checkpoint = provider.getChildren()[0];
			await waitFor(() => provider.getChildren(checkpoint).length > 0);

			const file = provider.getChildren(checkpoint)[0];
			const parent = provider.getParent(file);

			assert.ok(parent);
			assert.strictEqual(parent.kind, 'checkpoint');
			assert.strictEqual(parent.kind === 'checkpoint' ? parent.checkpoint.id : '', 'abc123def456');
		} finally {
			provider.dispose();
		}
	});

	test('asks for a checkpoint detail only once', async () => {
		let calls = 0;
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decodeOrThrow(CHECKPOINT)] }),
			async id => {
				calls++;
				return undefined;
			},
			() => 0,
		);

		try {
			await provider.refresh();
			const checkpoint = provider.getChildren()[0];

			provider.getChildren(checkpoint);
			await waitFor(() => calls > 0);
			provider.getChildren(checkpoint);
			await new Promise(resolve => setTimeout(resolve, 20));

			assert.strictEqual(calls, 1);
		} finally {
			provider.dispose();
		}
	});

	test('shows an empty tree when there are no checkpoints', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [] }),
			async () => undefined,
			() => 0,
		);

		try {
			await provider.refresh();
			assert.deepStrictEqual(provider.getChildren(), []);
		} finally {
			provider.dispose();
		}
	});

	test('explains why the tree is empty when the source says so', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [], emptyReason: 'the CLI is not installed' }),
			async () => undefined,
			() => 0,
		);

		try {
			await provider.refresh();
			assert.strictEqual(provider.emptyReason, 'the CLI is not installed');
		} finally {
			provider.dispose();
		}
	});

	test('describes a checkpoint with no agent', () => {
		assert.match(describeCheckpoint(decodeOrThrow({ ...CHECKPOINT, agent: undefined })), /2026/);
	});
});

suite('Entire checkpoints empty state', () => {
	test('the manifest explains how checkpoints get recorded', () => {
		const root = path.resolve(__dirname, '..', '..');
		const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
			contributes?: { viewsWelcome?: { view: string; contents: string }[] };
		};

		const welcome = manifest.contributes?.viewsWelcome ?? [];
		const checkpoints = welcome.find(entry => entry.view === 'entirely.checkpoints');
		assert.ok(checkpoints, 'the checkpoints view has no welcome message');
		assert.match(checkpoints.contents, /recorded|committed/i);
	});
});

/** Waits for a condition to hold, or fails the test. */
async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
	const deadline = Date.now() + timeout;

	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error('timed out waiting for the tree to fill in');
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

/** Decodes a checkpoint, failing the test if the shape is wrong. */
function decodeOrThrow(value: unknown) {
	const decoded = decodeCheckpoint(value);
	assert.ok(decoded.ok, 'the test fixture is not a valid checkpoint');
	return decoded.value;
}
