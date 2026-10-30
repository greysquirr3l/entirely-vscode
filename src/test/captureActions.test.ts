import * as assert from 'assert';

import {
	NO_UNINSTALL_LIST,
	captureConfirmationFor,
	currentSettingValues,
	describeCannot,
	describeCaptureOutcome,
	describeSettingChange,
	describeUninstallList,
	describeVerdicts,
	effectiveValue,
	folderName,
	isSessionDataList,
	parseCleanScopes,
	parseUninstallList,
	verifyCleaned,
	verifyDisabled,
	verifySettings,
	verifyUninstalled,
	type ConfirmationFacts,
	type SettingsLayerReading,
	type WorkspaceStatus,
} from '../lib/entire';
import { CLEAN_HELP, DISABLE_HELP } from './support/captureCli';

const FOLDER = '/work/widgets';
const ACTING = { handle: 'alice', name: 'work' };
const TRACKED: WorkspaceStatus = { kind: 'tracked', enabled: true, agents: ['a'], activeSessions: [], agentHelp: undefined, checkpointSyncRemote: undefined, checkpointSyncRemoteSource: undefined, checkpointPushDisabled: undefined };
const OFF: WorkspaceStatus = { kind: 'not-set-up', enabled: false, reason: 'off' };

function facts(extra: Partial<ConfirmationFacts> = {}): ConfirmationFacts {
	return { folder: FOLDER, acting: ACTING, liveSessions: [], ...extra };
}

