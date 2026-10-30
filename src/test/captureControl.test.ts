import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	cleanSessionData,
	configureEntire,
	disableCapture,
	setUpRunners,
	uninstallEntire,
	validateSummaryModel,
	validateSummaryTimeout,
} from '../commands/captureControl';
import {
	MAX_CAPTURE_CONTROL_TIMEOUT_SECONDS,
	MAX_RUNNER_SETUP_TIMEOUT_SECONDS,
	MIN_CAPTURE_CONTROL_TIMEOUT_SECONDS,
	MIN_RUNNER_SETUP_TIMEOUT_SECONDS,
	clampCaptureControlTimeout,
	clampRunnerSetupTimeout,
	readExtensionSettings,
} from '../services/configuration';
import { describeFileChanges, liveSessionNames } from '../services/captureControl';
import { CLEAN_HELP, CONFIGURE_HELP, DISABLE_HELP, RUNNER_SETUP_HELP, fakeCaptureCli } from './support/captureCli';
import { ACTING, captureHarness } from './support/captureUi';

const ROOT = path.resolve(__dirname, '..', '..');
const LOCAL = '.entire/settings.local.json';
const SHARED = '.entire/settings.json';

/** The argument part of a recorded call. */
function args(call: string): string {
	return call.split('|').slice(2).join('|');
}

function contexts(call: string): [string, string] {
	const [flag, env] = call.split('|');
	return [flag, env];
}

suite('Capture control: disable', () => {
	test('disable-confirmed: runs once as the confirmed login, reads a fresh status, refreshes the views from it and says verified', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'live-1', status: 'active' }] });
		const { deps, ui, stats } = captureHarness(cli, {
			choices: ['local'],
			onConfirm: () => assert.deepStrictEqual(cli.mutating(), [], 'nothing ran before the answer'),
			choose: (_message, actions) => (actions.includes('Set Up Again') ? 'Set Up Again' : undefined),
		});
		const outcome = await disableCapture(deps);

		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(cli.mutating().length, 1);
		assert.strictEqual(args(cli.mutating()[0]), 'disable --local');
		assert.deepStrictEqual(contexts(cli.mutating()[0]), [ACTING.name, ACTING.name]);
		assert.strictEqual(cli.enabled(), false);
		const confirmIndex = ui.events.findIndex(event => event.startsWith('confirm:'));
		assert.deepStrictEqual(ui.events.slice(confirmIndex), [
			`confirm:Turn Entire off in repo?`,
			'progress:Turning Entire off…',
			'refresh:status',
			'refresh:account',
			'refresh:sessions',
			'setUpAgain',
		]);
		assert.deepStrictEqual(stats.enabledAtRefresh, [false], 'the status bar refresh happens after the change');
		assert.match(describeText(outcome), /A fresh status reports Entire as disabled/);
		assert.strictEqual(stats.setUps, 1);
		const notice = ui.notices.at(-1);
		assert.deepStrictEqual(notice?.actions, ['Set Up Again', `Open ${LOCAL}`]);
	});

	test('the modal names the folder, the file, the login, the live session and the checkout', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'live-1', agent: 'codex', status: 'active', branch: 'work' }] });
		const { deps, ui } = captureHarness(cli, { choices: ['project'] });
		await disableCapture(deps);
		const prompt = ui.confirmations[0];
		assert.match(prompt.detail, new RegExp(cli.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.match(prompt.detail, /writes \.entire\/settings\.json/i);
		assert.match(prompt.detail, /alice \(login work\)/);
		assert.match(prompt.detail, /1 session is live: live-1 \(codex on work\)\. They will stop being recorded/);
		assert.match(prompt.detail, /this checkout on this machine only/);
		assert.strictEqual(args(cli.mutating()[0]), 'disable --project');
		assert.deepStrictEqual(ui.choiceLists[0].items.map(item => item.id), ['local', 'project']);
	});

	test('with no live session the modal omits the sentence', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'old', status: 'ended' }] });
		const { deps, ui } = captureHarness(cli, {});
		await disableCapture(deps);
		assert.doesNotMatch(ui.confirmations[0].detail, /live/);
	});

	test('disable-declined: no command that changes anything runs and nothing is written', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui, stats } = captureHarness(cli, { confirms: [false] });
		const outcome = await disableCapture(deps);
		assert.deepStrictEqual(outcome, { kind: 'cancelled' });
		assert.deepStrictEqual(cli.mutating(), []);
		assert.strictEqual(cli.enabled(), true);
		assert.ok(!ui.events.some(event => event.startsWith('refresh:')), 'a declined change refreshes nothing');
		assert.strictEqual(stats.setUps, 0);
	});

	test('dismissing the file choice runs nothing', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { choices: [undefined] });
		assert.deepStrictEqual(await disableCapture(deps), { kind: 'cancelled' });
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('status still enabled afterwards: unconfirmed, never done, and the doctor is suggested', async () => {
		const cli = fakeCaptureCli({ disableNoEffect: true });
		const { deps, ui } = captureHarness(cli, {});
		const outcome = await disableCapture(deps);
		assert.strictEqual(outcome.kind, 'unconfirmed');
		assert.match(describeText(outcome), /status still reports Entire as enabled\. Another settings layer may override this one; run Show Doctor Report/);
		assert.deepStrictEqual(ui.notices.at(-1)?.actions, []);
		assert.strictEqual(ui.notices.at(-1)?.level, 'warn');
	});

	test('a non-zero exit is failed, and the command is not run again', async () => {
		const cli = fakeCaptureCli({ fail: { disable: 'Error: cannot write settings' } });
		const { deps } = captureHarness(cli, {});
		const outcome = await disableCapture(deps);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(describeText(outcome), /cannot write settings/);
		assert.strictEqual(cli.mutating().length, 1);
	});

	test('a timeout is failed, says it was not run again, and the command ran once', async function () {
		this.timeout(20_000);
		const cli = fakeCaptureCli({ slow: { disable: 5 } });
		const { deps } = captureHarness(cli, {}, { timeoutSeconds: 1 });
		const outcome = await disableCapture(deps);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(describeText(outcome), /not run again/);
		assert.strictEqual(cli.mutating().length, 1);
	});

	test('an already-off repository is left alone', async () => {
		const cli = fakeCaptureCli({ enabled: false });
		const { deps, ui } = captureHarness(cli, {});
		const outcome = await disableCapture(deps);
		assert.strictEqual(outcome.kind, 'unchanged');
		assert.deepStrictEqual(cli.mutating(), []);
		assert.deepStrictEqual(ui.confirmations, []);
	});

	test('a folder that is not a repository is refused with the status bar wording', async () => {
		const cli = fakeCaptureCli({ notARepository: true });
		const { deps, ui } = captureHarness(cli, {});
		const outcome = await disableCapture(deps);
		assert.strictEqual(outcome.kind, 'unsupported');
		assert.match(ui.notices[0].message, /not a git repository, so Entire cannot track it/);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('several folders: the person is asked which one first', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { folder: cli.repo }, { folders: [cli.dir, cli.repo] });
		await disableCapture(deps);
		assert.strictEqual(ui.events[0], 'folder');
		assert.strictEqual(cli.mutating().length, 1);
	});

	test('without a saved login the question says so and no login is passed', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, {}, { acting: null });
		await disableCapture(deps);
		assert.match(ui.confirmations[0].detail, /no saved login/);
		assert.deepStrictEqual(contexts(cli.mutating()[0]), ['none', '']);
	});
});

