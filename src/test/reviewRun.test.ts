import * as assert from 'assert';

import {
	MAX_REVIEW_PROMPT,
	NO_PROFILE_TEXT,
	REVIEW_STARTED_TEXT,
	decodeReviewConfig,
	describeReviewExit,
	isForbiddenReviewArgument,
	reviewConfirmation,
	reviewRunArguments,
	reviewSetupConfirmation,
	type ReviewConfig,
	type ReviewFlags,
	type ReviewPlan,
} from '../lib/entire';
import { openReviewSetup, runReview, type ReviewDependencies } from '../commands/review';
import { ReviewService } from '../services/review';
import { ALICE, REVIEW_LIST_EMPTY, fakeAnalysisCli, type FakeAnalysisCli, type FakeAnalysisOptions } from './support/analysisCli';
import { REVIEW_CONFIG_JSON } from './support/analysisFixtures';
import { FakeReviewUi, fakeLauncher } from './support/reviewHarness';

const FLAGS: ReviewFlags = {
	trust: '--trust-target',
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

function config(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
	const decoded = decodeReviewConfig(JSON.parse(REVIEW_CONFIG_JSON));
	assert.ok(decoded.ok);
	return { ...decoded.value, ...overrides };
}

const DESCRIPTION = 'Run a multi-agent review against the current branch. On first run, guided setup writes a profile and asks before starting agents.';
const TIMEOUT_HELP = 'optional hard cap per reviewer (default: none — reviewers run until they finish)';

suite('Review run: the arguments', () => {
	test('builds the profile, target, prompt and timeout with values attached', () => {
		const plan: ReviewPlan = { profile: 'general', target: 'feat/x', prompt: 'look at locking', timeoutMinutes: 30 };
		assert.deepStrictEqual(reviewRunArguments(FLAGS, plan), {
			ok: true,
			args: ['review', '--profile=general', '--target=feat/x', '--prompt=look at locking', '--timeout=30m'],
		});
	});

	test('a timeout of zero adds no flag, and a positive one is added only when the help lists a timeout flag', () => {
		assert.deepStrictEqual(reviewRunArguments(FLAGS, { profile: 'general', timeoutMinutes: 0 }), { ok: true, args: ['review', '--profile=general'] });
		assert.deepStrictEqual(reviewRunArguments({ ...FLAGS, timeout: undefined }, { profile: 'general', timeoutMinutes: 30 }), { ok: true, args: ['review', '--profile=general'] });
	});

	test('a prompt with a dash, or with the end-of-options marker, stays one argument', () => {
		for (const prompt of ['--trust-target abc123', 'check -- the --set-agents flag', '-x']) {
			const built = reviewRunArguments(FLAGS, { profile: 'general', prompt });
			assert.ok(built.ok);
			assert.deepStrictEqual(built.args, ['review', '--profile=general', `--prompt=${prompt}`]);
			assert.ok(!built.args.some(isForbiddenReviewArgument), 'a prompt is text, not a flag');
		}
	});

	test('refuses what the help does not describe or the CLI could read wrongly', () => {
		assert.ok(!reviewRunArguments({}, { profile: 'general' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: '-bad' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: 'has space' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: '' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: 'p', target: '--x' }).ok);
		assert.ok(!reviewRunArguments({ profile: '--profile' }, { profile: 'p', target: 'main' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: 'p', base: '..x' }).ok);
		assert.ok(!reviewRunArguments({ profile: '--profile' }, { profile: 'p', prompt: 'x' }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: 'p', prompt: 'x'.repeat(MAX_REVIEW_PROMPT + 1) }).ok);
		assert.ok(!reviewRunArguments(FLAGS, { profile: 'p', prompt: 'a\u0000b' }).ok);
	});

	test('never produces a trust or setup flag, even if the picked flags were wrong', () => {
		const tampered = reviewRunArguments({ ...FLAGS, profile: '--trust-target' }, { profile: 'general' });
		assert.ok(!tampered.ok);
		const viaTimeout = reviewRunArguments({ ...FLAGS, timeout: '--set-task' }, { profile: 'general', timeoutMinutes: 5 });
		assert.ok(!viaTimeout.ok);
		const built = reviewRunArguments(FLAGS, { profile: 'general', target: 'feat/x', base: 'main', prompt: 'p', timeoutMinutes: 5 });
		assert.ok(built.ok && !built.args.some(isForbiddenReviewArgument));
	});
});

