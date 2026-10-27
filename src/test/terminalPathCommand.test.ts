import * as assert from 'assert';
import * as vscode from 'vscode';

import { availableScopes, explainRepair } from '../commands/terminalPath';
import type { CliRunner } from '../services/cli';
import type { CliDiscovery } from '../services/cli/types';
import type { RepairPlan } from '../services/terminalPath';

suite('Entire terminal PATH command', () => {
	test('offers the folder scope when there is a folder to point at', () => {
		const resource = vscode.Uri.file('/tmp/a-folder');
		const scopes = availableScopes({
			platform: 'linux',
			resource,
			hasWorkspace: true,
		});

		assert.deepStrictEqual(scopes, ['folder', 'workspace', 'user']);
	});

	test('offers the workspace and user scopes without a folder', () => {
		const scopes = availableScopes({
			platform: 'linux',
			resource: undefined,
			hasWorkspace: true,
		});

		assert.deepStrictEqual(scopes, ['workspace', 'user']);
	});

	test('offers the user scope when there is no workspace at all', () => {
		const scopes = availableScopes({
			platform: 'linux',
			resource: undefined,
			hasWorkspace: false,
		});

		assert.deepStrictEqual(scopes, ['user']);
	});

	test('says what an added directory does', () => {
		const plan: RepairPlan = {
			scope: 'user',
			action: 'add',
			setting: 'terminal.integrated.env.linux',
			value: { PATH: '${env:PATH}:/home/dev/.local/bin' },
			directory: '/home/dev/.local/bin',
			segment: 'linux',
		};

		assert.strictEqual(
			explainRepair(plan),
			'Added /home/dev/.local/bin to the terminal PATH in Your user settings, as terminal.integrated.env.linux.',
		);
	});

	test('says what a removed directory does', () => {
		const plan: RepairPlan = {
			scope: 'workspace',
			action: 'remove',
			setting: 'terminal.integrated.env.linux',
			value: { PATH: '${env:PATH}' },
			directory: '/home/dev/.local/bin',
			segment: 'linux',
		};

		assert.strictEqual(
			explainRepair(plan),
			'Took /home/dev/.local/bin off the terminal PATH in This workspace.',
		);
	});
});