function describeText(outcome: { kind: string; summary?: string; detail?: string; lines?: readonly string[] }): string {
	return [outcome.summary, outcome.detail, ...(outcome.lines ?? [])].filter(Boolean).join('\n');
}

suite('Capture control: uninstall', () => {
	function withHooks() {
		return fakeCaptureCli({
			files: {
				'.github/hooks/entire.json': '{"command":"entire hooks copilot-cli stop"}',
				'.codex/hooks.json': '{"command":"entire hooks codex stop"}',
				'.vscode/other.json': '{}',
			},
			sessions: [{ id: 'live-1', status: 'active' }],
		});
	}

	test('uninstall-has-no-preview: says so, lists the help bullets, names the hook files, needs the folder name typed, and passes the skip flag only afterwards', async () => {
		const cli = withHooks();
		const { deps, ui, stats } = captureHarness(cli, {
			onConfirm: () => assert.deepStrictEqual(cli.mutating(), [], 'no call before the answer'),
		});
		const outcome = await uninstallEntire(deps);
		const prompt = ui.confirmations[0];
		assert.match(prompt.detail, /no preview/);
		assert.match(prompt.detail, /- Git hooks \(prepare-commit-msg/);
		assert.match(prompt.detail, /\.codex\/hooks\.json/);
		assert.match(prompt.detail, /\.github\/hooks\/entire\.json/);
		assert.doesNotMatch(prompt.detail, /\.vscode\/other\.json/);
		assert.match(prompt.detail, /1 session is live/);
		assert.strictEqual(prompt.requireTyped, 'repo');
		assert.deepStrictEqual(ui.typedPrompts, ['repo']);
		assert.strictEqual(args(cli.mutating()[0]), 'disable --uninstall --force');
		assert.strictEqual(cli.mutating().length, 1);
		assert.strictEqual(outcome.kind, 'unconfirmed', 'the fake leaves the hook files, so the read-back finds them');
		assert.strictEqual(stats.invalidations, 1);
	});

	test('a complete removal is done: status off, no .entire, no hook files left', async () => {
		const cli = fakeCaptureCli({});
		const { deps, ui, stats } = captureHarness(cli, { choose: (_m, actions) => (actions.includes('Set Up Again') ? 'Set Up Again' : undefined) });
		const outcome = await uninstallEntire(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(cli.exists('.entire'), false);
		assert.strictEqual(cli.enabled(), false);
		assert.match(describeText(outcome), /no \.entire directory and no hook files/);
		assert.deepStrictEqual(ui.events.slice(-4), ['refresh:status', 'refresh:account', 'refresh:sessions', 'setUpAgain']);
		assert.strictEqual(stats.invalidations, 1);
		assert.strictEqual(stats.setUps, 1);
		assert.match(ui.confirmations[0].detail, /found no hook files/);
	});

	test('a wrong typed name runs nothing', async () => {
		const cli = withHooks();
		const { deps, ui } = captureHarness(cli, { typed: ['Repo'] });
		assert.deepStrictEqual(await uninstallEntire(deps), { kind: 'cancelled' });
		assert.deepStrictEqual(cli.mutating(), []);
		assert.strictEqual(cli.enabled(), true);
		assert.ok(!ui.events.some(event => event.startsWith('refresh:')));
	});

	test('dismissing the typed name, or the modal, runs nothing', async () => {
		const cli = withHooks();
		const typed = captureHarness(cli, { typed: [undefined] });
		assert.deepStrictEqual(await uninstallEntire(typed.deps), { kind: 'cancelled' });
		const declined = captureHarness(cli, { confirms: [false] });
		assert.deepStrictEqual(await uninstallEntire(declined.deps), { kind: 'cancelled' });
		assert.deepStrictEqual(declined.ui.typedPrompts, [], 'the name is not asked for when the modal is declined');
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a partial failure reports what remains from a fresh read, and the command is not retried', async () => {
		const cli = fakeCaptureCli({ uninstallPartial: true, files: { '.codex/hooks.json': '{"command":"entire hooks codex stop"}' } });
		const { deps, ui } = captureHarness(cli, {});
		const outcome = await uninstallEntire(deps);
		assert.strictEqual(outcome.kind, 'failed');
		const text = describeText(outcome);
		assert.match(text, /was not fully uninstalled/);
		assert.match(text, /left: the \.entire directory is still present/);
		assert.match(text, /left: hook files still call the CLI: \.codex\/hooks\.json/);
		assert.strictEqual(cli.mutating().length, 1);
		assert.ok(ui.events.includes('refresh:status'));
	});

	test('a CLI whose help lacks the uninstall mode is told so and nothing runs', async () => {
		const cli = fakeCaptureCli({ helps: { disable: DISABLE_HELP.replace(/ {6}--uninstall.*\n/, '') } });
		const { deps, ui } = captureHarness(cli, {});
		const outcome = await uninstallEntire(deps);
		assert.strictEqual(outcome.kind, 'unsupported');
		assert.match(outcome.kind === 'unsupported' ? outcome.detail : '', /does not describe the mode that removes Entire completely/);
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(cli.mutating(), []);
	});
});

suite('Capture control: clean', () => {
	const SESSIONS = [
		{ id: 'head-1', status: 'ended', scope: 'head' as const },
		{ id: 'other-1', status: 'ended', scope: 'other' as const },
	];

	test('clean-with-preview: the dry run is first, shown in a document and not logged, nothing is deleted before the answer, and a fresh read follows', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, preview: 'Would delete: PREVIEW-MARKER-91\n  one\n' });
		const { deps, ui, stats } = captureHarness(cli, {
			choices: ['head'],
			onConfirm: () => {
				assert.strictEqual(cli.previews().length, 1, 'the preview ran first');
				assert.deepStrictEqual(cli.mutating(), [], 'nothing was deleted before the answer');
				assert.deepStrictEqual(cli.sessionIds(), ['head-1', 'other-1']);
			},
		});
		const outcome = await cleanSessionData(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(args(cli.previews()[0]), 'clean --dry-run');
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force');
		assert.deepStrictEqual(cli.sessionIds(), ['other-1']);
		assert.deepStrictEqual(stats.sessionsAtRefresh, [['other-1']], 'the session tree refresh sees the cleaned state');
		const textIndex = ui.events.indexOf('text:Clean preview');
		const confirmIndex = ui.events.findIndex(event => event.startsWith('confirm:'));
		assert.ok(textIndex >= 0 && textIndex < confirmIndex, 'the preview is shown before the question');
		assert.match(ui.texts[0].text, /PREVIEW-MARKER-91/);
		assert.match(ui.confirmations[0].detail, /Preview, in the CLI's own words.*Would delete: PREVIEW-MARKER-91 \(2 lines\)/);
		assert.match(describeText(outcome), /sessions no longer listed: head-1/);
		assert.match(describeText(outcome), /still listed: other-1/);
		assert.match(describeText(outcome), /CLI's own text/);
		for (const { invocation, bodies } of cli.recorded) {
			assert.ok(!JSON.stringify([invocation, bodies]).includes('PREVIEW-MARKER-91'), 'the preview text never reaches the invocation record');
		}
	});

	test('declined after the preview: the preview ran, nothing was deleted', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const { deps, ui } = captureHarness(cli, { choices: ['head'], confirms: [false] });
		assert.deepStrictEqual(await cleanSessionData(deps), { kind: 'cancelled' });
		assert.strictEqual(cli.previews().length, 1);
		assert.deepStrictEqual(cli.mutating(), []);
		assert.deepStrictEqual(cli.sessionIds(), ['head-1', 'other-1']);
		assert.ok(!ui.events.some(event => event.startsWith('refresh:')));
	});

	test('a preview that fails stops the flow, and nothing is cleaned', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, fail: { preview: 'Error: cannot read session state' } });
		const { deps, ui } = captureHarness(cli, { choices: ['head'] });
		const outcome = await cleanSessionData(deps);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(describeText(outcome), /nothing was cleaned: Error: cannot read session state/);
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a preview that prints nothing means there is nothing to clean', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, preview: '' });
		const { deps, ui } = captureHarness(cli, { choices: ['head'] });
		assert.strictEqual((await cleanSessionData(deps)).kind, 'unchanged');
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a help without the preview flag says so, needs the folder name typed and still passes nothing before the answer', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, helps: { clean: CLEAN_HELP.replace(/ {2}-d, --dry-run.*\n/, '') } });
		const { deps, ui } = captureHarness(cli, { choices: ['head'], onConfirm: () => assert.deepStrictEqual(cli.mutating(), []) });
		const outcome = await cleanSessionData(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.previews(), []);
		assert.match(ui.confirmations[0].detail, /no preview/);
		assert.strictEqual(ui.confirmations[0].requireTyped, 'repo');
		assert.deepStrictEqual(ui.typedPrompts, ['repo']);
	});

	test('clean-over-live-session: the live session is named, the button is Delete anyway, and the override flag comes only after it', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'live-7', agent: 'codex', status: 'active', branch: 'feature', scope: 'head' }, ...SESSIONS] });
		const { deps, ui } = captureHarness(cli, {
			choices: ['head'],
			onConfirm: () => assert.ok(!cli.mutating().some(call => call.includes('--force')), 'no skip flag before the answer'),
		});
		await cleanSessionData(deps);
		const prompt = ui.confirmations[0];
		assert.strictEqual(prompt.action, 'Delete anyway');
		assert.match(prompt.detail, /1 session is live: live-7 \(codex on feature\)\. Cleaning removes their state and they stop being recorded/);
		assert.match(prompt.detail, /overrides its own live-session guard/);
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force');
	});

	test('declining the Delete anyway wording leaves the live session and passes no override', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'live-7', status: 'active', scope: 'head' }] });
		const { deps } = captureHarness(cli, { choices: ['head'], confirms: [false] });
		assert.deepStrictEqual(await cleanSessionData(deps), { kind: 'cancelled' });
		assert.deepStrictEqual(cli.mutating(), []);
		assert.deepStrictEqual(cli.sessionIds(), ['live-7']);
	});

	test('with no live session the button reads Delete and the flag is still passed only after the answer', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const { deps, ui } = captureHarness(cli, { choices: ['head'], onConfirm: () => assert.deepStrictEqual(cli.mutating(), []) });
		await cleanSessionData(deps);
		assert.strictEqual(ui.confirmations[0].action, 'Delete');
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force');
	});

	test('all session data needs the folder name typed; a wrong name deletes nothing', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const wrong = captureHarness(cli, { choices: ['all'], typed: ['nope'] });
		assert.deepStrictEqual(await cleanSessionData(wrong.deps), { kind: 'cancelled' });
		assert.deepStrictEqual(cli.mutating(), []);
		const right = captureHarness(cli, { choices: ['all'] });
		const outcome = await cleanSessionData(right.deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force --all');
		assert.deepStrictEqual(cli.sessionIds(), []);
		assert.match(right.ui.confirmations[0].detail, /All session state files/);
	});

	test('one session from the tree: its id follows its flag, and the preview names the same scope', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const { deps } = captureHarness(cli);
		const outcome = await cleanSessionData(deps, 'other-1');
		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(args(cli.previews()[0]), 'clean --dry-run --session=other-1');
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force --session=other-1');
		assert.deepStrictEqual(cli.sessionIds(), ['head-1']);
	});

	test('one session picked from the list', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const { deps, ui } = captureHarness(cli, { choices: ['session', 'other-1'] });
		await cleanSessionData(deps);
		assert.deepStrictEqual(ui.choiceLists[1].items.map(item => item.id), ['head-1', 'other-1']);
		assert.strictEqual(args(cli.mutating()[0]), 'clean --force --session=other-1');
	});

	test('a session id that could be read as a flag is refused before anything runs', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS });
		const { deps, ui } = captureHarness(cli);
		const outcome = await cleanSessionData(deps, '--all');
		assert.strictEqual(outcome.kind, 'unsupported');
		assert.deepStrictEqual(cli.calls(), []);
		assert.strictEqual(ui.notices.length, 1);
	});

	test('a clean that leaves the session listed is unconfirmed', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, cleanNoEffect: true });
		const { deps } = captureHarness(cli);
		const outcome = await cleanSessionData(deps, 'other-1');
		assert.strictEqual(outcome.kind, 'unconfirmed');
		assert.match(describeText(outcome), /session other-1 is still listed/);
	});

	test('a failing clean is failed and ran once', async () => {
		const cli = fakeCaptureCli({ sessions: SESSIONS, fail: { clean: 'Error: active session guard' } });
		const { deps } = captureHarness(cli, { choices: ['head'] });
		const outcome = await cleanSessionData(deps);
		assert.strictEqual(outcome.kind, 'failed');
		assert.strictEqual(cli.mutating().length, 1);
	});

	test('liveSessionNames reads the status and the list, limited to one session for that scope', () => {
		const reading = {
			status: undefined,
			sessions: [
				{ id: 'a', agent: 'x', status: 'active', branch: 'main' },
				{ id: 'b', agent: 'x', status: 'ended' },
			],
		};
		assert.deepStrictEqual(liveSessionNames(reading, undefined), ['a (x on main)']);
		assert.deepStrictEqual(liveSessionNames(reading, { kind: 'session', id: 'b' }), []);
		assert.deepStrictEqual(liveSessionNames(reading, { kind: 'session', id: 'a' }), ['a (x on main)']);
		assert.strictEqual(liveSessionNames({ status: undefined, sessions: undefined }, undefined), undefined);
	});
});

