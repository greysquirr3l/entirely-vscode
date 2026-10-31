import * as assert from 'assert';

import {
	EMPTY_PROFILE_TEXT,
	PROFILE_WANTS,
	decodeTokenProfile,
	describeProfile,
	findCheckpointLinks,
	isEmptyProfile,
	pickFlags,
	profileArguments,
	type ProfileFlags,
	type ProfileScope,
	type TokenProfile,
} from '../lib/entire';
import { showTokenProfile, type TokenProfileUi } from '../commands/tokenProfile';
import type { GeneratedKind } from '../providers/generatedDocuments';
import {
	DEFAULT_TOKEN_PROFILE_CHECKPOINTS,
	MAX_TOKEN_PROFILE_CHECKPOINTS,
	MAX_TOKEN_PROFILE_TIMEOUT_SECONDS,
	MIN_TOKEN_PROFILE_CHECKPOINTS,
	MIN_TOKEN_PROFILE_TIMEOUT_SECONDS,
	clampTokenProfileCheckpoints,
	clampTokenProfileTimeout,
} from '../services/configuration';
import { TokenProfileService } from '../services/tokenProfile';
import { PROFILE_CHECKPOINT_IDS, TOKENS_PROFILE_HELP, TOKEN_PROFILE_JSON } from './support/analysisFixtures';
import { fakeAnalysisCli, type FakeAnalysisCli, type FakeAnalysisOptions } from './support/analysisCli';

const FLAGS: ProfileFlags = { json: '--json', all: '--all', limit: '--limit' };

function observed(): TokenProfile {
	const decoded = decodeTokenProfile(JSON.parse(TOKEN_PROFILE_JSON));
	assert.ok(decoded.ok);
	return decoded.value;
}

function without(path: string[]): unknown {
	const copy = JSON.parse(TOKEN_PROFILE_JSON) as Record<string, unknown>;
	let node: Record<string, unknown> = copy;
	for (const key of path.slice(0, -1)) {
		node = node[key] as Record<string, unknown>;
	}
	delete node[path[path.length - 1]];
	return copy;
}

suite('Token profile: decoding the CLI JSON', () => {
	test('reads the profile the real CLI printed', () => {
		const profile = observed();
		assert.strictEqual(profile.checkpointsAvailable, 69);
		assert.strictEqual(profile.checkpointsAnalyzed, 50);
		assert.strictEqual(profile.missingTokenData, 2);
		assert.deepStrictEqual(profile.usage, {
			total: 372774662,
			input: 910,
			output: 310278,
			cacheRead: 160535969,
			cacheWrite: 2715373,
			apiCalls: 627,
			subagentTokens: 209212132,
			subagentTokensComplete: undefined,
		});
		assert.strictEqual(profile.signals.length, 4);
		assert.strictEqual(profile.signals[0].label, 'Cache/context replay hotspot');
		assert.strictEqual(profile.signals[0].percent, 70);
		assert.strictEqual(profile.recommendations[0].severity, 'high');
		assert.strictEqual(profile.limitations.length, 4);
	});

	test('a count the CLI left out stays undefined and is not read as zero', () => {
		const decoded = decodeTokenProfile(without(['tokens', 'cache_read']));
		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.usage?.cacheRead, undefined);
		assert.strictEqual(decoded.value.usage?.input, 910);
	});

	test('refuses a payload that is not an object, and skips an entry it cannot read', () => {
		assert.ok(!decodeTokenProfile([1, 2]).ok);
		assert.ok(!decodeTokenProfile('text').ok);
		const decoded = decodeTokenProfile({ checkpoints_analyzed: 1, signals: [7, { label: 'ok' }], recommendations: [{ id: 'x' }] });
		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.signals.length, 1);
		assert.strictEqual(decoded.value.recommendations.length, 0);
	});

	test('tells an empty history from a profile, by the analysed count or by the absence of any data', () => {
		assert.ok(isEmptyProfile({ ...observed(), checkpointsAnalyzed: 0 }));
		assert.ok(!isEmptyProfile(observed()));
		const bare = decodeTokenProfile({});
		assert.ok(bare.ok && isEmptyProfile(bare.value));
		const withTokens = decodeTokenProfile({ tokens: { total: 5 } });
		assert.ok(withTokens.ok && !isEmptyProfile(withTokens.value));
	});
});

