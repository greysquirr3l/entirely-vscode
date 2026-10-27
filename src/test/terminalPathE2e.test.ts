import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { pathSeparator, platformSegment, terminalEnvSetting } from '../lib/terminalPath';
import { writeSetting } from './support/settings';
import {
	onTerminalPath,
	planRepair,
	readScopeEnv,
	readTerminalEnv,
	writeRepair,
} from '../services/terminalPath';

suite('Entire terminal PATH against the real editor', function () {
	this.timeout(30_000);

	const segment = platformSegment(process.platform);
	assert.ok(segment, 'the editor does not name a terminal environment for this platform');

	const KEY = terminalEnvSetting(segment);
	const SEPARATOR = pathSeparator(process.platform);
	const DIRECTORY = path.join(os.tmpdir(), 'entire-terminal-path');

	/** The values the scopes held before the test, so they can be put back. */
	let saved: { target: vscode.ConfigurationTarget; value: unknown }[] = [];

	setup(() => {
		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		saved = [
			{
				target: vscode.ConfigurationTarget.Global,
				value: inspected?.globalValue,
			},
			{
				target: vscode.ConfigurationTarget.Workspace,
				value: inspected?.workspaceValue,
			},
		];
	});

	teardown(async () => {
		for (const entry of saved) {
			await writeSetting(KEY, entry.value, entry.target);
		}
		saved = [];
	});

	/** Writes a value at a scope. */
	async function write(value: unknown, target: vscode.ConfigurationTarget): Promise<void> {
		await writeSetting(KEY, value, target);
	}

	test('the editor keeps the terminal environment in a per-platform setting', () => {
		assert.strictEqual(KEY, `terminal.integrated.env.${segment}`);

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.ok(inspected, `the editor does not know the setting '${KEY}'`);
	});

	test('knows when the terminal can see the directory', async () => {
		// Nothing is set, so the terminal has the PATH the editor's own
		// process has.
		assert.strictEqual(onTerminalPath(DIRECTORY), false);

		await write(
			{ PATH: `${'${env:PATH}'}${SEPARATOR}${DIRECTORY}` },
			vscode.ConfigurationTarget.Global,
		);

		assert.strictEqual(onTerminalPath(DIRECTORY), true);
	});

	test('knows when the terminal can see the directory it inherits', () => {
		const inherited = process.env['PATH']?.split(SEPARATOR)[0];

		if (!inherited) {
			return;
		}

		// The setting inherits the PATH the editor's process has, so the
		// directory the process has is one the terminal has too.
		assert.strictEqual(onTerminalPath(inherited), true);
	});

	test('adds the directory to the PATH and leaves the other variables alone', async () => {
		await write({ EDITOR: 'vim', PATH: `${'${env:PATH}'}${SEPARATOR}/opt/tools` }, vscode.ConfigurationTarget.Global);

		const planned = planRepair({
			directory: DIRECTORY,
			scope: 'user',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		assert.strictEqual(planned.plan.action, 'add');
		assert.strictEqual(planned.plan.setting, KEY);
		assert.strictEqual(planned.plan.value.EDITOR, 'vim');
		assert.strictEqual(
			planned.plan.value.PATH,
			`${'${env:PATH}'}${SEPARATOR}/opt/tools${SEPARATOR}${DIRECTORY}`,
		);

		const result = await writeRepair(planned.plan);
		assert.strictEqual(result.kind, 'applied');

		const effective = readTerminalEnv(KEY);
		assert.strictEqual(effective.EDITOR, 'vim');
		assert.strictEqual(
			effective.PATH,
			`${'${env:PATH}'}${SEPARATOR}/opt/tools${SEPARATOR}${DIRECTORY}`,
		);
	});

	test('writes to the scope the user chose and nowhere else', async () => {
		await write({ WORKSPACEVAR: 'w' }, vscode.ConfigurationTarget.Workspace);
		await write({ GLOBALVAR: 'g' }, vscode.ConfigurationTarget.Global);

		const planned = planRepair({
			directory: DIRECTORY,
			scope: 'workspace',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		await writeRepair(planned.plan);

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);

		// The workspace holds the change.
		assert.strictEqual(
			(inspected?.workspaceValue as Record<string, unknown> | undefined)?.PATH,
			`${'${env:PATH}'}${SEPARATOR}${DIRECTORY}`,
		);

		// The user settings are exactly as they were.
		assert.strictEqual(
			(inspected?.globalValue as Record<string, unknown> | undefined)?.PATH,
			undefined,
		);
		assert.strictEqual(
			(inspected?.globalValue as Record<string, unknown> | undefined)?.GLOBALVAR,
			'g',
		);

		// The workspace's own variable survived the write.
		assert.strictEqual(
			(inspected?.workspaceValue as Record<string, unknown> | undefined)?.WORKSPACEVAR,
			'w',
		);
	});

	test('takes the directory off the PATH again', async () => {
		await write(
			{ PATH: `${'${env:PATH}'}${SEPARATOR}${DIRECTORY}` },
			vscode.ConfigurationTarget.Global,
		);

		const planned = planRepair({
			directory: DIRECTORY,
			scope: 'user',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		assert.strictEqual(planned.plan.action, 'remove');
		assert.strictEqual(planned.plan.value.PATH, '${env:PATH}');

		await writeRepair(planned.plan);

		assert.strictEqual(readTerminalEnv(KEY).PATH, '${env:PATH}');
	});

	test('keeps the PATH the user already had at the scope it is written to', async () => {
		await write(
			{ PATH: `${'${env:PATH}'}${SEPARATOR}/opt/tools`, EDITOR: 'vim' },
			vscode.ConfigurationTarget.Global,
		);

		const planned = planRepair({
			directory: DIRECTORY,
			scope: 'user',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		await writeRepair(planned.plan);

		const atScope = readScopeEnv(KEY, 'user');
		assert.strictEqual(
			atScope.PATH,
			`${'${env:PATH}'}${SEPARATOR}/opt/tools${SEPARATOR}${DIRECTORY}`,
		);
		assert.strictEqual(atScope.EDITOR, 'vim');
	});

	test('says so when a more specific scope holds the PATH back', async () => {
		const directory = path.join(os.tmpdir(), 'entire-terminal-path');

		// The workspace holds a PATH of its own, so a change written to
		// the user settings will not reach the terminal.
		await write({ PATH: `${'${env:PATH}'}${SEPARATOR}/opt/tools` }, vscode.ConfigurationTarget.Workspace);

		const planned = planRepair({
			directory,
			scope: 'user',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		const result = await writeRepair(planned.plan);

		assert.strictEqual(result.kind, 'shadowed');
		if (result.kind !== 'shadowed') {
			return;
		}

		assert.strictEqual(result.by, 'workspace');

		// The change was still written where the user asked for it.
		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.strictEqual(
			(inspected?.globalValue as Record<string, unknown> | undefined)?.PATH,
			`${'${env:PATH}'}${SEPARATOR}${directory}`,
		);
	});

	test('does not carry a more specific scope’s PATH into a less specific one', async () => {
		const directory = path.join(os.tmpdir(), 'entire-terminal-path');

		// The user settings hold a PATH of their own, and the workspace
		// holds a different one.
		await write(
			{ PATH: `${'${env:PATH}'}${SEPARATOR}/opt/tools` },
			vscode.ConfigurationTarget.Global,
		);
		await write(
			{ PATH: `${'${env:PATH}'}${SEPARATOR}/workspace/tools` },
			vscode.ConfigurationTarget.Workspace,
		);

		const planned = planRepair({
			directory,
			scope: 'user',
			platform: process.platform,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		await writeRepair(planned.plan);

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		const global = inspected?.globalValue as Record<string, unknown> | undefined;

		// The user keeps the PATH they had, with the directory added.
		assert.strictEqual(
			global?.PATH,
			`${'${env:PATH}'}${SEPARATOR}/opt/tools${SEPARATOR}${directory}`,
		);

		// The workspace’s PATH was not written into the user settings,
		// which would carry one workspace’s PATH into every window.
		assert.ok(
			!String(global?.PATH).includes('/workspace/tools'),
			'the workspace’s PATH was written into the user settings',
		);

		// The workspace still holds the PATH it had.
		assert.strictEqual(
			(inspected?.workspaceValue as Record<string, unknown> | undefined)?.PATH,
			`${'${env:PATH}'}${SEPARATOR}/workspace/tools`,
		);
	});

	test('the editor refuses a change in the folder scope for this setting', async () => {
		const resource = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!resource) {
			return;
		}

		const planned = planRepair({
			directory: DIRECTORY,
			scope: 'folder',
			platform: process.platform,
			resource,
		});

		assert.strictEqual(planned.kind, 'planned');
		if (planned.kind !== 'planned') {
			return;
		}

		const result = await writeRepair(planned.plan, resource);

		if (result.kind === 'refused') {
			// The editor does not let this setting be set per folder. The
			// refusal is reported rather than being widened to another
			// scope.
			assert.strictEqual(result.refusal.kind, 'scope-refused');
			assert.strictEqual(result.refusal.scope, 'folder');
			return;
		}

		// If a later editor does allow it, the change must still have
		// gone to the folder and nowhere else.
		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.strictEqual(
			(inspected?.workspaceFolderValue as Record<string, unknown> | undefined)?.PATH,
			`${'${env:PATH}'}${SEPARATOR}${DIRECTORY}`,
		);
		assert.strictEqual(
			(inspected?.workspaceValue as Record<string, unknown> | undefined)?.PATH,
			undefined,
		);
	});
});