suite('Review run: the question', () => {
	const question = (extra: Partial<Parameters<typeof reviewConfirmation>[0]> = {}) =>
		reviewConfirmation({ plan: { profile: 'general' }, currentBranch: 'feat/x', config: config(), description: DESCRIPTION, timeoutHelp: TIMEOUT_HELP, ...extra }, ALICE);

	test('names the profile, the branch, the acting login on Entire, the CLI description and the cost', () => {
		const prompt = question();
		assert.match(prompt.message, /"general" review of feat\/x/);
		assert.match(prompt.detail, /Profile: general\./);
		assert.match(prompt.detail, /the current branch, feat\/x/);
		assert.match(prompt.detail, /as alice \(login alice@us\.auth\.entire\.io\) on Entire/);
		assert.ok(prompt.detail.includes(`The Entire CLI describes it: "${DESCRIPTION}"`));
		assert.match(prompt.detail, /reviewer agents and a judge agent on your machine/);
		assert.match(prompt.detail, /spend tokens/);
		assert.match(prompt.detail, /There is no time limit: reviewers run until they finish/);
		assert.ok(prompt.detail.includes(`The CLI says of its timeout: "${TIMEOUT_HELP}"`));
		assert.match(prompt.detail, /\d+ hooks and 1 MCP servers/);
		assert.match(prompt.detail, /started once\. If it fails it is not started again/);
		assert.strictEqual(prompt.action, 'Start Review');
	});

	test('names a target branch and a base', () => {
		const prompt = question({ plan: { profile: 'general', target: 'feat/y', base: 'main' } });
		assert.match(prompt.message, /review of feat\/y/);
		assert.match(prompt.detail, /branch feat\/y \(checked out in a worktree\) against main/);
	});

	test('states the time limit that is set, or that the CLI has no flag for it', () => {
		assert.match(question({ plan: { profile: 'g', timeoutMinutes: 45 } }).detail, /cut off after 45 minutes/);
		assert.match(question({ plan: { profile: 'g', timeoutMinutes: 45 }, timeoutHelp: undefined }).detail, /does not describe a timeout flag, so no limit is applied/);
	});

	test('warns about code the person did not write when yours is false, and does not offer to approve it', () => {
		const prompt = question({ config: config({ yours: false }) });
		assert.match(prompt.detail, /did not author the code under review/);
		assert.match(prompt.detail, /Entirely does not approve it for you/);
		assert.ok(!/--trust/.test(prompt.detail));
		assert.ok(!/did not author/.test(question({ config: config({ yours: true }) }).detail));
		assert.match(question({ config: config({ yours: undefined }) }).detail, /did not say whether you authored/);
	});

	test('the setup question says nothing starts and nothing is chosen for the person', () => {
		const prompt = reviewSetupConfirmation(ALICE);
		assert.match(prompt.detail, /does not start any agent/);
		assert.match(prompt.detail, /alice/);
		assert.strictEqual(prompt.action, 'Open Setup');
	});

	test('describes a bad exit and stays silent on success', () => {
		assert.strictEqual(describeReviewExit(0), undefined);
		assert.strictEqual(describeReviewExit(undefined), undefined);
		assert.match(describeReviewExit(2) ?? '', /exit code 2.*not started again/);
	});
});

function flow(options: FakeAnalysisOptions, ui: FakeReviewUi, extra: Partial<ReviewDependencies> = {}) {
	const cli = fakeAnalysisCli(options);
	const launcher = fakeLauncher();
	const deps: ReviewDependencies = {
		source: new ReviewService({ runner: cli.runner, workspaceRoot: () => cli.dir, readTimeoutSeconds: () => 20 }),
		ui,
		launch: launcher.launch,
		acting: async () => ALICE,
		branches: async () => ({ current: 'main', local: ['main', 'feat/x', 'feat/y'] }),
		timeoutMinutes: () => 0,
		running: { active: false },
		...extra,
	};
	return { cli, launcher, deps };
}

function started(cli: FakeAnalysisCli): number {
	return cli.modes('review.run').length;
}