suite('Token profile: the document', () => {
	test('shows the totals, signals, recommendations and limitations in the CLI words', () => {
		const text = describeProfile(observed(), 'the latest 50 committed checkpoints');
		assert.match(text, /\| Total \| 372,774,662 \|/);
		assert.match(text, /\| Subagents \| 209,212,132 \|/);
		assert.match(text, /### Cache\/context replay hotspot \(35 of 50 checkpoints, 70%\)/);
		assert.match(text, /\*\*high\*\*: Use `entire search` for prior decisions\/checkpoints before broad re-investigation\./);
		assert.ok(text.includes('Token totals are summed from analyzed checkpoints and may include overlapping checkpoint history; treat them as checkpoint-observed volume, not guaranteed unique session spend.'));
		assert.ok(text.includes('Tool-level search/read spend is not captured yet;'));
		assert.match(text, /the latest 50 committed checkpoints/);
	});

	test('a missing count says not reported and never shows zero', () => {
		const text = describeProfile(
			{ ...observed(), usage: { total: 10, input: 4, output: 6 } },
			'x',
		);
		assert.match(text, /\| Cache read \| Not reported \|/);
		assert.match(text, /\| Cache write \| Not reported \|/);
		assert.match(text, /\| Subagents \| Not reported \|/);
		assert.match(text, /\| API calls \| Not reported \|/);
		assert.ok(!/\| (?:Cache read|Cache write|Subagents|API calls) \| 0 \|/.test(text));
		const none = describeProfile({ ...observed(), usage: undefined, checkpointsWithTokenData: undefined }, 'x');
		assert.match(none, /\| Total \| Not reported \|/);
		assert.match(none, /With token data: Not reported/);
	});

	test('makes a signal checkpoint id a link to the checkpoint and leaves other text alone', () => {
		const profile = observed();
		const text = describeProfile(
			{ ...profile, signals: [{ id: 's', label: 'Odd', checkpointIds: [PROFILE_CHECKPOINT_IDS[0], 'not an id](command:workbench.action.quit)'] }] },
			'x',
		);
		const links = findCheckpointLinks(text);
		assert.deepStrictEqual(links.map(link => link.id), [PROFILE_CHECKPOINT_IDS[0]]);
		assert.ok(text.includes('command:entirely.explainCheckpoint?'));
		assert.ok(!text.includes('](command:workbench'), 'an id the CLI could not have issued is not a link');
	});

	test('produces no money figure', () => {
		const text = describeProfile(observed(), 'x');
		assert.ok(!/[$€£]|\bUSD\b|\bdollars?\b|\bprice\b/i.test(text));
	});

	test('the checkpoint link finder only follows the one command with a valid id', () => {
		const good = `[${PROFILE_CHECKPOINT_IDS[1]}](command:entirely.explainCheckpoint?${encodeURIComponent(JSON.stringify([PROFILE_CHECKPOINT_IDS[1]]))})`;
		const otherCommand = `[x](command:workbench.action.quit?${encodeURIComponent(JSON.stringify([PROFILE_CHECKPOINT_IDS[1]]))})`;
		const badId = `[x](command:entirely.explainCheckpoint?${encodeURIComponent(JSON.stringify(['../etc']))})`;
		const twoArgs = `[x](command:entirely.explainCheckpoint?${encodeURIComponent(JSON.stringify([PROFILE_CHECKPOINT_IDS[1], 'y']))})`;
		const spans = findCheckpointLinks(`${good}\n${otherCommand}\n${badId}\n${twoArgs}\n[y](command:entirely.explainCheckpoint?%)`);
		assert.strictEqual(spans.length, 1);
		assert.strictEqual(spans[0].id, PROFILE_CHECKPOINT_IDS[1]);
	});
});

suite('Token profile: arguments come from the help', () => {
	test('picks the json, all and maximum flags from the real help', () => {
		const picked = pickFlags('tokens profile', TOKENS_PROFILE_HELP, [], PROFILE_WANTS);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, FLAGS);
	});

	test('builds the arguments for each scope', () => {
		assert.deepStrictEqual(profileArguments(FLAGS, { kind: 'default' }), ['tokens', 'profile', '--json']);
		assert.deepStrictEqual(profileArguments(FLAGS, { kind: 'all' }), ['tokens', 'profile', '--json', '--all']);
		assert.deepStrictEqual(profileArguments(FLAGS, { kind: 'limit', count: 12 }), ['tokens', 'profile', '--json', '--limit=12']);
		assert.strictEqual(profileArguments({ json: '--json' }, { kind: 'all' }), undefined);
		assert.strictEqual(profileArguments({ json: '--json' }, { kind: 'limit', count: 3 }), undefined);
		assert.strictEqual(profileArguments({ json: '--json', limit: '--limit' }, { kind: 'limit', count: 0 }), undefined);
		assert.strictEqual(profileArguments({}, { kind: 'default' }), undefined);
	});

	test('follows a help whose flags were renamed', () => {
		const help = 'Usage:\n  entire tokens profile [flags]\n\nFlags:\n      --machine-json   Output as JSON\n      --everything     Analyze all committed checkpoints\n      --max int        Maximum committed checkpoints to analyze\n';
		const picked = pickFlags('tokens profile', help, [], PROFILE_WANTS);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, { json: '--machine-json', all: '--everything', limit: '--max' });
	});

	test('a help without the json flag cannot be used', () => {
		const picked = pickFlags('tokens profile', 'Flags:\n      --all   Analyze all committed checkpoints\n', [], PROFILE_WANTS);
		assert.ok(!picked.ok);
	});
});

