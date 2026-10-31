import * as assert from 'assert';

import {
	REVIEW_WANTS,
	countLoaded,
	decodeReviewConfig,
	describeReviewConfig,
	isForbiddenReviewArgument,
	parseProfileList,
	pickFlags,
	reviewConfigArguments,
	reviewFindingsArguments,
	reviewListArguments,
	reviewSetupArguments,
	type ReviewFlags,
} from '../lib/entire';
import { showReviewConfig, showReviewFindings, showReviewProfiles, type ReviewDependencies } from '../commands/review';
import { clampReviewReadTimeout, clampReviewReviewerTimeout } from '../services/configuration';
import { ReviewService } from '../services/review';
import { ALICE, REVIEW_LIST_CONFIGURED, REVIEW_LIST_EMPTY, fakeAnalysisCli, type FakeAnalysisCli } from './support/analysisCli';
import { REVIEW_CONFIG_JSON, REVIEW_HELP } from './support/analysisFixtures';
import { FakeReviewUi, fakeLauncher } from './support/reviewHarness';

const FLAGS: ReviewFlags = {
	trust: '--trust-target',
	edit: '--edit',
	agents: '--agents',
	models: '--models',
	agent: '--agent',
	model: '--model',
	configure: '--configure',
	list: '--list',
	showConfig: '--show-config',
	findings: '--findings',
	json: '--json',
	profile: '--profile',
	prompt: '--prompt',
	target: '--target',
	base: '--base',
	timeout: '--timeout',
};

suite('Review: flags come from the help', () => {
	test('picks every flag the extension uses from the real help, and claims the dangerous ones so they are never reused', () => {
		const picked = pickFlags('review', REVIEW_HELP, [], REVIEW_WANTS);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, FLAGS);
	});

	test('the read-only modes use only the list, show-config, json and findings flags', () => {
		assert.deepStrictEqual(reviewListArguments(FLAGS), ['review', '--list']);
		assert.deepStrictEqual(reviewConfigArguments(FLAGS, undefined), ['review', '--show-config', '--json']);
		assert.deepStrictEqual(reviewConfigArguments(FLAGS, { profile: 'general', target: 'feat/x' }), [
			'review',
			'--show-config',
			'--json',
			'--profile=general',
			'--target=feat/x',
		]);
		assert.deepStrictEqual(reviewFindingsArguments(FLAGS), ['review', '--findings']);
		assert.deepStrictEqual(reviewSetupArguments(FLAGS), ['review', '--configure']);
		assert.strictEqual(reviewListArguments({}), undefined);
		assert.strictEqual(reviewConfigArguments({ showConfig: '--show-config' }, undefined), undefined);
		assert.strictEqual(reviewFindingsArguments({}), undefined);
		assert.strictEqual(reviewSetupArguments({}), undefined);
	});

	test('a trust or profile-writing flag is recognised as forbidden', () => {
		for (const argument of ['--trust-target', '--trust-target=abc', '--set-agents', '--set-model=a=b', '--set-config=x']) {
			assert.ok(isForbiddenReviewArgument(argument), argument);
		}
		for (const argument of ['--profile=general', '--target=main', '--prompt=set agents', '--timeout=5m']) {
			assert.ok(!isForbiddenReviewArgument(argument), argument);
		}
	});
});

suite('Review: the profile list', () => {
	test('reads the empty message', () => {
		assert.deepStrictEqual(parseProfileList(REVIEW_LIST_EMPTY), { profiles: [], noneConfigured: true });
	});

	test('reads names as opaque strings, including a name that looks like a model', () => {
		const list = parseProfileList(REVIEW_LIST_CONFIGURED);
		assert.deepStrictEqual(
			list.profiles.map(profile => profile.name),
			['general', 'gpt-9-turbo-deep'],
		);
		assert.deepStrictEqual(list.profiles[0].lines, ['reviewers: alpha, beta', 'judge: gamma']);
		assert.strictEqual(list.noneConfigured, false);
	});

	test('keeps the rest of a one-line profile and skips a heading', () => {
		const list = parseProfileList('Review profiles:\nquick: reviewers a, b; judge c\n');
		assert.deepStrictEqual(list.profiles, [{ name: 'quick', lines: ['reviewers a, b; judge c'] }]);
	});
});

