import * as assert from 'assert';

import {
	ACTIVITY_WANTS,
	RECAP_WANTS,
	activityArguments,
	countEntries,
	describeHelpFailure,
	isJurisdictionSlug,
	isTimeWindow,
	parseActivity,
	readCommandFlags,
	readDefaultValue,
	recapArguments,
	recapPeriods,
	staticEnvironment,
	stripTerminalCodes,
	withSignInHint,
} from '../lib/entire';
import { ActivityProvider, buildActivityNodes } from '../providers/activityProvider';
import { ActivityService, type ActivityOutcome, type ActivitySource } from '../services/activity';
import { clampActivityTimeout, clampDispatchTimeout } from '../services/configuration';
import { COMMITS_OUTPUT, ACTIVITY_HELPS, SESSIONS_OUTPUT, fakeActivityCli } from './support/activityCli';

suite('Entire activity output', () => {
	test('reads the headline figures, repositories and the recent commits from the static text', () => {
		const reading = parseActivity(COMMITS_OUTPUT, 'commits');
		assert.strictEqual(reading.kind, 'overview');
		if (reading.kind !== 'overview') {
			return;
		}
		const { overview } = reading;
		assert.deepStrictEqual(
			overview.stats.map(stat => [stat.label, stat.value]),
			[
				['THROUGHPUT', '0.0k'],
				['ITERATION', '1.0x'],
				['CONTINUITY', '0.1h'],
				['STREAK', '1 day'],
			],
		);
		assert.strictEqual(overview.contributions, '2 checkpoints');
		assert.deepStrictEqual(overview.repositories, [
			{ name: 'acme/widgets', count: 2 },
			{ name: 'acme/tools', count: 1 },
		]);
		assert.deepStrictEqual(
			overview.groups.map(group => [group.heading, group.entries.length]),
			[
				['Thursday 29 Oct (today)  2 commits', 2],
				['Wednesday 28 Oct (yesterday)  1 commit', 1],
			],
		);
		const first = overview.groups[0].entries[0];
		assert.strictEqual(first.id, '27930eb');
		assert.strictEqual(first.title, 'docs: d...');
		assert.strictEqual(first.repo, 'acme/widgets');
		assert.strictEqual(first.detail, 'Unknown  +27 / -1  1 file  1 checkpoint');
		assert.strictEqual(overview.groups[1].entries[0].detail, '+1619 / -26  20 files');
		assert.strictEqual(countEntries(overview), 3);
	});

	test('keeps session lines that have no heading as they were printed', () => {
		const reading = parseActivity(SESSIONS_OUTPUT, 'sessions');
		assert.strictEqual(reading.kind, 'overview');
		if (reading.kind !== 'overview') {
			return;
		}
		assert.strictEqual(reading.overview.groups.length, 1);
		assert.strictEqual(reading.overview.groups[0].heading, undefined);
		assert.deepStrictEqual(
			reading.overview.groups[0].entries.map(entry => entry.text),
			['Fix the retry loop  acme/widgets  Copilot', 'Add backoff to the client  acme/widgets  Codex'],
		);
	});

	test('reports no output as empty and an unknown layout as unreadable with its first line', () => {
		assert.deepStrictEqual(parseActivity('\n  \n', 'sessions'), { kind: 'empty' });
		const reading = parseActivity('Something else entirely\nmore', 'sessions');
		assert.deepStrictEqual(reading, { kind: 'unreadable', detail: 'Something else entirely' });
	});

	test('a heading with no entries still lists as an overview with nothing recent', () => {
		const reading = parseActivity('REPOSITORIES\nacme/widgets ▓▓ 2\n', 'sessions');
		assert.strictEqual(reading.kind, 'overview');
		if (reading.kind === 'overview') {
			assert.strictEqual(countEntries(reading.overview), 0);
		}
	});

	test('takes terminal colour codes out before reading', () => {
		const coloured = '\u001b[1mREPOSITORIES\u001b[0m\r\nacme/widgets ▓▓ 2\r\n';
		assert.strictEqual(stripTerminalCodes(coloured), 'REPOSITORIES\nacme/widgets ▓▓ 2\n');
		const reading = parseActivity(coloured, 'sessions');
		assert.strictEqual(reading.kind, 'overview');
	});
});