function service(cli: FakeAnalysisCli): TokenProfileService {
	return new TokenProfileService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20 });
}

const DEFAULT: ProfileScope = { kind: 'default' };

suite('Token profile: the service', () => {
	test('reads the profile with static output and keeps the body out of the record', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli).read({ kind: 'limit', count: 10 });
		assert.ok(outcome.kind === 'found');
		assert.strictEqual(outcome.profile.checkpointsAnalyzed, 50);
		assert.deepStrictEqual(cli.calls(), ['none|ACCESSIBLE=1|tokens profile --json --limit=10']);
		const run = cli.recorded.find(entry => entry.invocation.args.includes('profile') && entry.invocation.args.includes('--json'));
		assert.ok(run);
		assert.strictEqual(run.bodies.stdout, undefined);
	});

	test('runs again on every call, because nothing is cached', async () => {
		const cli = fakeAnalysisCli();
		const source = service(cli);
		await source.read(DEFAULT);
		await source.read(DEFAULT);
		assert.strictEqual(cli.calls().length, 2);
	});

	test('reports no analysed checkpoints as empty', async () => {
		const cli = fakeAnalysisCli({ outputs: { tokens_profile: JSON.stringify({ checkpoints_available: 0, checkpoints_analyzed: 0, signals: [] }) } });
		assert.deepStrictEqual(await service(cli).read(DEFAULT), { kind: 'empty' });
	});

	test('names a failure and shows no profile in its place', async () => {
		const cli = fakeAnalysisCli({ fail: { tokens_profile: 'not a git repository' } });
		const outcome = await service(cli).read(DEFAULT);
		assert.ok(outcome.kind === 'failed' && /not a git repository/.test(outcome.detail));
		assert.strictEqual(cli.calls().length, 1);
	});

	test('output that is not JSON is a failure, not an empty profile', async () => {
		const cli = fakeAnalysisCli({ outputs: { tokens_profile: 'Token profile\n(text)\n' } });
		assert.strictEqual((await service(cli).read(DEFAULT)).kind, 'failed');
	});

	test('a CLI without the command is told to update, and nothing runs', async () => {
		const cli = fakeAnalysisCli({ helps: { tokens_profile: null } });
		const outcome = await service(cli).read(DEFAULT);
		assert.ok(outcome.kind === 'unsupported');
		assert.match(outcome.detail, /no 'tokens profile' command/);
		assert.match(outcome.detail, /update the CLI/);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a help that is the top-level help is read as a missing command', async () => {
		const cli = fakeAnalysisCli({ helps: { tokens_profile: 'The command-line interface for Entire\n\nUsage:\n  entire [flags]\n  entire [command]\n' } });
		assert.strictEqual((await service(cli).read(DEFAULT)).kind, 'unsupported');
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a help lacking the json flag is unsupported and nothing runs', async () => {
		const cli = fakeAnalysisCli({ helps: { tokens_profile: 'Usage:\n  entire tokens profile [flags]\n\nFlags:\n      --all   Analyze all committed checkpoints\n' } });
		assert.strictEqual((await service(cli).read(DEFAULT)).kind, 'unsupported');
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a scope the help has no flag for is unsupported', async () => {
		const cli = fakeAnalysisCli({ helps: { tokens_profile: 'Usage:\n  entire tokens profile [flags]\n\nFlags:\n      --json   Output as JSON\n' } });
		assert.strictEqual((await service(cli).read({ kind: 'all' })).kind, 'unsupported');
		assert.strictEqual((await service(cli).read(DEFAULT)).kind, 'found');
	});

	test('says so when the CLI is missing', async () => {
		const cli = fakeAnalysisCli({ noCli: true });
		const outcome = await service(cli).read(DEFAULT);
		assert.ok(outcome.kind === 'noCli');
		assert.match(outcome.detail, /not installed/);
	});
});

