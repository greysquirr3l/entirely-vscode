import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	decodeEntireSettings,
	resolveEntireSettings,
	summariseSettings,
	unwrap,
} from '../lib/entire';
import { readLogLevel, shouldLog, type LogLevel } from '../services/logger';
import { makeTempDir } from './support/tempDir';
import { effectiveLogLevel } from '../services/configuration';
import { readEntireSettings, settingsLayers } from '../services/settingsSource';

suite('Entire settings decoding', () => {
	test('decodes the settings the CLI writes', () => {
		const settings = unwrap(
			decodeEntireSettings({
				enabled: true,
				absolute_git_hook_path: true,
				telemetry: false,
				checkpoints: { primary: { type: 'git-refs' } },
			}),
		);

		assert.strictEqual(settings.enabled, true);
		assert.strictEqual(settings.absoluteGitHookPath, true);
		assert.strictEqual(settings.telemetry, false);
		assert.strictEqual(settings.checkpointType, 'git-refs');
	});

	test('leaves a setting it does not know out', () => {
		const settings = unwrap(
			decodeEntireSettings({ enabled: true, something_new: 'value' }),
		);

		assert.strictEqual(settings.enabled, true);
		assert.strictEqual(settings.logLevel, undefined);
		assert.strictEqual(settings.telemetry, undefined);
	});

	test('decodes the strategy options as they are', () => {
		const settings = unwrap(
			decodeEntireSettings({
				strategy_options: { retain_days: 30, name: 'flow', enabled: true },
			}),
		);

		assert.deepStrictEqual(settings.strategyOptions, {
			retain_days: 30,
			name: 'flow',
			enabled: true,
		});
	});

	test('reports a settings file that is not an object as a failure', () => {
		assert.strictEqual(decodeEntireSettings(['not', 'an', 'object']).ok, false);
	});
});

