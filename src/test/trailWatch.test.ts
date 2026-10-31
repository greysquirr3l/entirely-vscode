import * as assert from 'assert';

import { stopAllWatches, stopWatching, watchChange } from '../commands/trailDepth';
import type { CliInvocation, CliInvocationBodies } from '../services/cli';
import { watchKey } from '../services/trailWatch';
import { CHANGE_SELECTOR, changeRow, depthRig, until } from './support/trailDepthHarness';

const KEY = 'entirely-vscode/17';
const READY = '{"event":"ready","trail":"x","cursor":"1"}';
const select = (number: number): { kind: 'change'; repository: string; number: number } => ({ kind: 'change', repository: 'entirely-vscode', number });

/** Counts the timers created by the watch service itself, which are the only ones it may create. */
function watchTimers(): { stop(): { timeouts: number; intervals: number } } {
	let timeouts = 0;
	let intervals = 0;
	const realTimeout = global.setTimeout;
	const realInterval = global.setInterval;
	// The caller of the timer function, not an async frame further down the chain.
	const ours = (): boolean => ((new Error().stack ?? '').split('\n')[3] ?? '').includes('trailWatch.js');
	global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		if (ours()) {
			timeouts += 1;
		}
		return realTimeout(...args);
	}) as typeof setTimeout;
	global.setInterval = ((...args: Parameters<typeof setInterval>) => {
		if (ours()) {
			intervals += 1;
		}
		return realInterval(...args);
	}) as typeof setInterval;
	return {
		stop: () => {
			global.setTimeout = realTimeout;
			global.setInterval = realInterval;
			return { timeouts, intervals };
		},
	};
}