suite('Review run: the flow', () => {
	test('asks first, names the details, and opens one terminal as the confirmed login only after confirming', async () => {
		const ui = new FakeReviewUi({ profile: 'general', target: { target: 'feat/x' }, prompt: 'look at locking' });
		const { cli, launcher, deps } = flow({}, ui);
		assert.strictEqual(await runReview(deps), 'started');
		assert.strictEqual(ui.confirmations.length, 1);
		assert.match(ui.confirmations[0].detail, /on Entire/);
		assert.match(ui.confirmations[0].message, /"general" review of feat\/x/);
		assert.strictEqual(launcher.launches.length, 1);
		assert.deepStrictEqual(launcher.launches[0].args, [
			'--context',
			ALICE.name,
			'review',
			'--profile=general',
			'--target=feat/x',
			'--prompt=look at locking',
		]);
		assert.strictEqual(launcher.launches[0].env.ENTIRE_CONTEXT, ALICE.name);
		assert.strictEqual(launcher.launches[0].cwd, cli.dir);
		assert.deepStrictEqual(ui.notices, [REVIEW_STARTED_TEXT]);
		assert.strictEqual(started(cli), 0, 'the extension itself runs no review process');
	});

	test('the target picker offers the other local branches and names the current one', async () => {
		const ui = new FakeReviewUi();
		const { deps } = flow({}, ui);
		await runReview(deps);
		assert.deepStrictEqual(ui.targetChoices, [{ branches: ['feat/x', 'feat/y'], current: 'main' }]);
	});

	test('the profiles offered are the CLI list, as opaque strings', async () => {
		const ui = new FakeReviewUi({ profile: 'gpt-9-turbo-deep' });
		const { launcher, deps } = flow({}, ui);
		await runReview(deps);
		assert.deepStrictEqual(ui.profileChoices, [['general', 'gpt-9-turbo-deep']]);
		assert.ok(launcher.launches[0].args.includes('--profile=gpt-9-turbo-deep'));
	});

	test('declining the question starts no process and creates no terminal', async () => {
		const ui = new FakeReviewUi({ confirm: false });
		const { cli, launcher, deps } = flow({}, ui);
		assert.strictEqual(await runReview(deps), 'declined');
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(started(cli), 0);
		assert.strictEqual(ui.confirmations.length, 1);
		assert.deepStrictEqual(ui.notices, []);
	});

	test('dismissing any picker starts nothing', async () => {
		for (const script of [{ profile: null }, { target: null }, { prompt: null }]) {
			const ui = new FakeReviewUi(script);
			const { launcher, deps } = flow({}, ui);
			assert.strictEqual(await runReview(deps), 'cancelled');
			assert.strictEqual(launcher.launches.length, 0);
			assert.strictEqual(ui.confirmations.length, 0);
		}
	});

	test('a terminal that ends badly is reported and never started again', async () => {
		const ui = new FakeReviewUi();
		const { launcher, deps } = flow({}, ui);
		await runReview(deps);
		launcher.end(1);
		assert.strictEqual(launcher.launches.length, 1);
		assert.match(ui.warnings[0], /exit code 1.*not started again/);
		assert.strictEqual(ui.confirmations.length, 1);
	});

	test('a terminal that ends well says nothing', async () => {
		const ui = new FakeReviewUi();
		const { launcher, deps } = flow({}, ui);
		await runReview(deps);
		launcher.end(0);
		assert.deepStrictEqual(ui.warnings, []);
	});

	test('runs as the confirmed login even when the pinned login is another one', async () => {
		const ui = new FakeReviewUi();
		const { cli, launcher, deps } = flow({}, ui);
		cli.runner.setContext('bob@us.auth.entire.io');
		await runReview(deps);
		assert.deepStrictEqual(launcher.launches[0].args.slice(0, 2), ['--context', ALICE.name]);
		assert.strictEqual(launcher.launches[0].env.ENTIRE_CONTEXT, ALICE.name);
	});

	test('passes a reviewer time limit only when the setting is positive and the help lists the flag', async () => {
		const withLimit = flow({}, new FakeReviewUi(), { timeoutMinutes: () => 20 });
		await runReview(withLimit.deps);
		assert.ok(withLimit.launcher.launches[0].args.includes('--timeout=20m'));
		assert.match(withLimit.deps.ui instanceof FakeReviewUi ? withLimit.deps.ui.confirmations[0].detail : '', /cut off after 20 minutes/);

		const noLimit = flow({}, new FakeReviewUi());
		await runReview(noLimit.deps);
		assert.ok(!noLimit.launcher.launches[0].args.some(argument => argument.startsWith('--timeout')));

		const noFlag = flow(
			{ helps: { review: 'Run a review.\n\nUsage:\n  entire review [flags]\n\nFlags:\n      --profile string   review profile to run\n      --list   list profiles\n      --show-config   show\n      --json   json\n' } },
			new FakeReviewUi(),
			{ timeoutMinutes: () => 20 },
		);
		assert.strictEqual(await runReview(noFlag.deps), 'started', 'a help without a timeout flag does not block the run');
		assert.ok(!noFlag.launcher.launches[0].args.some(argument => argument.startsWith('--timeout')));
	});

	test('never passes a trust or setup flag, though the real help lists them', async () => {
		const ui = new FakeReviewUi({ target: { target: 'feat/x' }, prompt: '--set-agents a --trust-target abc' });
		const { cli, launcher, deps } = flow({}, ui);
		await runReview(deps);
		const all = [...launcher.launches.flatMap(launch => launch.args), ...cli.argvs().flat()];
		assert.ok(!all.filter(argument => !argument.startsWith('--prompt=')).some(isForbiddenReviewArgument));
		assert.strictEqual(launcher.launches[0].args.filter(argument => argument.startsWith('--prompt=')).length, 1);
	});

	test('a refusal about a target whose commit the person did not author is shown as is, and nothing starts', async () => {
		const message = 'refusing: commit abc1234 was not authored by you; pass --trust-target abc1234 to approve';
		const ui = new FakeReviewUi({ target: { target: 'feat/x' } });
		const { cli, launcher, deps } = flow({ fail: { 'review.config': message } }, ui);
		assert.strictEqual(await runReview(deps), 'failed');
		assert.deepStrictEqual(ui.warnings, [message]);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(ui.confirmations.length, 0);
		assert.ok(!cli.argvs().flat().some(argument => argument.startsWith('--trust')));
	});

	test('the unauthored-code warning comes from the CLI yours field', async () => {
		const unauthored = JSON.stringify({ ...JSON.parse(REVIEW_CONFIG_JSON), yours: false });
		const ui = new FakeReviewUi();
		const { deps } = flow({ outputs: { 'review.config': unauthored } }, ui);
		await runReview(deps);
		assert.match(ui.confirmations[0].detail, /did not author the code under review/);
	});

	test('no profile configured says so, starts no agent and offers the CLI setup', async () => {
		const ui = new FakeReviewUi({ offer: true });
		const { cli, launcher, deps } = flow({ outputs: { 'review.list': REVIEW_LIST_EMPTY } }, ui);
		assert.strictEqual(await runReview(deps), 'no-profile');
		assert.strictEqual(ui.offers[0].message, NO_PROFILE_TEXT);
		assert.strictEqual(ui.offers[0].action, 'Open Setup in Terminal');
		assert.strictEqual(launcher.launches.length, 1);
		assert.deepStrictEqual(launcher.launches[0].args.slice(-2), ['review', '--configure']);
		assert.strictEqual(started(cli), 0);
		assert.strictEqual(ui.confirmations.length, 0);
	});

	test('the setup terminal is not opened when the offer is declined, and the setup command asks first', async () => {
		const ui = new FakeReviewUi({ offer: false });
		const { launcher, deps } = flow({ outputs: { 'review.list': REVIEW_LIST_EMPTY } }, ui);
		await runReview(deps);
		assert.strictEqual(launcher.launches.length, 0);

		const declined = flow({}, new FakeReviewUi({ confirm: false }));
		assert.strictEqual(await openReviewSetup(declined.deps), 'declined');
		assert.strictEqual(declined.launcher.launches.length, 0);
		const accepted = flow({}, new FakeReviewUi({ confirm: true }));
		assert.strictEqual(await openReviewSetup(accepted.deps), 'started');
		assert.deepStrictEqual(accepted.launcher.launches[0].args, ['--context', ALICE.name, 'review', '--configure']);
	});

	test('a help that does not describe the profile flag stops before anything is asked', async () => {
		const ui = new FakeReviewUi();
		const { cli, launcher, deps } = flow({ helps: { review: 'Usage:\n  entire review [flags]\n\nFlags:\n      --list   list profiles\n' } }, ui);
		assert.strictEqual(await runReview(deps), 'unavailable');
		assert.match(ui.warnings[0], /profile flag/);
		assert.strictEqual(ui.profileChoices.length, 0);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a CLI without review gets an update message and nothing runs', async () => {
		const ui = new FakeReviewUi();
		const { cli, launcher, deps } = flow({ helps: { review: null } }, ui);
		assert.strictEqual(await runReview(deps), 'unavailable');
		assert.match(ui.warnings[0], /no 'review' command.*update the CLI/);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('with no CLI it says so and runs nothing', async () => {
		const ui = new FakeReviewUi();
		const { cli, launcher, deps } = flow({ noCli: true }, ui);
		assert.strictEqual(await runReview(deps), 'unavailable');
		assert.match(ui.warnings[0], /not installed/);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('refuses without a login, and refuses a second review while one is being set up', async () => {
		const ui = new FakeReviewUi();
		const first = flow({}, ui, { acting: async () => undefined });
		assert.strictEqual(await runReview(first.deps), 'no-login');
		assert.match(ui.warnings[0], /Sign in first/);
		assert.strictEqual(first.launcher.launches.length, 0);
		assert.strictEqual(ui.confirmations.length, 0);

		const busy = flow({}, new FakeReviewUi(), { running: { active: true } });
		assert.strictEqual(await runReview(busy.deps), 'busy');
		assert.strictEqual(busy.launcher.launches.length, 0);
	});

	test('the shared flag is released after the run, so the next review can start', async () => {
		const running = { active: false };
		const one = flow({}, new FakeReviewUi({ confirm: false }), { running });
		assert.strictEqual(await runReview(one.deps), 'declined');
		assert.strictEqual(running.active, false);
	});
});