suite('Entire activity flags', () => {
	test('asks for static output through the environment and keeps the rest of it', () => {
		const env = staticEnvironment({ PATH: '/bin' });
		assert.strictEqual(env.ACCESSIBLE, '1');
		assert.strictEqual(env.PATH, '/bin');
	});

	test('picks the commit flag from the help line and refuses commits without one', () => {
		const picked = readCommandFlags('activity', ACTIVITY_HELPS.activity, [], ACTIVITY_WANTS);
		assert.ok(picked.ok);
		if (!picked.ok) {
			return;
		}
		assert.strictEqual(picked.currentRepo, 'gh/acme/widgets');
		assert.deepStrictEqual(activityArguments(picked.flags.commits, 'commits'), ['activity', '--commits']);
		assert.deepStrictEqual(activityArguments(picked.flags.commits, 'sessions'), ['activity']);
		assert.strictEqual(activityArguments(undefined, 'commits'), undefined);
	});

	test('follows a renamed commit flag', () => {
		const picked = readCommandFlags('activity', 'Flags:\n      --with-commits   List the commits, not the sessions\n', [], ACTIVITY_WANTS);
		assert.ok(picked.ok && picked.flags.commits === '--with-commits');
	});

	test('reads the recap periods from the help and uses the static flag', () => {
		const help = `Flags:
      --90        Rolling 90 days
      --color string   Color output: auto, always, or never (default "auto")
      --day       Today only (default)
      --month     This calendar month
      --static    Print static output instead of opening the interactive recap
      --week      Last 7 days
`;
		const picked = readCommandFlags('recap', help, [], RECAP_WANTS);
		assert.ok(picked.ok);
		if (!picked.ok) {
			return;
		}
		const periods = recapPeriods(picked.table, picked.flags);
		assert.deepStrictEqual(
			periods.map(period => [period.label, period.flag]),
			[
				['Today only', '--day'],
				['Last 7 days', '--week'],
				['This calendar month', '--month'],
				['Rolling 90 days', '--90'],
			],
		);
		assert.deepStrictEqual(recapArguments(picked.flags, picked.table, periods[1]), ['recap', '--static', '--color=never', '--week']);
		assert.deepStrictEqual(recapArguments(picked.flags, picked.table, undefined), ['recap', '--static', '--color=never']);
	});

	test('does not build a recap without a static flag, and leaves colour alone when never is not offered', () => {
		const none = readCommandFlags('recap', 'Flags:\n      --week   Last 7 days\n', [], RECAP_WANTS);
		assert.ok(!none.ok);
		const noNever = readCommandFlags(
			'recap',
			'Flags:\n      --static   Print static output\n      --color string   Colour: auto or always\n',
			[],
			RECAP_WANTS,
		);
		assert.ok(noNever.ok);
		if (noNever.ok) {
			assert.deepStrictEqual(recapArguments(noNever.flags, noNever.table, undefined), ['recap', '--static']);
		}
	});

	test('reads defaults and validates values that go on the command line', () => {
		assert.strictEqual(readDefaultValue('time window (Go duration) (default "7d")'), '7d');
		assert.strictEqual(readDefaultValue('no default here'), undefined);
		assert.ok(isTimeWindow('7d'));
		assert.ok(isTimeWindow('2 weeks ago'));
		assert.ok(isTimeWindow('2026-10-01'));
		assert.ok(isTimeWindow('2026-10-01T10:00:00+02:00'));
		assert.ok(!isTimeWindow('--all'));
		assert.ok(!isTimeWindow('7d; rm'));
		assert.ok(!isTimeWindow(''));
		assert.ok(isJurisdictionSlug('us'));
		assert.ok(isJurisdictionSlug('eu-west'));
		assert.ok(!isJurisdictionSlug('-us'));
		assert.ok(!isJurisdictionSlug('u s'));
	});

	test('says what is missing when the CLI or the command is', () => {
		assert.match(describeHelpFailure('activity', 'see your activity', 'absent', ''), /not installed/);
		assert.strictEqual(describeHelpFailure('activity', 'x', 'broken', 'it is broken'), 'it is broken');
		assert.match(describeHelpFailure('activity', 'x', 'exit-code', ''), /no 'activity' command/);
	});

	test('adds the way to sign in only to a failure about a login', () => {
		assert.match(withSignInHint('you are not logged in'), /Sign In to Entire/);
		assert.match(withSignInHint('401 Unauthorized'), /Sign In to Entire/);
		assert.strictEqual(withSignInHint('the server is down'), 'the server is down');
	});

	test('bounds the activity and dispatch timeouts', () => {
		assert.strictEqual(clampActivityTimeout(30), 30);
		assert.strictEqual(clampActivityTimeout(1), 5);
		assert.strictEqual(clampActivityTimeout(9999), 300);
		assert.strictEqual(clampActivityTimeout(Number.NaN), 30);
		assert.strictEqual(clampDispatchTimeout(180), 180);
		assert.strictEqual(clampDispatchTimeout(1), 10);
		assert.strictEqual(clampDispatchTimeout(99999), 1800);
		assert.strictEqual(clampDispatchTimeout(Number.NaN), 180);
	});
});