class FakeProfileUi implements TokenProfileUi {
	readonly shown: { kind: GeneratedKind; text: string }[] = [];
	readonly warnings: string[] = [];
	pickedFor: number[] = [];
	constructor(private readonly scope: ProfileScope | null = DEFAULT) {}
	async pickScope(limit: number): Promise<ProfileScope | undefined> {
		this.pickedFor.push(limit);
		return this.scope ?? undefined;
	}
	async show(kind: GeneratedKind, text: string): Promise<void> {
		this.shown.push({ kind, text });
	}
	async warn(message: string): Promise<void> {
		this.warnings.push(message);
	}
	withProgress<T>(_title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return work(new AbortController().signal);
	}
}

function flow(options: FakeAnalysisOptions, ui: FakeProfileUi) {
	const cli = fakeAnalysisCli(options);
	return { cli, run: () => showTokenProfile({ source: service(cli), ui, limit: () => 25 }) };
}

suite('Token profile: the command', () => {
	test('opens the profile as a read-only document without asking for confirmation', async () => {
		const ui = new FakeProfileUi();
		const { cli, run } = flow({}, ui);
		assert.strictEqual(await run(), 'shown');
		assert.deepStrictEqual(ui.pickedFor, [25]);
		assert.strictEqual(ui.shown[0].kind, 'tokenProfile');
		assert.match(ui.shown[0].text, /\| Total \| 372,774,662 \|/);
		assert.strictEqual(cli.calls().length, 1);
	});

	test('says there is no history to profile instead of a blank page', async () => {
		const ui = new FakeProfileUi();
		const { run } = flow({ outputs: { tokens_profile: '{"checkpoints_analyzed":0}' } }, ui);
		assert.strictEqual(await run(), 'empty');
		assert.ok(ui.shown[0].text.includes(EMPTY_PROFILE_TEXT));
		assert.match(ui.shown[0].text, /no checkpoint history to profile/);
	});

	test('names a failure and opens no document', async () => {
		const ui = new FakeProfileUi();
		const { run } = flow({ fail: { tokens_profile: 'boom happened' } }, ui);
		assert.strictEqual(await run(), 'failed');
		assert.deepStrictEqual(ui.shown, []);
		assert.match(ui.warnings[0], /could not be read: boom happened/);
	});

	test('a dismissed scope picker runs nothing', async () => {
		const ui = new FakeProfileUi(null);
		const { cli, run } = flow({}, ui);
		assert.strictEqual(await run(), 'cancelled');
		assert.strictEqual(cli.calls().length, 0);
	});

	test('says a missing command needs a CLI update', async () => {
		const ui = new FakeProfileUi();
		const { cli, run } = flow({ helps: { tokens_profile: null } }, ui);
		assert.strictEqual(await run(), 'failed');
		assert.match(ui.warnings[0], /'tokens profile'.*update the CLI/);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('says so when the CLI is missing and runs nothing', async () => {
		const ui = new FakeProfileUi();
		const { cli, run } = flow({ noCli: true }, ui);
		assert.strictEqual(await run(), 'failed');
		assert.match(ui.warnings[0], /not installed/);
		assert.strictEqual(cli.calls().length, 0);
	});
});

suite('Token profile: settings', () => {
	test('the checkpoint count and timeout are clamped', () => {
		assert.strictEqual(clampTokenProfileCheckpoints(0), MIN_TOKEN_PROFILE_CHECKPOINTS);
		assert.strictEqual(clampTokenProfileCheckpoints(99999), MAX_TOKEN_PROFILE_CHECKPOINTS);
		assert.strictEqual(clampTokenProfileCheckpoints(Number.NaN), DEFAULT_TOKEN_PROFILE_CHECKPOINTS);
		assert.strictEqual(clampTokenProfileCheckpoints(12.9), 12);
		assert.strictEqual(clampTokenProfileTimeout(1), MIN_TOKEN_PROFILE_TIMEOUT_SECONDS);
		assert.strictEqual(clampTokenProfileTimeout(99999), MAX_TOKEN_PROFILE_TIMEOUT_SECONDS);
		assert.strictEqual(clampTokenProfileTimeout(Number.NaN), 30);
	});
});