suite('Capture control: configure', () => {
	test('configure-writes-only-chosen: one setting and a target pass exactly two flags, and the value is read back from the file', async () => {
		const cli = fakeCaptureCli({ files: { [LOCAL]: '{"telemetry": true}' } });
		const { deps, ui } = captureHarness(cli, { many: [['telemetry']], choices: ['false', 'local'] });
		const outcome = await configureEntire(deps);

		assert.strictEqual(outcome.kind, 'done');
		assert.strictEqual(cli.mutating().length, 1);
		assert.strictEqual(args(cli.mutating()[0]), 'configure --telemetry=false --local');
		assert.deepStrictEqual(contexts(cli.mutating()[0]), [ACTING.name, ACTING.name]);
		assert.match(describeText(outcome), /telemetry: off \(read back from \.entire\/settings\.local\.json\)/);
		assert.strictEqual(outcome.kind === 'done' ? outcome.summary : '', 'Settings were written and read back from the settings files.');
		assert.match(ui.confirmations[0].detail, /telemetry: on -> off in \.entire\/settings\.local\.json/);
		assert.deepStrictEqual(ui.notices.at(-1)?.actions, [`Open ${LOCAL}`]);
	});

	test('the current values step shows the layer file each value came from', async () => {
		const cli = fakeCaptureCli({ files: { [LOCAL]: '{"telemetry": true}', [SHARED]: '{"absolute_git_hook_path": true}' } });
		const { deps, ui } = captureHarness(cli, { many: [undefined] });
		assert.deepStrictEqual(await configureEntire(deps), { kind: 'cancelled' });
		const items = ui.manyLists[0].items;
		assert.strictEqual(items.find(item => item.id === 'telemetry')?.description, `now: on (${LOCAL})`);
		assert.strictEqual(items.find(item => item.id === 'absoluteHookPath')?.description, `now: on (${SHARED})`);
		assert.strictEqual(items.find(item => item.id === 'summaryModel')?.description, undefined);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a role the help lacks is not listed', async () => {
		const cli = fakeCaptureCli({ helps: { configure: CONFIGURE_HELP.replace(/ {6}--telemetry .*\n/, '').replace(/ {6}--summarize-model .*\n/, '') } });
		const { deps, ui } = captureHarness(cli, { many: [undefined] });
		await configureEntire(deps);
		const ids = ui.manyLists[0].items.map(item => item.id);
		assert.ok(!ids.includes('telemetry') && !ids.includes('summaryModel'));
		assert.ok(ids.includes('checkpointBackend'));
	});

	test('the backend choices shown are the ones in the help text', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { many: [['checkpointBackend']], choices: [undefined] });
		await configureEntire(deps);
		assert.deepStrictEqual(ui.choiceLists[0].items.map(item => item.id), ['refs', 'branch']);
		const custom = fakeCaptureCli({ helps: { configure: CONFIGURE_HELP.replace('refs (default; one git ref per checkpoint) or branch (legacy shared entire/checkpoints/v1 branch)', 'alpha (default) or beta') } });
		const other = captureHarness(custom, { many: [['checkpointBackend']], choices: [undefined] });
		await configureEntire(other.deps);
		assert.deepStrictEqual(other.ui.choiceLists[0].items.map(item => item.id), ['alpha', 'beta']);
	});

	test('the backend change warns that it migrates storage, and is read back by name', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { many: [['checkpointBackend']], choices: ['refs', 'project'] });
		const outcome = await configureEntire(deps);
		assert.match(ui.confirmations[0].detail, /this migrates storage for the repository and is not offered as a one-click undo/);
		assert.strictEqual(args(cli.mutating()[0]), 'configure --checkpoint-backend=refs --project');
		assert.strictEqual(outcome.kind, 'done');
		assert.match(describeText(outcome), /checkpoint backend: refs \(read back from \.entire\/settings\.json\)/);
	});

	test('a setting the editor cannot read back is reported as written, not verified', async () => {
		const cli = fakeCaptureCli();
		const { deps } = captureHarness(cli, { many: [['summaryModel', 'summaryTimeout']], asks: ['org/some-model', '300'], choices: ['local'] });
		const outcome = await configureEntire(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.match(describeText(outcome), /summary model: written; the editor cannot read this setting back/);
		assert.match(describeText(outcome), /summary timeout \(seconds\): written; the editor cannot read this setting back/);
		assert.strictEqual(outcome.kind === 'done' ? outcome.summary : '', 'Settings were written. The editor cannot read these settings back, so none could be verified.');
		assert.deepStrictEqual(cli.mutating().map(args), ['configure --summarize-model org/some-model --summarize-timeout-seconds=300 --local']);
	});

	test('a value that is not in the file afterwards is unconfirmed', async () => {
		const cli = fakeCaptureCli({ configureIgnores: true });
		const { deps } = captureHarness(cli, { many: [['telemetry']], choices: ['false', 'local'] });
		const outcome = await configureEntire(deps);
		assert.strictEqual(outcome.kind, 'unconfirmed');
		assert.match(describeText(outcome), /telemetry is not set in \.entire\/settings\.local\.json after the write/);
	});

	test('a value a higher settings layer overrides is unconfirmed and names that file', async () => {
		const cli = fakeCaptureCli({ files: { [LOCAL]: '{"telemetry": true}' } });
		const { deps } = captureHarness(cli, { many: [['telemetry']], choices: ['false', 'project'] });
		const outcome = await configureEntire(deps);
		assert.strictEqual(outcome.kind, 'unconfirmed');
		assert.match(describeText(outcome), /\.entire\/settings\.local\.json sets it to on and takes precedence/);
	});

	test('a target flag is always passed, and with one target in the help there is no choice to make', async () => {
		const cli = fakeCaptureCli({ helps: { configure: CONFIGURE_HELP.replace(/ {6}--local .*\n/, '') } });
		const { deps, ui } = captureHarness(cli, { many: [['telemetry']], choices: ['true'] });
		await configureEntire(deps);
		assert.strictEqual(args(cli.mutating()[0]), 'configure --telemetry=true --project');
		assert.strictEqual(ui.choiceLists.length, 1, 'only the on/off question was asked');
	});

	test('a help with neither target flag cannot be configured and nothing runs', async () => {
		const cli = fakeCaptureCli({ helps: { configure: CONFIGURE_HELP.replace(/ {6}--local .*\n/, '').replace(/ {6}--project .*\n/, '') } });
		const { deps } = captureHarness(cli, { many: [['telemetry']], choices: ['true'] });
		const outcome = await configureEntire(deps);
		assert.strictEqual(outcome.kind, 'unsupported');
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a remote without the provider:owner/repo form, a negative timeout and an empty model are refused by the question, so no call is made', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { many: [['checkpointRemote']], asks: [undefined] });
		assert.deepStrictEqual(await configureEntire(deps), { kind: 'cancelled' });
		const validate = ui.questions[0].validate;
		assert.match(validate('github:org') ?? '', /provider:owner\/repo/);
		assert.match(validate('bitbucket:org/repo') ?? '', /provider:owner\/repo/);
		assert.strictEqual(validate('gitlab:org/repo'), undefined);
		assert.match(validateSummaryTimeout('-5') ?? '', /whole number/);
		assert.match(validateSummaryTimeout('1.5') ?? '', /whole number/);
		assert.strictEqual(validateSummaryTimeout('0'), undefined);
		assert.match(validateSummaryModel('   ') ?? '', /one line/);
		assert.match(validateSummaryModel('a\nb') ?? '', /one line/);
		assert.strictEqual(validateSummaryModel('any/model:tag'), undefined);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('the summary provider is picked from the agents the CLI lists', async () => {
		const cli = fakeCaptureCli({ agents: ['+copilot-cli', 'codex'] });
		const { deps, ui } = captureHarness(cli, { many: [['summaryProvider']], choices: ['codex', 'local'] });
		await configureEntire(deps);
		assert.deepStrictEqual(ui.choiceLists[0].items.map(item => item.id), ['copilot-cli', 'codex']);
		assert.strictEqual(args(cli.mutating()[0]), 'configure --summarize-provider=codex --local');
	});

	test('reinstalling the hook is a plain action', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { many: [['reinstallHook']], choices: ['local'] });
		await configureEntire(deps);
		assert.strictEqual(args(cli.mutating()[0]), 'configure --force --local');
		assert.match(ui.confirmations[0].detail, /git hook: reinstalled/);
	});

	test('declining the confirmation writes nothing', async () => {
		const cli = fakeCaptureCli();
		const { deps } = captureHarness(cli, { many: [['telemetry']], choices: ['false', 'local'], confirms: [false] });
		assert.deepStrictEqual(await configureEntire(deps), { kind: 'cancelled' });
		assert.deepStrictEqual(cli.mutating(), []);
		assert.strictEqual(cli.exists(LOCAL), false);
	});

	test('a typed remote and model are redacted in the invocation record, and the CLI output is not recorded', async () => {
		const cli = fakeCaptureCli();
		const { deps } = captureHarness(cli, { many: [['checkpointRemote', 'summaryModel']], asks: ['github:acme/secret-checkpoints', 'private-model-name'], choices: ['local'] });
		await configureEntire(deps);
		const record = cli.recorded.map(entry => entry.invocation.args.join(' ')).join('\n');
		assert.doesNotMatch(record, /secret-checkpoints|private-model-name/);
		assert.match(record, /--checkpoint-remote <redacted>/);
		assert.match(record, /--summarize-model <redacted>/);
		for (const entry of cli.recorded) {
			assert.ok(!entry.bodies.stdout?.includes('Settings updated'), 'the CLI output stays out of the record');
		}
	});
});