function serviceFor(cli: ReturnType<typeof fakeActivityCli>): ActivityService {
	return new ActivityService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20 });
}

suite('Entire activity service', () => {
	test('populates the activity view from the static output and never from the interactive screen', async () => {
		const cli = fakeActivityCli();
		const outcome = await serviceFor(cli).read('sessions');
		assert.strictEqual(outcome.kind, 'found');
		const calls = cli.callsTo('activity');
		assert.strictEqual(calls.length, 1);
		// The fake prints its interactive screen and fails unless static output was requested.
		assert.strictEqual(calls[0], 'none|ACCESSIBLE=1|activity');
	});

	test('lists recent commits with the flag the help describes', async () => {
		const cli = fakeActivityCli();
		const outcome = await serviceFor(cli).read('commits');
		assert.strictEqual(outcome.kind, 'found');
		if (outcome.kind === 'found') {
			assert.strictEqual(countEntries(outcome.overview), 3);
		}
		assert.strictEqual(cli.callsTo('activity')[0], 'none|ACCESSIBLE=1|activity --commits');
	});

	test('follows a renamed commit flag, and refuses commits when the help has none', async () => {
		const renamed = fakeActivityCli({ helps: { activity: 'Flags:\n      --with-commits   List the commits, not the sessions\n' } });
		assert.strictEqual((await serviceFor(renamed).read('commits')).kind, 'found');
		assert.strictEqual(renamed.callsTo('activity')[0], 'none|ACCESSIBLE=1|activity --with-commits');

		const none = fakeActivityCli({ helps: { activity: 'Flags:\n      --other   Something else\n' } });
		const outcome = await serviceFor(none).read('commits');
		assert.strictEqual(outcome.kind, 'failed');
		assert.strictEqual(none.callsTo('activity').length, 0);
	});

	test('says the CLI is missing, or lacks the command, instead of failing obscurely', async () => {
		const missing = fakeActivityCli({ noCli: true });
		const absent = await serviceFor(missing).read('sessions');
		assert.ok(absent.kind === 'failed' && /not installed/.test(absent.detail));

		const old = fakeActivityCli({ helps: { activity: null } });
		const lacking = await serviceFor(old).read('sessions');
		assert.ok(lacking.kind === 'failed' && /no 'activity' command/.test(lacking.detail));
	});

	test('reports a failure with a way to sign in, and an unreadable layout as unreadable', async () => {
		const loggedOut = fakeActivityCli({ fail: { activity: 'not logged in' } });
		const failed = await serviceFor(loggedOut).read('sessions');
		assert.ok(failed.kind === 'failed' && /not logged in/.test(failed.detail) && /Sign In to Entire/.test(failed.detail));

		const odd = fakeActivityCli({ activity: 'A new layout\n' });
		assert.deepStrictEqual(await serviceFor(odd).read('sessions'), { kind: 'unreadable', detail: 'A new layout' });

		const empty = fakeActivityCli({ activity: '' });
		assert.deepStrictEqual(await serviceFor(empty).read('sessions'), { kind: 'empty' });
	});

	test('keeps the account activity out of the invocation record', async () => {
		const cli = fakeActivityCli();
		await serviceFor(cli).read('commits');
		const run = cli.recorded.find(entry => entry.invocation.args.includes('activity') && !entry.invocation.args.includes('agent-help'));
		assert.ok(run);
		assert.strictEqual(run.bodies.stdout, undefined);
	});
});

class ScriptedSource implements ActivitySource {
	readonly asked: string[] = [];
	private readonly waiting: ((outcome: ActivityOutcome) => void)[] = [];

	constructor(private readonly immediate?: ActivityOutcome) {}