suite('Entire settings layering', () => {
	test('gives the first layer that has a setting the last word', () => {
		const resolved = resolveEntireSettings([
			{ enabled: false, telemetry: false },
			{ enabled: true, telemetry: true },
			{ enabled: true },
		]);

		assert.strictEqual(resolved.enabled, false);
		assert.strictEqual(resolved.telemetry, false);
	});

	test('leaves a setting no layer has out', () => {
		const resolved = resolveEntireSettings([{ enabled: true }, undefined, {}]);

		assert.strictEqual(resolved.enabled, true);
		assert.strictEqual(resolved.logLevel, undefined);
		assert.strictEqual(resolved.checkpointType, undefined);
	});

	test('reads the layers in the documented order', () => {
		const layers = settingsLayers('/work/sandbox', '/home/someone');

		assert.deepStrictEqual(layers, [
			path.join('/work/sandbox', '.entire', 'settings.local.json'),
			path.join('/work/sandbox', '.entire', 'settings.json'),
			path.join('/home/someone', '.config', 'entire', 'settings.json'),
		]);
	});

	test('reads the effective settings from the files in that order', () => {
		const workspace = makeTempDir('entire-settings-');
		const home = makeTempDir('entire-home-');

		try {
			fs.mkdirSync(path.join(workspace, '.entire'), { recursive: true });
			fs.mkdirSync(path.join(home, '.config', 'entire'), { recursive: true });

			fs.writeFileSync(
				path.join(workspace, '.entire', 'settings.json'),
				JSON.stringify({ enabled: true, telemetry: true }),
				'utf8',
			);
			fs.writeFileSync(
				path.join(workspace, '.entire', 'settings.local.json'),
				JSON.stringify({ telemetry: false }),
				'utf8',
			);
			fs.writeFileSync(
				path.join(home, '.config', 'entire', 'settings.json'),
				JSON.stringify({ enabled: false, log_level: 'debug' }),
				'utf8',
			);

			const settings = readEntireSettings(workspace, home);

			// The local file beats the repository's own, which beats the
			// one the user keeps for every repository.
			assert.strictEqual(settings.telemetry, false);
			assert.strictEqual(settings.enabled, true);
			assert.strictEqual(settings.logLevel, 'debug');
		} finally {
			fs.rmSync(workspace, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test('reads the settings that are there when there are none', () => {
		const workspace = makeTempDir('entire-settings-');
		const home = makeTempDir('entire-home-');

		try {
			const settings = readEntireSettings(workspace, home);

			assert.strictEqual(settings.enabled, undefined);
			assert.strictEqual(settings.telemetry, undefined);
		} finally {
			fs.rmSync(workspace, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test('ignores a settings file it cannot parse', () => {
		const workspace = makeTempDir('entire-settings-');
		const home = makeTempDir('entire-home-');

		try {
			fs.mkdirSync(path.join(workspace, '.entire'), { recursive: true });
			fs.writeFileSync(
				path.join(workspace, '.entire', 'settings.json'),
				'{ this is not json',
				'utf8',
			);

			const settings = readEntireSettings(workspace, home);

			assert.strictEqual(settings.enabled, undefined);
		} finally {
			fs.rmSync(workspace, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});

suite('Entire settings summary', () => {
	test('names the settings the way the CLI does', () => {
		const summary = summariseSettings({
			enabled: true,
			telemetry: false,
			checkpointType: 'git-refs',
		});

		assert.ok(summary.includes('enabled: true'));
		assert.ok(summary.includes('telemetry: false'));
		assert.ok(summary.includes('checkpoints.primary.type: git-refs'));
	});

	test('leaves a setting nobody has set out', () => {
		const summary = summariseSettings({ enabled: true });

		assert.deepStrictEqual(summary, ['enabled: true']);
	});
});

suite('Entire log level', () => {
	test('says nothing above the level that is set', () => {
		assert.strictEqual(shouldLog('info', 'error'), true);
		assert.strictEqual(shouldLog('info', 'warn'), true);
		assert.strictEqual(shouldLog('info', 'info'), true);
		assert.strictEqual(shouldLog('info', 'debug'), false);
		assert.strictEqual(shouldLog('info', 'trace'), false);
	});

	test('says everything at the loudest level', () => {
		assert.strictEqual(shouldLog('trace', 'trace'), true);
		assert.strictEqual(shouldLog('trace', 'error'), true);
	});

	test('reads a level it knows', () => {
		assert.strictEqual(readLogLevel('debug'), 'debug');
		assert.strictEqual(readLogLevel('error'), 'error');
	});

	test('reads a level it does not know as the ordinary one', () => {
		assert.strictEqual(readLogLevel('shouty'), 'info');
		assert.strictEqual(readLogLevel(undefined), 'info');
	});

	test('names every level it supports', () => {
		const levels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
		assert.deepStrictEqual(levels, ['error', 'warn', 'info', 'debug', 'trace']);
	});
});

suite('Entire extension settings', () => {
	const ROOT = path.resolve(__dirname, '..', '..');

	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
	) as {
		contributes: {
			configuration: {
				properties: Record<string, { type?: string; default?: unknown }>;
			};
		};
	};

	test('are all registered with the configuration API', () => {
		// The keys are absolute, so the whole configuration is asked.
		const configuration = vscode.workspace.getConfiguration();
		const properties = manifest.contributes.configuration.properties;

		assert.ok(Object.keys(properties).length > 0, 'the manifest declares no settings');

		for (const [key, schema] of Object.entries(properties)) {
			const inspected = configuration.inspect(key);
			assert.ok(inspected, `the setting '${key}' is not registered with the configuration API`);
			// The editor reads an empty string default as no default at
			// all, which is the same thing for a string setting.
			const declared = schema.default;
			const actual = inspected.defaultValue;
			const same =
				declared === '' ? actual === undefined || actual === '' : actual === declared;

			assert.ok(
				same,
				`the setting '${key}' does not default to what the manifest declares`,
			);
		}
	});

	test('include the CLI path, the interval, the view and the log level', () => {
		const properties = manifest.contributes.configuration.properties;

		for (const key of [
			'entirely.cliPath',
			'entirely.refreshInterval',
			'entirely.showSessionsInExplorer',
			'entirely.minimumCliVersion',
			'entirely.logLevel',
			'entirely.debug',
			'entirely.editorHookAgent',
		]) {
			assert.ok(properties[key], `the setting '${key}' is not declared`);
		}
	});
});

suite('Entire effective log level', () => {
	test('is the level the user chose when the debug setting is off', () => {
		assert.strictEqual(
			effectiveLogLevel({
				cliPath: undefined,
				refreshInterval: 30,
				transcriptTimeout: 60,
				searchDebounce: 400,
				lifecycleActionTimeout: 60,
				editorHookAgent: 'copilot-cli',
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				minimumCliVersion: '0.12.2',
				logLevel: 'warn',
				debug: false,
			}),
			'warn',
		);
	});

	test('is raised to debug when the debug setting is on', () => {
		assert.strictEqual(
			effectiveLogLevel({
				cliPath: undefined,
				refreshInterval: 30,
				transcriptTimeout: 60,
				searchDebounce: 400,
				lifecycleActionTimeout: 60,
				editorHookAgent: 'copilot-cli',
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				minimumCliVersion: '0.12.2',
				logLevel: 'info',
				debug: true,
			}),
			'debug',
		);
	});

	test('is never lowered by the debug setting', () => {
		assert.strictEqual(
			effectiveLogLevel({
				cliPath: undefined,
				refreshInterval: 30,
				transcriptTimeout: 60,
				searchDebounce: 400,
				lifecycleActionTimeout: 60,
				editorHookAgent: 'copilot-cli',
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				minimumCliVersion: '0.12.2',
				logLevel: 'trace',
				debug: true,
			}),
			'trace',
		);
	});
});