suite('Watching a change', () => {
	test('starts exactly one CLI process, with the JSON flag from the help and never the once flag', async () => {
		const rig = depthRig({ watchLines: [READY] });
		try {
			assert.deepStrictEqual(await rig.watch.start(CHANGE_SELECTOR), { kind: 'started' });
			await until(() => rig.cli.watches().length === 1, 'the process to start');

			const [started] = rig.cli.watches();
			assert.deepStrictEqual(started.args, ['trail', 'watch', KEY, '--json']);
			assert.ok(!started.args.includes('--once'));
			assert.strictEqual(rig.watch.count, 1);
		} finally {
			rig.watch.dispose();
		}
	});

	test('a ready line marks the change as watching, and the row is told', async () => {
		const rig = depthRig({ watchLines: [READY] });
		const told: string[] = [];
		rig.watch.onDidChange(key => told.push(key));
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'starting' });
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			assert.ok(told.includes(KEY));
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'watching', updates: 0 });
			assert.ok(rig.logged.includes(`watching ${KEY}`));
		} finally {
			rig.watch.dispose();
		}
	});

	test('two events within the delay produce one read, an event after it produces another', async () => {
		const rig = depthRig({ watchLines: [READY] }, {}, { delaySeconds: 0.15 });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			rig.cli.emit('{"event":"finding.created"}');
			rig.cli.emit('{"event":"comment.added"}');
			await until(() => rig.refreshed.length === 1, 'the first read');
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.strictEqual(rig.refreshed.length, 1, 'two events, one read');
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'watching', updates: 2 });

			rig.cli.emit('{"event":"finding.updated"}');
			await until(() => rig.refreshed.length === 2, 'the second read');
			assert.deepStrictEqual(rig.refreshed, [KEY, KEY]);
		} finally {
			rig.watch.dispose();
		}
	});

	test('a burst of events during a read produces at most one more', async () => {
		const rig = depthRig({ watchLines: [READY] }, {}, { delaySeconds: 0.05, refreshTakesMs: 400 });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			rig.cli.emit('{"event":"a"}');
			await until(() => rig.refreshed.length === 1, 'the read to begin');
			for (const name of ['b', 'c', 'd', 'e']) {
				rig.cli.emit(`{"event":"${name}"}`);
			}
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching' && (rig.watch.stateOf(KEY) as { updates: number }).updates === 5, 'all five events');
			await until(() => rig.refreshed.length === 2, 'the follow-up read');
			await new Promise(resolve => setTimeout(resolve, 700));
			assert.strictEqual(rig.refreshed.length, 2, 'a burst during a read gives one more read, not four');
		} finally {
			rig.watch.dispose();
		}
	});

	test('pings, reconnects and errors are not reasons to read', async () => {
		const rig = depthRig({ watchLines: [READY, '{"event":"ping"}', '{"event":"reconnect"}', '{"event":"error"}'] }, {}, { delaySeconds: 0.05 });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.deepStrictEqual(rig.refreshed, []);
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'watching', updates: 0 });
		} finally {
			rig.watch.dispose();
		}
	});

	test('an unparseable line counts as an event', async () => {
		const rig = depthRig({ watchLines: [READY, 'garbage that is not json'] }, {}, { delaySeconds: 0.05 });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.refreshed.length === 1, 'a read');
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'watching', updates: 1 });
		} finally {
			rig.watch.dispose();
		}
	});

	test('nothing runs on a timer while no event arrives, and the only timer is the delay, which ends', async () => {
		const timers = watchTimers();
		const rig = depthRig({ watchLines: [READY] }, {}, { delaySeconds: 0.05 });
		let counted = { timeouts: 0, intervals: 0 };
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			await new Promise(resolve => setTimeout(resolve, 200));
			assert.deepStrictEqual(rig.refreshed, []);
			assert.deepStrictEqual({ ...timers.stop() }, { timeouts: 0, intervals: 0 }, 'no timer from the watch while it only waits');
		} finally {
			counted = { ...counted };
			rig.watch.dispose();
		}

		const second = watchTimers();
		const busy = depthRig({ watchLines: [READY] }, {}, { delaySeconds: 0.05 });
		try {
			await busy.watch.start(CHANGE_SELECTOR);
			await until(() => busy.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			busy.cli.emit('{"event":"a"}');
			busy.cli.emit('{"event":"b"}');
			await until(() => busy.refreshed.length === 1, 'a read');
			counted = second.stop();
			assert.strictEqual(counted.intervals, 0, 'never an interval');
			assert.strictEqual(counted.timeouts, 1, 'one delay for two events');
		} finally {
			busy.watch.dispose();
		}
	});

	test('forbidden ends the watch with a message, kills the process, and nothing restarts it', async () => {
		const rig = depthRig({ watchLines: [READY, '{"event":"forbidden"}'] });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.ended.length === 1, 'the watch to end');

			assert.strictEqual(rig.ended[0].key, KEY);
			assert.match(rig.ended[0].reason, /revoked access/);
			assert.deepStrictEqual(rig.watch.stateOf(KEY), { kind: 'ended', reason: rig.ended[0].reason });
			assert.strictEqual(rig.watch.count, 0);
			await until(() => !rig.cli.watchRunning(), 'the process to be gone');
			await new Promise(resolve => setTimeout(resolve, 400));
			assert.strictEqual(rig.cli.watches().length, 1, 'one start, no restart');
			assert.ok(rig.logged.includes('watch ended (forbidden)'));
		} finally {
			rig.watch.dispose();
		}
	});

	test('a project that cannot be found ends the watch with the access message, and nothing restarts it', async () => {
		const rig = depthRig({ watchLines: [], watchExit: 1, watchStderr: 'Error: project not found' });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.ended.length === 1, 'the watch to end');

			assert.match(rig.ended[0].reason, /login Entirely acted as \(ada\) has no access to the project gh\/greysquirr3l/);
			assert.match(rig.ended[0].reason, /web UI/);
			assert.match(rig.ended[0].reason, /GitHub organisation/);
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.strictEqual(rig.cli.watches().length, 1);
		} finally {
			rig.watch.dispose();
		}
	});

	test('an error event that says the project cannot be found ends the watch with the access message', async () => {
		const rig = depthRig({ watchLines: [READY, '{"event":"error","message":"project not found"}'] });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.ended.length === 1, 'the watch to end');
			assert.match(rig.ended[0].reason, /has no access to the project gh\/greysquirr3l/);
			assert.strictEqual(rig.watch.count, 0);
			assert.ok(!rig.logged.join('\n').includes('message'));
		} finally {
			rig.watch.dispose();
		}
	});

	test('an error event that says forbidden ends the watch, and an ordinary error does not', async () => {
		const forbidden = depthRig({ watchLines: [READY, '{"event":"error","message":"forbidden"}'] });
		try {
			await forbidden.watch.start(CHANGE_SELECTOR);
			await until(() => forbidden.ended.length === 1, 'the watch to end');
			assert.match(forbidden.ended[0].reason, /revoked access/);
		} finally {
			forbidden.watch.dispose();
		}
		const ordinary = depthRig({ watchLines: [READY, '{"event":"error","message":"try again"}'] });
		try {
			await ordinary.watch.start(CHANGE_SELECTOR);
			await new Promise(resolve => setTimeout(resolve, 600));
			assert.strictEqual(ordinary.watch.count, 1);
			assert.deepStrictEqual(ordinary.ended, []);
		} finally {
			ordinary.watch.dispose();
		}
	});

	test('a stream that ends cleanly shows the change as not watched, and is not restarted', async () => {
		const rig = depthRig({ watchLines: [READY], watchExit: 0 });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.ended.length === 1, 'the watch to end');
			assert.strictEqual(rig.ended[0].reason, 'the stream ended');
			assert.strictEqual(rig.watch.count, 0);
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.strictEqual(rig.cli.watches().length, 1);
		} finally {
			rig.watch.dispose();
		}
	});

	test('a failing exit says what the CLI said, and does not restart', async () => {
		const rig = depthRig({ watchLines: [], watchExit: 2, watchStderr: 'Error: the server is unreachable' });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.ended.length === 1, 'the watch to end');
			assert.match(rig.ended[0].reason, /the server is unreachable/);
		} finally {
			rig.watch.dispose();
		}
	});

	test('stop and dispose kill the process and are silent', async () => {
		const rig = depthRig({ watchLines: [READY] });
		await rig.watch.start(CHANGE_SELECTOR);
		await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');

		assert.strictEqual(rig.watch.stop(KEY), true);
		await until(() => rig.cli.signals().length === 1, 'the signal');
		assert.deepStrictEqual(rig.cli.signals(), ['SIGTERM']);
		await until(() => !rig.cli.watchRunning(), 'the process to be gone');
		assert.strictEqual(rig.watch.stateOf(KEY), undefined, 'the change shows as not watched');
		assert.strictEqual(rig.watch.stop(KEY), false);
		assert.deepStrictEqual(rig.ended, [], 'a stop by the user is silent');

		await rig.watch.start(select(18));
		await until(() => rig.watch.stateOf('entirely-vscode/18')?.kind === 'watching', 'ready again');
		rig.watch.dispose();
		await until(() => rig.cli.signals().length === 2, 'the second signal');
		await until(() => !rig.cli.watchRunning(), 'the process to be gone');
		assert.deepStrictEqual(rig.ended, []);
		assert.strictEqual(rig.watch.count, 0);
	});

	test('the limit refuses one more watch and starts nothing', async () => {
		const rig = depthRig({ watchLines: [READY] }, {}, { limit: 3 });
		try {
			for (const number of [17, 18, 19]) {
				assert.deepStrictEqual(await rig.watch.start(select(number)), { kind: 'started' });
			}
			assert.deepStrictEqual(await rig.watch.start(select(20)), { kind: 'limit', limit: 3 });
			await until(() => rig.cli.watches().length === 3, 'three starts');
			await new Promise(resolve => setTimeout(resolve, 200));
			assert.strictEqual(rig.cli.watches().length, 3);
			assert.deepStrictEqual(await rig.watch.start(select(18)), { kind: 'already' });
		} finally {
			rig.watch.dispose();
		}
	});

	test('event payload text never reaches the output channel or the records', async () => {
		const rig = depthRig({ watchLines: [READY, '{"event":"comment.added","body":"a very private review comment"}'] }, {}, { delaySeconds: 0.05 });
		const records: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
		rig.cli.runner.setSink({ report: (invocation, bodies) => records.push({ invocation, bodies }) });
		try {
			await rig.watch.start(CHANGE_SELECTOR);
			await until(() => rig.refreshed.length === 1, 'a read');
			assert.ok(!JSON.stringify(records).includes('private review comment'));
			assert.ok(!rig.logged.join('\n').includes('private review comment'));
			assert.ok(!JSON.stringify(rig.watch.stateOf(KEY)).includes('private review comment'));
		} finally {
			rig.watch.dispose();
		}
	});

	test('a CLI without trail watch says so, and starts nothing', async () => {
		const rig = depthRig({ without: ['trail watch'] });
		const started = await rig.watch.start(CHANGE_SELECTOR);

		assert.strictEqual(started.kind, 'unavailable');
		assert.match((started as { detail: string }).detail, /no 'trail watch' command; update the CLI/);
		assert.deepStrictEqual(rig.cli.watches(), []);
		assert.strictEqual(rig.watch.count, 0);
	});

	test('after dispose nothing can be started', async () => {
		const rig = depthRig({ watchLines: [READY] });
		rig.watch.dispose();
		assert.strictEqual((await rig.watch.start(CHANGE_SELECTOR)).kind, 'unavailable');
		assert.deepStrictEqual(rig.cli.watches(), []);
	});

	test('the key of a change is the selector as the CLI writes it', () => {
		assert.strictEqual(watchKey(CHANGE_SELECTOR), KEY);
	});
});