suite('Capture control: runners', () => {
	test('runner-defaults-only: only the defaults-only form runs, no provider is called, and the created files are listed', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { choices: ['defaults'] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.mutating().map(args), ['runner setup --defaults-only']);
		assert.strictEqual(cli.providerCalls(), 0);
		assert.match(describeText(outcome), /created risk \(\d+ bytes\)/);
		assert.match(describeText(outcome), /created review \(\d+ bytes\)/);
		assert.match(ui.confirmations[0].detail, /No summary provider is called/);
		assert.deepStrictEqual(ui.events.slice(-3), ['refresh:status', 'refresh:account', 'refresh:sessions']);
	});

	test('runner-tailoring-confirmed: the modal names the signals and the provider; declined means zero calls', async () => {
		const cli = fakeCaptureCli({ files: { '.entire/runners/risk.json': '{"name":"risk"}' } });
		const declined = captureHarness(cli, { choices: ['tailor', '', ''], confirms: [false] });
		assert.deepStrictEqual(await setUpRunners(declined.deps), { kind: 'cancelled' });
		assert.deepStrictEqual(cli.calls(), []);
		const prompt = declined.ui.confirmations[0];
		assert.match(prompt.detail, /sends signals about this repository \(its docs and structure, merged pull requests and issues, checkpoint hotspots and past trail findings\) to the summary provider Entire is configured with/);
		assert.match(prompt.detail, /rewrites \.entire\/runners\/\*\.json/);
		assert.deepStrictEqual(cli.mutating(), []);
		assert.strictEqual(cli.providerCalls(), 0);
	});

	test('confirmed tailoring passes the yes form, the agent picked from agent list for this run, and the chosen sources', async () => {
		const cli = fakeCaptureCli({ files: { '.entire/runners/risk.json': '{"name":"risk"}' } });
		const { deps, ui } = captureHarness(cli, { choices: ['tailor', 'risk', 'codex'], many: [['repo', 'prs']] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.mutating().map(args), ['runner setup --yes --agent=codex --sources=repo,prs -- risk']);
		assert.strictEqual(cli.providerCalls(), 1);
		assert.match(ui.confirmations[0].detail, /for this run only, the agent codex/);
		assert.match(ui.confirmations[0].detail, /Data sources: repo, prs/);
		assert.match(describeText(outcome), /changed risk/);
		assert.deepStrictEqual(ui.choiceLists[1].items.map(item => item.id), ['', 'risk'], 'only existing runner files are offered');
		assert.deepStrictEqual(ui.choiceLists[2].items.map(item => item.id), ['', 'copilot-cli', 'codex', 'cursor']);
		assert.deepStrictEqual(ui.manyLists[0].items.map(item => item.id), ['repo', 'prs', 'checkpoints', 'trails', 'all']);
	});

	test('all sources ticked, and the configured provider chosen, pass neither flag', async () => {
		const cli = fakeCaptureCli();
		const { deps } = captureHarness(cli, { choices: ['tailor', ''], many: [['repo', 'prs', 'checkpoints', 'trails', 'all']] });
		await setUpRunners(deps);
		assert.deepStrictEqual(cli.mutating().map(args), ['runner setup --yes']);
	});

	test('a preview shows the CLI diff in a document and leaves the file listing unchanged', async () => {
		const cli = fakeCaptureCli({ files: { '.entire/runners/risk.json': '{"name":"risk"}' } });
		const { deps, ui } = captureHarness(cli, { choices: ['dry-run', '', ''], many: [['repo']] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.mutating().map(args), ['runner setup --dry-run --sources=repo']);
		assert.match(ui.texts[0].text, /\+\+\+ risk\.json \(tailored\)/);
		assert.match(describeText(outcome), /1 runner files, unchanged/);
		assert.match(ui.confirmations[0].detail, /The preview writes nothing/);
		assert.strictEqual(cli.providerCalls(), 1);
	});

	test('a preview that changes the listing is reported unconfirmed', async () => {
		const cli = fakeCaptureCli({ dryRunWrites: true, files: { '.entire/runners/risk.json': '{"name":"risk"}' } });
		const { deps } = captureHarness(cli, { choices: ['dry-run', '', ''], many: [undefined] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'cancelled', 'dismissing the sources cancels');
		const again = captureHarness(cli, { choices: ['dry-run', '', ''], many: [['repo']] });
		const second = await setUpRunners(again.deps);
		assert.strictEqual(second.kind, 'unconfirmed');
		assert.match(describeText(second), /changed risk/);
	});

	test('the tailoring prompt is shown in a document, and the modal says it creates the default files', async () => {
		const cli = fakeCaptureCli();
		const { deps, ui } = captureHarness(cli, { choices: ['print-prompt'] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.mutating().map(args), ['runner setup --print-prompt']);
		assert.match(ui.confirmations[0].detail, /Creates the default runner files .* if they are missing/);
		assert.match(ui.texts[0].text, /TAILORING PROMPT/);
		assert.strictEqual(cli.providerCalls(), 0);
	});

	test('the debug directory flag is never passed in any form', async () => {
		const cli = fakeCaptureCli({ files: { '.entire/runners/risk.json': '{"name":"risk"}' } });
		for (const mode of ['defaults', 'print-prompt', 'dry-run', 'tailor']) {
			const { deps } = captureHarness(cli, { choices: [mode, '', ''], many: [['repo']] });
			await setUpRunners(deps);
		}
		assert.ok(cli.mutating().length >= 4);
		assert.ok(cli.mutating().every(call => !call.includes('debug')));
	});

	test('a tailoring that fails is failed with the CLI words, and ran once', async () => {
		const cli = fakeCaptureCli({ fail: { runner: 'Error: no summary provider is configured; pass an agent' } });
		const { deps } = captureHarness(cli, { choices: ['tailor', ''], many: [['repo']] });
		const outcome = await setUpRunners(deps);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(describeText(outcome), /no summary provider is configured/);
		assert.match(describeText(outcome), /start again and pick an agent for this run/);
		assert.strictEqual(cli.mutating().length, 1);
	});

	test('describeFileChanges lists created, changed and removed files', () => {
		assert.deepStrictEqual(
			describeFileChanges([{ name: 'a', size: 1 }, { name: 'b', size: 2 }], [{ name: 'a', size: 5 }, { name: 'c', size: 3 }]),
			['changed a (1 -> 5 bytes)', 'created c (3 bytes)', 'removed b'],
		);
	});
});

suite('Capture control: the CLI is missing, too old or lacks the command', () => {
	const flows: [string, (deps: Parameters<typeof disableCapture>[0]) => Promise<{ kind: string }>][] = [
		['disable', disableCapture],
		['uninstall', uninstallEntire],
		['clean', deps => cleanSessionData(deps)],
		['configure', configureEntire],
		['runner setup', setUpRunners],
	];

	test('no CLI: every flow says so with the install way forward and runs nothing', async () => {
		for (const [name, flow] of flows) {
			const cli = fakeCaptureCli({ noCli: true });
			const { deps, ui } = captureHarness(cli, { choose: (_message, actions) => actions[0] });
			const outcome = await flow(deps);
			assert.strictEqual(outcome.kind, 'no-cli', name);
			assert.match(ui.notices[0].message, /not installed.*run the installer/, name);
			assert.deepStrictEqual(ui.notices[0].actions, ['Open Install Instructions'], name);
			assert.deepStrictEqual(ui.urls, ['https://example.invalid/install'], name);
			assert.deepStrictEqual(ui.confirmations, [], name);
		}
	});

	test('the command is missing from the help: unsupported, with the terminal hint, and no command runs', async () => {
		const missing: Record<string, string> = { disable: 'disable', uninstall: 'disable', clean: 'clean', configure: 'configure', 'runner setup': 'runner_setup' };
		for (const [name, flow] of flows) {
			const cli = fakeCaptureCli({ helps: { [missing[name]]: null } });
			const { deps, ui } = captureHarness(cli, {});
			const outcome = await flow(deps);
			assert.strictEqual(outcome.kind, 'unsupported', name);
			assert.match(ui.notices[0].message, /This version of the Entire CLI \(0\.12\.2\) cannot .* from the editor\..*Update the CLI, or run `entire [a-z ]+ --help` in a terminal/, name);
			assert.deepStrictEqual(cli.mutating(), [], name);
			assert.deepStrictEqual(ui.confirmations, [], name);
		}
	});

	test('a required role missing from the help is named, and nothing runs', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 's', scope: 'head' }], helps: { clean: CLEAN_HELP.replace(/ {2}-f, --force.*\n/, '') } });
		const { deps, ui } = captureHarness(cli, { choices: ['head'] });
		const outcome = await cleanSessionData(deps);
		assert.strictEqual(outcome.kind, 'unsupported');
		assert.match(ui.notices.at(-1)?.message ?? '', /does not describe the flag that skips the confirmation prompt/);
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a runner help that describes no form of the setup is unsupported', async () => {
		const bare = RUNNER_SETUP_HELP.replace(/ {6}--defaults-only.*\n/g, '').replace(/ {6}--print-prompt.*\n/g, '').replace(/ {6}--dry-run.*\n/g, '').replace(/ {2}-y, --yes.*\n/g, '');
		const cli = fakeCaptureCli({ helps: { runner_setup: bare } });
		const { deps } = captureHarness(cli, {});
		assert.strictEqual((await setUpRunners(deps)).kind, 'unsupported');
		assert.deepStrictEqual(cli.mutating(), []);
	});

	test('a second command is refused while one runs', async () => {
		const cli = fakeCaptureCli();
		const running = { active: true };
		const { deps, ui } = captureHarness(cli, {}, { running });
		assert.strictEqual((await disableCapture(deps)).kind, 'unchanged');
		assert.match(ui.notices[0].message, /still running/);
		assert.deepStrictEqual(cli.calls(), []);
		assert.strictEqual(running.active, true);
	});

	test('the running flag is released after a flow, even one that is declined', async () => {
		const cli = fakeCaptureCli();
		const running = { active: false };
		const { deps } = captureHarness(cli, { confirms: [false] }, { running });
		await disableCapture(deps);
		assert.strictEqual(running.active, false);
	});
});