suite('Capture control: confirmations', () => {
	test('every question names the folder, the login and that it changes this checkout only', () => {
		const actions = [
			captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ settingsFile: '.entire/settings.local.json' })),
			captureConfirmationFor({ kind: 'uninstall' }, facts({ uninstallList: ['a'] })),
			captureConfirmationFor({ kind: 'clean', scope: { kind: 'head' } }, facts({ hasPreview: true })),
			captureConfirmationFor({ kind: 'configure', changes: [{ key: 'telemetry', value: false }], target: 'local' }, facts({ settingsFile: '.entire/settings.local.json' })),
			captureConfirmationFor({ kind: 'runner-defaults', options: {} }, facts()),
			captureConfirmationFor({ kind: 'runner-print-prompt', options: {} }, facts()),
			captureConfirmationFor({ kind: 'runner-dry-run', options: {} }, facts()),
			captureConfirmationFor({ kind: 'runner-tailor', options: {} }, facts()),
		];
		for (const prompt of actions) {
			assert.match(prompt.message, /widgets/, prompt.message);
			assert.match(prompt.detail, new RegExp(FOLDER), prompt.message);
			assert.match(prompt.detail, /alice \(login work\)/, prompt.message);
			assert.match(prompt.detail, /this checkout on this machine only/, prompt.message);
		}
	});

	test('a login with the same name as its handle is named once, and no login is said plainly', () => {
		const same = captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ acting: { handle: 'bob', name: 'bob' } }));
		assert.match(same.detail, /as bob in/);
		const none = captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ acting: undefined }));
		assert.match(none.detail, /no saved login/);
	});

	test('disable names the file it writes and says nothing is removed', () => {
		const prompt = captureConfirmationFor({ kind: 'disable', target: 'project' }, facts({ settingsFile: '.entire/settings.json' }));
		assert.match(prompt.detail, /writes \.entire\/settings\.json/i);
		assert.match(prompt.detail, /Nothing is removed/);
		assert.strictEqual(prompt.requireTyped, undefined);
	});

	test('disable lists live sessions, and omits the sentence when there are none', () => {
		const live = captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ liveSessions: ['s1 (agent on main)', 's2 (agent)'] }));
		assert.match(live.detail, /2 sessions are live: s1 \(agent on main\), s2 \(agent\)\. They will stop being recorded/);
		const none = captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ liveSessions: [] }));
		assert.doesNotMatch(none.detail, /live/);
		const unknown = captureConfirmationFor({ kind: 'disable', target: 'local' }, facts({ liveSessions: undefined }));
		assert.match(unknown.detail, /could not read which sessions are live/);
	});

	test('uninstall says there is no preview, lists what the help says, names the hook files and needs the folder name typed', () => {
		const prompt = captureConfirmationFor(
			{ kind: 'uninstall' },
			facts({ uninstallList: parseUninstallList(DISABLE_HELP), hookFiles: ['.github/hooks/entire.json', '.codex/hooks.json'] }),
		);
		assert.match(prompt.detail, /no preview/);
		assert.match(prompt.detail, /- \.entire\/ directory \(settings, logs, metadata\)/);
		assert.match(prompt.detail, /- Agent hooks/);
		assert.match(prompt.detail, /\.github\/hooks\/entire\.json, \.codex\/hooks\.json/);
		assert.match(prompt.detail, /cannot be undone by Entirely/);
		assert.match(prompt.detail, /Commits and checkpoints already pushed are not touched/);
		assert.strictEqual(prompt.requireTyped, 'widgets');
		assert.strictEqual(prompt.action, 'Remove Entire');
	});

	test('uninstall drops the claim about pushed checkpoints when the help list mentions checkpoints, and says when it lists nothing', () => {
		const mentions = captureConfirmationFor({ kind: 'uninstall' }, facts({ uninstallList: ['The checkpoint remote'] }));
		assert.doesNotMatch(mentions.detail, /already pushed are not touched/);
		const empty = captureConfirmationFor({ kind: 'uninstall' }, facts({ uninstallList: [] }));
		assert.match(empty.detail, new RegExp(NO_UNINSTALL_LIST));
		assert.match(empty.detail, /found no hook files/);
	});

	test('describeUninstallList reads the bullets with their continuation lines, and falls back plainly', () => {
		const list = parseUninstallList(DISABLE_HELP);
		assert.strictEqual(list.length, 5);
		assert.match(list[1], /^Git hooks .*restoring any hooks Entire backed up$/);
		assert.match(list[3], /Shadow branches/);
		assert.match(describeUninstallList(DISABLE_HELP), /^- \.entire\//);
		assert.strictEqual(describeUninstallList('entire disable\nFlags:\n      --force   Skip\n'), NO_UNINSTALL_LIST);
	});

	test('parseCleanScopes reads the default list and the list for everything', () => {
		const lists = parseCleanScopes(CLEAN_HELP);
		assert.strictEqual(lists.head.length, 2);
		assert.match(lists.head[0], /Session state files/);
		assert.match(lists.head[1], /Legacy shadow branches .*entire\/<commit-hash>-<worktree-hash>/);
		assert.strictEqual(lists.all.length, 3);
		assert.match(lists.all[2], /Temporary files/);
		assert.deepStrictEqual(parseCleanScopes('nothing here'), { head: [], all: [] });
		assert.strictEqual(isSessionDataList(lists.head), true);
		assert.strictEqual(isSessionDataList(['Session files', 'Your source code']), false);
	});

	test('clean names the preview, the live sessions and the skipped guard; its button reads Delete anyway only with a live session', () => {
		const lists = parseCleanScopes(CLEAN_HELP);
		const live = captureConfirmationFor(
			{ kind: 'clean', scope: { kind: 'head' } },
			facts({ liveSessions: ['s-live (agent on main)'], cleanList: lists.head, hasPreview: true, previewSummary: 'Would delete: 2 (3 lines)' }),
		);
		assert.strictEqual(live.action, 'Delete anyway');
		assert.match(live.detail, /1 session is live: s-live \(agent on main\)\. Cleaning removes their state and they stop being recorded/);
		assert.match(live.detail, /Preview, in the CLI's own words/);
		assert.match(live.detail, /Would delete: 2/);
		assert.match(live.detail, /overrides its own live-session guard/);
		assert.match(live.detail, /Checkpoints already recorded are not on that list/);
		assert.strictEqual(live.requireTyped, undefined);
		const quiet = captureConfirmationFor({ kind: 'clean', scope: { kind: 'head' } }, facts({ cleanList: lists.head, hasPreview: true }));
		assert.strictEqual(quiet.action, 'Delete');
	});

	test('clean of everything, or with no preview, needs the folder name typed and says there is no preview', () => {
		const all = captureConfirmationFor({ kind: 'clean', scope: { kind: 'all' } }, facts({ hasPreview: true }));
		assert.strictEqual(all.requireTyped, 'widgets');
		const blind = captureConfirmationFor({ kind: 'clean', scope: { kind: 'head' } }, facts({ hasPreview: false }));
		assert.strictEqual(blind.requireTyped, 'widgets');
		assert.match(blind.detail, /no preview/);
		const unrelated = captureConfirmationFor({ kind: 'clean', scope: { kind: 'head' } }, facts({ hasPreview: true, cleanList: ['Your source code'] }));
		assert.doesNotMatch(unrelated.detail, /Checkpoints already recorded/);
	});

	test('configure lists exactly the changes with old and new values, and warns about the backend migration', () => {
		const prompt = captureConfirmationFor(
			{ kind: 'configure', target: 'local', changes: [{ key: 'telemetry', value: false }, { key: 'checkpointBackend', value: 'refs' }, { key: 'reinstallHook' }] },
			facts({ settingsFile: '.entire/settings.local.json', currentValues: { telemetry: 'on' } }),
		);
		assert.match(prompt.detail, /- telemetry: on -> off in \.entire\/settings\.local\.json/);
		assert.match(prompt.detail, /- checkpoint backend: not set -> refs in .*this migrates storage for the repository and is not offered as a one-click undo/);
		assert.match(prompt.detail, /- git hook: reinstalled/);
		assert.match(prompt.detail, /Nothing else is written/);
		assert.strictEqual(describeSettingChange({ key: 'summaryTimeout', value: 0 }, { settingsFile: 'f' }), 'summary timeout (seconds): not set -> 0 in f');
	});

	test('runner defaults and the prompt call no provider; a preview and a tailoring say what is sent', () => {
		const defaults = captureConfirmationFor({ kind: 'runner-defaults', options: {} }, facts());
		assert.match(defaults.detail, /No summary provider is called/);
		const prompt = captureConfirmationFor({ kind: 'runner-print-prompt', options: {} }, facts());
		assert.match(prompt.detail, /Creates the default runner files .* if they are missing/);
		assert.match(prompt.detail, /no summary provider/);
		const preview = captureConfirmationFor({ kind: 'runner-dry-run', options: {} }, facts());
		assert.match(preview.detail, /sends signals about this repository \(its docs and structure, merged pull requests and issues, checkpoint hotspots and past trail findings\) to the summary provider Entire is configured with/);
		assert.match(preview.detail, /The preview writes nothing/);
		const tailor = captureConfirmationFor({ kind: 'runner-tailor', options: { runner: 'risk' } }, facts({ agent: 'codex', sources: ['repo', 'prs'] }));
		assert.match(tailor.detail, /for this run only, the agent codex/);
		assert.match(tailor.detail, /rewrites \.entire\/runners\/\*\.json; review the result with git diff/);
		assert.match(tailor.detail, /Data sources: repo, prs/);
		assert.match(tailor.detail, /Only the runner risk is tuned/);
	});

	test('folderName takes the last segment of a path', () => {
		assert.strictEqual(folderName('/a/b/widgets'), 'widgets');
		assert.strictEqual(folderName('/a/b/widgets/'), 'widgets');
		assert.strictEqual(folderName('C:\\work\\widgets'), 'widgets');
	});
});