suite('Watching from the commands', () => {
	test('watch and stop work from a row, and the palette stop offers the running watches', async () => {
		const rig = depthRig({ watchLines: [READY] }, { choices: [KEY] });
		try {
			assert.strictEqual(await watchChange(rig.deps, changeRow()), 'done');
			await until(() => rig.watch.stateOf(KEY)?.kind === 'watching', 'ready');
			assert.strictEqual(await watchChange(rig.deps, changeRow()), 'cancelled');
			assert.match(rig.ui.notices.at(-1)?.message ?? '', /already watching/);

			assert.strictEqual(await stopWatching(rig.deps, changeRow()), 'done');
			assert.strictEqual(rig.watch.count, 0);

			await watchChange(rig.deps, changeRow());
			await until(() => rig.watch.count === 1, 'a watch');
			assert.strictEqual(await stopWatching(rig.deps, undefined), 'done', 'the palette offers the one running');
			assert.strictEqual(rig.watch.count, 0);
			assert.strictEqual(stopAllWatches(rig.deps), 'cancelled');
			assert.match(rig.ui.notices.at(-1)?.message ?? '', /not watching any change/);
		} finally {
			rig.watch.dispose();
		}
	});

	test('stop all stops every watch', async () => {
		const rig = depthRig({ watchLines: [READY] });
		try {
			await rig.watch.start(select(17));
			await rig.watch.start(select(18));
			assert.strictEqual(stopAllWatches(rig.deps), 'done');
			assert.strictEqual(rig.watch.count, 0);
		} finally {
			rig.watch.dispose();
		}
	});

	test('the limit is explained and names the setting', async () => {
		const rig = depthRig({ watchLines: [READY] }, {}, { limit: 1 });
		try {
			await rig.watch.start(select(18));
			assert.strictEqual(await watchChange(rig.deps, changeRow()), 'failed');
			assert.match(rig.ui.notices[0].message, /Stop another watch first, or raise entirely\.trailWatchLimit/);
		} finally {
			rig.watch.dispose();
		}
	});
});