suite('Capture control: privacy and timers', () => {
	test('no flow starts an interval, and the only timeouts are the runner\'s own', async function () {
		this.timeout(60_000);
		const intervals: string[] = [];
		const timeouts: string[] = [];
		const realInterval = global.setInterval;
		const realTimeout = global.setTimeout;
		global.setInterval = ((...a: Parameters<typeof setInterval>) => {
			intervals.push(new Error().stack ?? '');
			return realInterval(...a);
		}) as typeof setInterval;
		global.setTimeout = ((...a: Parameters<typeof setTimeout>) => {
			timeouts.push(new Error().stack ?? '');
			return realTimeout(...a);
		}) as typeof setTimeout;
		try {
			const cli = fakeCaptureCli({ sessions: [{ id: 's1', scope: 'head' }] });
			await disableCapture(captureHarness(cli, {}).deps);
			const again = fakeCaptureCli({ sessions: [{ id: 's1', scope: 'head' }] });
			await cleanSessionData(captureHarness(again, { choices: ['head'] }).deps);
			const configured = fakeCaptureCli();
			await configureEntire(captureHarness(configured, { many: [['telemetry']], choices: ['false', 'local'] }).deps);
			const runners = fakeCaptureCli();
			await setUpRunners(captureHarness(runners, { choices: ['defaults'] }).deps);
			const removed = fakeCaptureCli();
			await uninstallEntire(captureHarness(removed, {}).deps);
		} finally {
			global.setInterval = realInterval;
			global.setTimeout = realTimeout;
		}
		assert.deepStrictEqual(intervals, []);
		const ours = /out[\\/](?:commands|services|lib|providers)[\\/]/;
		const fromRunner = /services[\\/]cli[\\/]exec/;
		assert.deepStrictEqual(timeouts.filter(stack => ours.test(stack) && !fromRunner.test(stack)), []);
	});

	test('no CLI text reaches the invocation record in any flow', async () => {
		const cli = fakeCaptureCli({ sessions: [{ id: 'sess-x', scope: 'head' }], preview: 'PREVIEW-ONLY-TEXT\n' });
		await cleanSessionData(captureHarness(cli, { choices: ['head'] }).deps);
		await disableCapture(captureHarness(cli, {}).deps);
		await setUpRunners(captureHarness(cli, { choices: ['print-prompt'] }).deps);
		assert.ok(cli.recorded.length > 4);
		// The discovery probe (`entire version`) is the runner's own and is not a capture-control call.
		for (const entry of cli.recorded.filter(recorded => recorded.invocation.args[0] !== 'version')) {
			assert.strictEqual(entry.bodies.stdout, undefined, entry.invocation.args.join(' '));
			assert.strictEqual(entry.bodies.stderr, undefined, entry.invocation.args.join(' '));
		}
	});
});