suite('Capture control: outcomes and verdicts', () => {
	test('describes each outcome, and unconfirmed is never worded as done', () => {
		assert.match(describeCaptureOutcome({ kind: 'done', summary: 'Capture is off.', lines: ['x'] }), /Capture is off\.\n- x/);
		const unconfirmed = describeCaptureOutcome({ kind: 'unconfirmed', detail: 'still enabled', lines: [] });
		assert.match(unconfirmed, /^Unconfirmed: still enabled/);
		assert.doesNotMatch(unconfirmed, /done|verified/i);
		assert.match(describeCaptureOutcome({ kind: 'failed', detail: 'boom', lines: ['left: x'] }), /^Failed: boom\n- left: x/);
		assert.match(describeCaptureOutcome({ kind: 'cancelled' }), /Nothing was changed/);
		assert.strictEqual(describeCaptureOutcome({ kind: 'no-cli', detail: 'missing' }), 'missing');
	});

	test('describeCannot names the version, the missing roles and the terminal way forward', () => {
		const text = describeCannot('clean session data', 'clean', '0.1.0', ['preview flag']);
		assert.match(text, /\(0\.1\.0\)/);
		assert.match(text, /does not describe the preview flag/);
		assert.match(text, /entire clean --help.* in a terminal/);
	});

	test('verifyDisabled judges by the status after', () => {
		assert.deepStrictEqual(verifyDisabled(TRACKED, OFF), { kind: 'verified' });
		assert.deepStrictEqual(verifyDisabled(TRACKED, TRACKED), { kind: 'still-enabled' });
		assert.deepStrictEqual(verifyDisabled(TRACKED, undefined), { kind: 'unreadable' });
		assert.deepStrictEqual(verifyDisabled(OFF, OFF), { kind: 'unchanged' });
		assert.deepStrictEqual(verifyDisabled(undefined, OFF), { kind: 'verified' });
	});

	test('verifyUninstalled lists what remains', () => {
		assert.deepStrictEqual(verifyUninstalled(OFF, { entireDirectoryPresent: false, hookFilesLeft: [] }), { complete: true, remaining: [] });
		const partial = verifyUninstalled(TRACKED, { entireDirectoryPresent: true, hookFilesLeft: ['.codex/hooks.json'] });
		assert.strictEqual(partial.complete, false);
		assert.strictEqual(partial.remaining.length, 3);
		assert.match(partial.remaining.join('\n'), /\.codex\/hooks\.json/);
		assert.strictEqual(verifyUninstalled(undefined, { entireDirectoryPresent: undefined, hookFilesLeft: [] }).complete, false);
	});

	test('verifyCleaned: one session must be gone, everything must be gone, the default scope may leave others', () => {
		assert.deepStrictEqual(verifyCleaned(['a', 'b'], ['b'], { kind: 'session', id: 'a' }), { kind: 'done', gone: ['a'], remaining: [] });
		assert.strictEqual(verifyCleaned(['a', 'b'], ['a', 'b'], { kind: 'session', id: 'a' }).kind, 'unconfirmed');
		assert.deepStrictEqual(verifyCleaned(['a', 'b'], [], { kind: 'all' }), { kind: 'done', gone: ['a', 'b'], remaining: [] });
		assert.strictEqual(verifyCleaned(['a', 'b'], ['b'], { kind: 'all' }).kind, 'unconfirmed');
		assert.deepStrictEqual(verifyCleaned(['a', 'b'], ['b'], { kind: 'head' }), { kind: 'done', gone: ['a'], remaining: ['b'] });
		assert.strictEqual(verifyCleaned(['a'], undefined, { kind: 'head' }).kind, 'unconfirmed');
	});

	const LOCAL = '.entire/settings.local.json';
	const SHARED = '.entire/settings.json';
	function layers(local: SettingsLayerReading['settings'], shared: SettingsLayerReading['settings']): SettingsLayerReading[] {
		return [
			{ file: LOCAL, target: 'local', settings: local },
			{ file: SHARED, target: 'project', settings: shared },
		];
	}

	test('verifySettings: verified, written-not-readable and mismatch', () => {
		const verdicts = verifySettings(
			[{ key: 'telemetry', value: false }, { key: 'summaryModel', value: 'm' }, { key: 'checkpointRemote', value: 'github:acme/cp' }],
			layers({ telemetry: false, checkpointRemote: { provider: 'github', repo: 'acme/other' } }, undefined),
			'local',
		);
		assert.deepStrictEqual(verdicts[0], { key: 'telemetry', status: 'verified', value: 'off', file: LOCAL });
		assert.deepStrictEqual(verdicts[1], { key: 'summaryModel', status: 'written-not-readable' });
		assert.strictEqual(verdicts[2].status, 'mismatch');
		const lines = describeVerdicts(verdicts);
		assert.match(lines[0], /telemetry: off \(read back from \.entire\/settings\.local\.json\)/);
		assert.match(lines[1], /written; the editor cannot read this setting back/);
		assert.match(lines[2], /is github:acme\/other in .*not github:acme\/cp/);
	});

	test('verifySettings: a value missing after the write, and a value a higher layer overrides, are mismatches', () => {
		const missing = verifySettings([{ key: 'telemetry', value: false }], layers(undefined, undefined), 'local');
		assert.strictEqual(missing[0].status, 'mismatch');
		const overridden = verifySettings([{ key: 'telemetry', value: false }], layers({ telemetry: true }, { telemetry: false }), 'project');
		assert.strictEqual(overridden[0].status, 'mismatch');
		assert.match(describeVerdicts(overridden)[0], /\.entire\/settings\.local\.json sets it to on and takes precedence/);
		const agrees = verifySettings([{ key: 'telemetry', value: false }], layers({ telemetry: false }, { telemetry: false }), 'project');
		assert.strictEqual(agrees[0].status, 'verified');
	});

	test('current values come from the first layer that sets them, with the file', () => {
		const both = layers({ telemetry: false }, { telemetry: true, absoluteGitHookPath: true, checkpointType: 'refs' });
		assert.deepStrictEqual(effectiveValue(both, 'telemetry'), { value: 'off', file: LOCAL });
		assert.deepStrictEqual(effectiveValue(both, 'absoluteHookPath'), { value: 'on', file: SHARED });
		assert.strictEqual(effectiveValue(both, 'summaryModel'), undefined);
		assert.deepStrictEqual(currentSettingValues(both), { telemetry: 'off', absoluteHookPath: 'on', checkpointBackend: 'refs' });
	});
});