suite('Review: what a review would run', () => {
	test('decodes the config the real CLI printed', () => {
		const decoded = decodeReviewConfig(JSON.parse(REVIEW_CONFIG_JSON));
		assert.ok(decoded.ok);
		const config = decoded.value;
		assert.strictEqual(config.yours, true);
		assert.strictEqual(config.target, 'HEAD');
		assert.strictEqual(config.entries.length, 6);
		assert.deepStrictEqual(config.instructions, ['AGENTS.md']);
		assert.deepStrictEqual(config.isolatedAgents, []);
		const counts = countLoaded(config);
		assert.ok(counts.hooks > 0 && counts.mcpServers === 1);
		assert.strictEqual(counts.hooks + counts.mcpServers + counts.other, 6);
	});

	test('an absent yours stays unknown and a wrong payload is refused', () => {
		const decoded = decodeReviewConfig({ target: 'x', entries: [] });
		assert.ok(decoded.ok && decoded.value.yours === undefined);
		assert.ok(!decodeReviewConfig([]).ok);
	});

	test('the document shows commands and the unauthored-code note, and names no agent', () => {
		const decoded = decodeReviewConfig({ ...JSON.parse(REVIEW_CONFIG_JSON), yours: false });
		assert.ok(decoded.ok);
		const text = describeReviewConfig(decoded.value).replace(/\\(.)/g, '$1');
		assert.match(text, /Authored by you: no\. The reviewer would load code you did not write/);
		assert.match(text, /Command: \.\/scripts\/check-before-compact\.sh/);
		assert.match(text, /Nothing was checked out and no agent was started/);
	});
});

function service(cli: FakeAnalysisCli, readSeconds = 20): ReviewService {
	return new ReviewService({ runner: cli.runner, workspaceRoot: () => cli.dir, readTimeoutSeconds: () => readSeconds });
}

function views(cli: FakeAnalysisCli, ui: FakeReviewUi, readSeconds = 20) {
	const launcher = fakeLauncher();
	const deps: ReviewDependencies = {
		source: service(cli, readSeconds),
		ui,
		launch: launcher.launch,
		acting: async () => ALICE,
		branches: async () => ({ current: 'main', local: ['main', 'feat/x'] }),
		timeoutMinutes: () => 0,
		running: { active: false },
	};
	return { deps, launcher };
}

suite('Review: the service reads without starting anything', () => {
	test('lists profiles with static output, keeps the text out of the record and starts no agent', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli).profiles();
		assert.ok(outcome.kind === 'profiles');
		assert.deepStrictEqual(outcome.list.profiles.map(profile => profile.name), ['general', 'gpt-9-turbo-deep']);
		assert.deepStrictEqual(cli.calls(), ['none|ACCESSIBLE=1|review --list']);
		assert.strictEqual(cli.modes('review.run').length, 0);
		const run = cli.recorded.find(entry => entry.invocation.args.includes('--list'));
		assert.ok(run);
		assert.strictEqual(run.bodies.stdout, undefined);
	});

	test('no profile configured is its own outcome', async () => {
		const cli = fakeAnalysisCli({ outputs: { 'review.list': REVIEW_LIST_EMPTY } });
		assert.deepStrictEqual(await service(cli).profiles(), { kind: 'none' });
	});

	test('reads what a review would run as JSON', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli).config({ profile: 'general', target: 'feat/x' });
		assert.ok(outcome.kind === 'config' && outcome.config.yours === true);
		assert.deepStrictEqual(cli.argvs(), [['review', '--show-config', '--json', '--profile=general', '--target=feat/x']]);
	});

	test('shows the CLI refusal as it was written and adds no trust flag', async () => {
		const message = 'refusing to review abc1234: the commit was not authored by you; approve it with --trust-target abc1234';
		const cli = fakeAnalysisCli({ fail: { 'review.config': `Using context alice\n${message}\n` } });
		const outcome = await service(cli).config({ profile: 'general', target: 'feat/x' });
		assert.deepStrictEqual(outcome, { kind: 'refused', message });
		assert.ok(!cli.argvs().flat().some(argument => argument.startsWith('--trust')));
		assert.strictEqual(cli.argvs().length, 1, 'never retried');
	});

	test('prints saved findings, with static output', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli).findings();
		assert.ok(outcome.kind === 'text' && /run-7/.test(outcome.text));
		assert.deepStrictEqual(cli.calls(), ['none|ACCESSIBLE=1|review --findings']);
	});

	test('a findings browser that waits for input is reported as needing a terminal', async () => {
		const cli = fakeAnalysisCli({ hang: ['review.findings'] });
		assert.deepStrictEqual(await service(cli, 1).findings(), { kind: 'needsTerminal' });
	});

	test('an empty findings output is empty', async () => {
		const cli = fakeAnalysisCli({ outputs: { 'review.findings': '\n' } });
		assert.deepStrictEqual(await service(cli).findings(), { kind: 'empty' });
	});

	test('a help that does not describe a mode makes that mode unsupported before anything runs', async () => {
		const help = 'Usage:\n  entire review [flags]\n\nFlags:\n      --profile string   review profile to run\n';
		const cli = fakeAnalysisCli({ helps: { review: help } });
		for (const outcome of [await service(cli).profiles(), await service(cli).config(undefined), await service(cli).findings()]) {
			assert.strictEqual(outcome.kind, 'unsupported');
		}
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a CLI without review names the command and the way out, and says so when the CLI is missing', async () => {
		const old = fakeAnalysisCli({ helps: { review: null } });
		const outcome = await service(old).profiles();
		assert.ok(outcome.kind === 'unsupported');
		assert.match(outcome.detail, /no 'review' command/);
		assert.match(outcome.detail, /update the CLI/);
		assert.strictEqual(old.calls().length, 0);
		const missing = fakeAnalysisCli({ noCli: true });
		const none = await service(missing).findings();
		assert.ok(none.kind === 'noCli' && /not installed/.test(none.detail));
	});

	test('reads the CLI description and the timeout wording from the help', async () => {
		const cli = fakeAnalysisCli();
		const help = await service(cli).help();
		assert.ok(help.ok);
		assert.match(help.value.description ?? '', /^Run a multi-agent review against the current branch/);
		assert.match(help.value.description ?? '', /asks before starting agents\.$/);
		assert.match(help.value.timeoutHelp ?? '', /reviewers run until they finish/);
	});
});