	read(listing: 'sessions' | 'commits'): Promise<ActivityOutcome> {
		this.asked.push(listing);
		if (this.immediate) {
			return Promise.resolve(this.immediate);
		}
		return new Promise(resolve => this.waiting.push(resolve));
	}

	answer(outcome: ActivityOutcome): void {
		this.waiting.shift()?.(outcome);
	}
}

suite('Entire activity view', () => {
	test('lists the repositories and recent sessions and commits under the acting login', async () => {
		const parsed = parseActivity(COMMITS_OUTPUT, 'commits');
		assert.strictEqual(parsed.kind, 'overview');
		if (parsed.kind !== 'overview') {
			return;
		}
		const source = new ScriptedSource({ kind: 'found', overview: parsed.overview });
		const view = new ActivityProvider(source, () => 'alice');
		try {
			assert.deepStrictEqual(view.getChildren(), [], 'the first read is under way');
			await view.show('commits');
			const nodes = view.getChildren();
			assert.deepStrictEqual(source.asked, ['sessions', 'commits']);
			const scope = nodes[0];
			assert.ok(scope.kind === 'scope' && scope.text === 'Activity for alice' && /recent commits/.test(scope.summary));
			const labels = nodes.map(node => (node.kind === 'group' ? node.label : node.kind));
			assert.deepStrictEqual(labels, ['scope', 'Overview', 'Repositories (2)', 'Thursday 29 Oct (today)  2 commits', 'Wednesday 28 Oct (yesterday)  1 commit']);
			const today = nodes[3];
			assert.ok(today.kind === 'group');
			const row = view.getChildren(today)[0];
			assert.ok(row.kind === 'line' && row.label === 'docs: d...' && row.description === '27930eb · acme/widgets · Unknown  +27 / -1  1 file  1 checkpoint');
			assert.strictEqual(view.viewMessage, undefined);
		} finally {
			view.dispose();
		}
	});

	test('shows session lines as they were printed', () => {
		const parsed = parseActivity(SESSIONS_OUTPUT, 'sessions');
		assert.ok(parsed.kind === 'overview');
		const nodes = buildActivityNodes(parsed.overview, undefined);
		assert.ok(nodes[0].kind === 'scope' && /active Entire login/.test(nodes[0].text));
		const sessions = nodes.find(node => node.kind === 'group' && node.label === 'Sessions (2)');
		assert.ok(sessions && sessions.kind === 'group');
		assert.strictEqual(sessions.items.length, 2);
	});

	test('says so when there is nothing recent', () => {
		const nodes = buildActivityNodes({ listing: 'commits', stats: [], repositories: [], groups: [] }, 'alice');
		assert.ok(nodes.some(node => node.kind === 'scope' && node.text === 'No recent commits.'));
	});

	test('puts a failure in the view message instead of an empty tree', async () => {
		const view = new ActivityProvider(new ScriptedSource({ kind: 'failed', detail: 'the Entire CLI is not installed' }), () => undefined);
		try {
			await view.refresh();
			assert.match(view.viewMessage ?? '', /could not be read: the Entire CLI is not installed/);
			assert.deepStrictEqual(view.getChildren(), []);
		} finally {
			view.dispose();
		}
	});

	test('says when the layout is not recognised', async () => {
		const view = new ActivityProvider(new ScriptedSource({ kind: 'unreadable', detail: 'A new layout' }), () => undefined);
		try {
			await view.refresh();
			assert.match(view.viewMessage ?? '', /does not recognise.*A new layout/);
		} finally {
			view.dispose();
		}
	});

	test('drops the answer to a read that has since been replaced', async () => {
		const source = new ScriptedSource();
		const view = new ActivityProvider(source, () => undefined);
		try {
			const first = view.show('sessions');
			const second = view.show('commits');
			source.answer({ kind: 'failed', detail: 'old answer' });
			source.answer({ kind: 'empty' });
			await Promise.all([first, second]);
			assert.match(view.viewMessage ?? '', /printed no activity/);
		} finally {
			view.dispose();
		}
	});

	test('reloads only a view that has been read', async () => {
		const source = new ScriptedSource({ kind: 'empty' });
		const view = new ActivityProvider(source, () => undefined);
		try {
			await view.reloadIfRead();
			assert.deepStrictEqual(source.asked, []);
			await view.refresh();
			await view.reloadIfRead();
			assert.strictEqual(source.asked.length, 2);
		} finally {
			view.dispose();
		}
	});
});

