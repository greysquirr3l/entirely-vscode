import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { repairTerminalPath } from '../commands/terminalPath';
import { writeSetting } from './support/settings';
import { INHERITED_PATH, platformSegment, terminalEnvSetting } from '../lib/terminalPath';
import type { CliRunner } from '../services/cli';
import type { CliDiscovery } from '../services/cli/types';

const EXTENSION_ID = 'greysquirr3l.entirely';

suite('Entire terminal PATH repair flow', function () {
	this.timeout(30_000);

	const segment = platformSegment(process.platform);
	assert.ok(segment, 'the editor does not name a terminal environment for this platform');

	const KEY = terminalEnvSetting(segment);

	/** The values the scopes held before the test, so they can be put back. */
	let saved: { target: vscode.ConfigurationTarget; value: unknown }[] = [];

	setup(async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension '${EXTENSION_ID}' was not loaded by the test host`);
		await extension.activate();

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		saved = [
			{ target: vscode.ConfigurationTarget.Global, value: inspected?.globalValue },
			{ target: vscode.ConfigurationTarget.Workspace, value: inspected?.workspaceValue },
		];

		// The test starts from a known state, so a value left behind by
		// another test cannot be mistaken for one this test wrote.
		await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
		await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Workspace);
	});

	teardown(async () => {
		for (const entry of saved) {
			await writeSetting(KEY, entry.value, entry.target);
		}
		saved = [];
	});

	/** A runner that always finds the CLI in one directory. */
	function runnerFor(directory: string): CliRunner {
		const discovery: CliDiscovery = {
			state: 'available',
			path: path.join(directory, 'entire'),
			location: 'install-location',
			directory,
			version: '1.0.0',
		};

		return { discover: async () => discovery } as unknown as CliRunner;
	}

	/**
	 * Answers the editor's own prompts for the length of a test.
	 *
	 * The prompt for the scope is answered with a scope, and the
	 * confirmation is answered with a label. A prompt that is not
	 * answered stands the test up, because the editor waits for it.
	 */
	function withPrompts(
		answers: { scope?: unknown; confirm?: unknown },
		run: () => Promise<void>,
	): Promise<void> {
		const quickPick = vscode.window.showQuickPick;
		const warning = vscode.window.showWarningMessage;
		const information = vscode.window.showInformationMessage;
		const error = vscode.window.showErrorMessage;

		const window = vscode.window as unknown as Record<string, unknown>;

		window.showQuickPick = async () =>
			answers.scope === undefined ? undefined : { scope: answers.scope };
		window.showWarningMessage = async () => answers.confirm;
		window.showInformationMessage = async () => undefined;
		window.showErrorMessage = async () => undefined;

		return run().finally(() => {
			window.showQuickPick = quickPick;
			window.showWarningMessage = warning;
			window.showInformationMessage = information;
			window.showErrorMessage = error;
		});
	}

	test('the repair command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('entirely.repairTerminalPath'));
	});

	test('the command reports a CLI that is not installed and writes nothing', async () => {
		const runner = { discover: async () => ({ state: 'absent' }) } as unknown as CliRunner;

		await withPrompts({}, () => repairTerminalPath({ runner }));

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.strictEqual(inspected?.globalValue, undefined);
		assert.strictEqual(inspected?.workspaceValue, undefined);
	});

	test('the command writes nothing until the user has chosen a scope', async () => {
		const directory = path.join('/tmp', 'entire-repair-flow');

		await withPrompts({}, () => repairTerminalPath({ runner: runnerFor(directory) }));

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.strictEqual(inspected?.globalValue, undefined);
		assert.strictEqual(inspected?.workspaceValue, undefined);
	});

	test('the command writes nothing until the user has confirmed', async () => {
		const directory = path.join('/tmp', 'entire-repair-flow');

		await withPrompts({ scope: 'user' }, () =>
			repairTerminalPath({ runner: runnerFor(directory) }),
		);

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		assert.strictEqual(inspected?.globalValue, undefined);
		assert.strictEqual(inspected?.workspaceValue, undefined);
	});

	test('the command writes to the scope the user chose', async () => {
		const directory = path.join('/tmp', 'entire-repair-flow');

		await withPrompts({ scope: 'user', confirm: 'Add It' }, () =>
			repairTerminalPath({ runner: runnerFor(directory) }),
		);

		const inspected = vscode.workspace.getConfiguration().inspect(KEY);
		const written = inspected?.globalValue as Record<string, unknown> | undefined;

		assert.ok(written, 'the repair was not written to the user settings');
		assert.strictEqual(written.PATH, `${INHERITED_PATH}:${directory}`);

		// The workspace was not touched.
		assert.strictEqual(inspected?.workspaceValue, undefined);
	});
});