suite('Review: the read-only views', () => {
	test('profiles, what a review would run and findings open without a confirmation or a terminal', async () => {
		const cli = fakeAnalysisCli();
		const ui = new FakeReviewUi();
		const { deps, launcher } = views(cli, ui);
		assert.strictEqual(await showReviewProfiles(deps), 'started');
		assert.strictEqual(await showReviewConfig(deps), 'started');
		assert.strictEqual(await showReviewFindings(deps), 'started');
		assert.deepStrictEqual(ui.shown.map(item => item.kind), ['reviewProfiles', 'reviewConfig', 'reviewFindings']);
		assert.strictEqual(ui.confirmations.length, 0);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(cli.modes('review.run').length, 0, 'no agent started');
		assert.ok(!cli.argvs().flat().some(argument => /^--(trust|set-)/.test(argument)));
	});

	test('the findings text is shown as the CLI wrote it', async () => {
		const cli = fakeAnalysisCli();
		const ui = new FakeReviewUi();
		await showReviewFindings(views(cli, ui).deps);
		assert.strictEqual(ui.shown[0].text, 'run-7  general  2 findings\nrun-6  general  0 findings');
	});

	test('no profile configured says so and offers the CLI setup, which opens only when chosen', async () => {
		const cli = fakeAnalysisCli({ outputs: { 'review.list': REVIEW_LIST_EMPTY } });
		const declined = new FakeReviewUi({ offer: false });
		const first = views(cli, declined);
		assert.strictEqual(await showReviewProfiles(first.deps), 'no-profile');
		assert.match(declined.offers[0].message, /No review profile is configured/);
		assert.strictEqual(first.launcher.launches.length, 0);

		const accepted = new FakeReviewUi({ offer: true });
		const second = views(cli, accepted);
		await showReviewProfiles(second.deps);
		assert.strictEqual(second.launcher.launches.length, 1);
		assert.deepStrictEqual(second.launcher.launches[0].args, ['--context', ALICE.name, 'review', '--configure']);
		assert.strictEqual(cli.modes('review.run').length, 0, 'setup starts no agent');
	});

	test('findings that need a terminal offer one, and opening it runs the findings browser only', async () => {
		const cli = fakeAnalysisCli({ hang: ['review.findings'] });
		const ui = new FakeReviewUi({ offer: true });
		const { deps, launcher } = views(cli, ui, 1);
		assert.strictEqual(await showReviewFindings(deps), 'cancelled');
		assert.match(ui.offers[0].message, /waits for a terminal/);
		assert.strictEqual(launcher.launches.length, 1);
		assert.deepStrictEqual(launcher.launches[0].args, ['review', '--findings']);
	});

	test('a refusal while reading what a review would run is shown as is', async () => {
		const cli = fakeAnalysisCli({ fail: { 'review.config': 'the target is not yours' } });
		const ui = new FakeReviewUi();
		assert.strictEqual(await showReviewConfig(views(cli, ui).deps), 'failed');
		assert.deepStrictEqual(ui.warnings, ['the target is not yours']);
	});

	test('a CLI without review, or no CLI, gets a clear message and runs nothing', async () => {
		const old = fakeAnalysisCli({ helps: { review: null } });
		const ui = new FakeReviewUi();
		assert.strictEqual(await showReviewProfiles(views(old, ui).deps), 'unavailable');
		assert.match(ui.warnings[0], /'review'.*update the CLI/);
		assert.strictEqual(old.calls().length, 0);
		const missing = fakeAnalysisCli({ noCli: true });
		const second = new FakeReviewUi();
		assert.strictEqual(await showReviewFindings(views(missing, second).deps), 'unavailable');
		assert.match(second.warnings[0], /not installed/);
	});
});

suite('Review: settings', () => {
	test('the read timeout and the reviewer limit are clamped', () => {
		assert.strictEqual(clampReviewReadTimeout(1), 5);
		assert.strictEqual(clampReviewReadTimeout(100000), 300);
		assert.strictEqual(clampReviewReadTimeout(Number.NaN), 30);
		assert.strictEqual(clampReviewReviewerTimeout(-5), 0);
		assert.strictEqual(clampReviewReviewerTimeout(99999), 1440);
		assert.strictEqual(clampReviewReviewerTimeout(Number.NaN), 0);
		assert.strictEqual(clampReviewReviewerTimeout(15.7), 15);
	});
});