suite('Capture control: settings and wiring', () => {
	test('the two timeouts clamp below the minimum, above the maximum, NaN and fractions', () => {
		const cases: [string, (value: number) => number, number, number, number][] = [
			['captureControlTimeout', clampCaptureControlTimeout, MIN_CAPTURE_CONTROL_TIMEOUT_SECONDS, MAX_CAPTURE_CONTROL_TIMEOUT_SECONDS, 60],
			['runnerSetupTimeout', clampRunnerSetupTimeout, MIN_RUNNER_SETUP_TIMEOUT_SECONDS, MAX_RUNNER_SETUP_TIMEOUT_SECONDS, 300],
		];
		const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			contributes: { configuration: { properties: Record<string, { default?: number; minimum?: number; maximum?: number }> } };
		};
		for (const [name, clamp, min, max, fallback] of cases) {
			assert.strictEqual(clamp(min - 1), min, name);
			assert.strictEqual(clamp(-100), min, name);
			assert.strictEqual(clamp(max + 1), max, name);
			assert.strictEqual(clamp(Number.NaN), fallback, name);
			assert.strictEqual(clamp(Number.POSITIVE_INFINITY), fallback, name);
			assert.strictEqual(clamp(min + 0.9), min, name);
			const property = manifest.contributes.configuration.properties[`entirely.${name}`];
			assert.deepStrictEqual([property.default, property.minimum, property.maximum], [fallback, min, max], name);
		}
	});

	test('the five commands are contributed, registered in one file and pushed onto the subscriptions', () => {
		const commands = ['entirely.disableCapture', 'entirely.uninstallEntire', 'entirely.configureEntire', 'entirely.cleanSessionData', 'entirely.setUpRunners'];
		const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			contributes: { commands: { command: string }[]; menus: Record<string, { command: string; when?: string }[]> };
		};
		const source = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'captureCommands.ts'), 'utf8');
		for (const command of commands) {
			assert.ok(manifest.contributes.commands.some(entry => entry.command === command), `${command} is not contributed`);
			assert.ok(source.includes(`registerCommand('${command}'`), `${command} is not registered`);
		}
		assert.match(source, /context\.subscriptions\.push\(\s*vscode\.commands\.registerCommand\('entirely\.disableCapture'/);
		assert.strictEqual((source.match(/registerCommand\(/g) ?? []).length, 5);
		assert.match(fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8'), /registerCaptureCommands\(context,/);
		const session = manifest.contributes.menus['view/item/context'].find(entry => entry.command === 'entirely.cleanSessionData');
		assert.match(session?.when ?? '', /entirely\.sessions/);
	});

	test('the commands are registered in the running extension, and the settings are read', async () => {
		const vscode = await import('vscode');
		await vscode.extensions.getExtension('greysquirr3l.entirely')?.activate();
		const registered = await vscode.commands.getCommands(true);
		for (const command of ['entirely.disableCapture', 'entirely.uninstallEntire', 'entirely.configureEntire', 'entirely.cleanSessionData', 'entirely.setUpRunners']) {
			assert.ok(registered.includes(command), `${command} is not registered`);
		}
		const settings = readExtensionSettings();
		assert.strictEqual(settings.captureControlTimeout, 60);
		assert.strictEqual(settings.runnerSetupTimeout, 300);
	});
});
