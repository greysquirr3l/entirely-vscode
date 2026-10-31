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
import {
	clampAgentLookupCacheSeconds,
	clampSelectionCacheSeconds,
	clampTrailBadgeLimit,
	clampTrailActionTimeout,
	effectiveLogLevel,
} from '../services/configuration';
import { REDACTED_ARGUMENT, redactArguments } from '../services/cli/runner';
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
				declared === '' ? actual === undefined || actual === '' : JSON.stringify(actual) === JSON.stringify(declared);

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
			'entirely.trailActionTimeout',
			'entirely.selectionCacheSeconds',
			'entirely.trailBadgeLimit',
			'entirely.showSessionsInExplorer',
			'entirely.minimumCliVersion',
			'entirely.logLevel',
			'entirely.debug',
			'entirely.editorHookAgent',
			'entirely.agentLookupCacheSeconds',
		]) {
			assert.ok(properties[key], `the setting '${key}' is not declared`);
		}
	});
});

suite('Entire effective log level', () => {
	test('bounds the agent lookup cache lifetime', () => {
		assert.strictEqual(clampAgentLookupCacheSeconds(30), 30);
		assert.strictEqual(clampAgentLookupCacheSeconds(1), 5);
		assert.strictEqual(clampAgentLookupCacheSeconds(99999), 600);
		assert.strictEqual(clampAgentLookupCacheSeconds(Number.NaN), 30);
	});

	test('is the level the user chose when the debug setting is off', () => {
		assert.strictEqual(
			effectiveLogLevel({
				cliPath: undefined,
				refreshInterval: 30,
				transcriptTimeout: 60,
				searchDebounce: 400,
				searchScope: 'repository',
				lifecycleActionTimeout: 60,
				cliDoctorTimeout: 30,
				controlPlaneTimeout: 60,
				activityTimeout: 30,
				dispatchTimeout: 180,
				pluginTimeout: 120,
				tokenProfileCheckpoints: 50,
				tokenProfileTimeout: 30,
				expertsLimit: 8,
				expertsTimeout: 30,
				reviewReadTimeout: 30,
				reviewReviewerTimeoutMinutes: 0,
				doctorLogLines: 200,
				doctorTraceCount: 5,
				doctorOutputMaxKilobytes: 512,
				doctorReadTimeout: 30,
				doctorBundleTimeout: 120,
				migrateCheckpointsTimeout: 300,
				captureControlTimeout: 60,
				runnerSetupTimeout: 300,
				mcpServerEnabled: true,
				suggestedPlugins: ['graph', 'investigate', 'brain'],
				offerIntegrationInstall: true,
				editorHookAgent: 'copilot-cli',
				agentLookupCacheSeconds: 30,
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				selectionCacheSeconds: 30,
				trailBadgeLimit: 10,
				trailActionTimeout: 60,
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
				searchScope: 'repository',
				lifecycleActionTimeout: 60,
				cliDoctorTimeout: 30,
				controlPlaneTimeout: 60,
				activityTimeout: 30,
				dispatchTimeout: 180,
				pluginTimeout: 120,
				tokenProfileCheckpoints: 50,
				tokenProfileTimeout: 30,
				expertsLimit: 8,
				expertsTimeout: 30,
				reviewReadTimeout: 30,
				reviewReviewerTimeoutMinutes: 0,
				doctorLogLines: 200,
				doctorTraceCount: 5,
				doctorOutputMaxKilobytes: 512,
				doctorReadTimeout: 30,
				doctorBundleTimeout: 120,
				migrateCheckpointsTimeout: 300,
				captureControlTimeout: 60,
				runnerSetupTimeout: 300,
				mcpServerEnabled: true,
				suggestedPlugins: ['graph', 'investigate', 'brain'],
				offerIntegrationInstall: true,
				editorHookAgent: 'copilot-cli',
				agentLookupCacheSeconds: 30,
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				selectionCacheSeconds: 30,
				trailBadgeLimit: 10,
				trailActionTimeout: 60,
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
				searchScope: 'repository',
				lifecycleActionTimeout: 60,
				cliDoctorTimeout: 30,
				controlPlaneTimeout: 60,
				activityTimeout: 30,
				dispatchTimeout: 180,
				pluginTimeout: 120,
				tokenProfileCheckpoints: 50,
				tokenProfileTimeout: 30,
				expertsLimit: 8,
				expertsTimeout: 30,
				reviewReadTimeout: 30,
				reviewReviewerTimeoutMinutes: 0,
				doctorLogLines: 200,
				doctorTraceCount: 5,
				doctorOutputMaxKilobytes: 512,
				doctorReadTimeout: 30,
				doctorBundleTimeout: 120,
				migrateCheckpointsTimeout: 300,
				captureControlTimeout: 60,
				runnerSetupTimeout: 300,
				mcpServerEnabled: true,
				suggestedPlugins: ['graph', 'investigate', 'brain'],
				offerIntegrationInstall: true,
				editorHookAgent: 'copilot-cli',
				agentLookupCacheSeconds: 30,
				importTimeout: 300,
				resumeWatchTimeout: 60,
				blameMaxDecoratedLines: 5000,
				showSessionsInExplorer: false,
				selectionCacheSeconds: 30,
				trailBadgeLimit: 10,
				trailActionTimeout: 60,
				minimumCliVersion: '0.12.2',
				logLevel: 'trace',
				debug: true,
			}),
			'trace',
		);
	});
});

suite('Trails badge limit', () => {
	test('is held between zero, which reads nothing, and fifty', () => {
		assert.strictEqual(clampTrailBadgeLimit(0), 0);
		assert.strictEqual(clampTrailBadgeLimit(-3), 0);
		assert.strictEqual(clampTrailBadgeLimit(10), 10);
		assert.strictEqual(clampTrailBadgeLimit(7.9), 7);
		assert.strictEqual(clampTrailBadgeLimit(500), 50);
	});

	test('falls back to ten for a value that is not a number', () => {
		assert.strictEqual(clampTrailBadgeLimit(Number.NaN), 10);
		assert.strictEqual(clampTrailBadgeLimit(Number.POSITIVE_INFINITY), 10);
	});
});

suite('Selection cache lifetime', () => {
	test('is held between zero, which turns the cache off, and ten minutes', () => {
		assert.strictEqual(clampSelectionCacheSeconds(0), 0);
		assert.strictEqual(clampSelectionCacheSeconds(-5), 0);
		assert.strictEqual(clampSelectionCacheSeconds(30), 30);
		assert.strictEqual(clampSelectionCacheSeconds(45.9), 45);
		assert.strictEqual(clampSelectionCacheSeconds(99999), 600);
	});

	test('falls back to thirty seconds for a value that is not a number', () => {
		assert.strictEqual(clampSelectionCacheSeconds(Number.NaN), 30);
		assert.strictEqual(clampSelectionCacheSeconds(Number.POSITIVE_INFINITY), 30);
	});
});

suite('Trail action timeout', () => {
	test('a value that is not a number falls back to the default', () => {
		assert.strictEqual(clampTrailActionTimeout(Number.NaN), 60);
		assert.strictEqual(clampTrailActionTimeout(Number.POSITIVE_INFINITY), 60);
		assert.strictEqual(clampTrailActionTimeout(Number.NEGATIVE_INFINITY), 60);
	});

	test('a value is held inside the lower and upper bounds', () => {
		assert.strictEqual(clampTrailActionTimeout(1), 5);
		assert.strictEqual(clampTrailActionTimeout(-30), 5);
		assert.strictEqual(clampTrailActionTimeout(9999), 600);
	});

	test('a fractional value is rounded down to whole seconds', () => {
		assert.strictEqual(clampTrailActionTimeout(90.7), 90);
	});

	test('a value in range is kept', () => {
		assert.strictEqual(clampTrailActionTimeout(60), 60);
		assert.strictEqual(clampTrailActionTimeout(5), 5);
		assert.strictEqual(clampTrailActionTimeout(600), 600);
	});
});

suite('Redacting a reported command line', () => {
	test('with no flags the arguments are returned unchanged as a copy', () => {
		const args = ['trail', 'comment', '--body', 'secret'];
		const result = redactArguments(args, []);

		assert.deepStrictEqual(result, args);
		assert.notStrictEqual(result, args);
		assert.deepStrictEqual(redactArguments(args, undefined), args);
	});

	test('the value after a named flag is replaced', () => {
		assert.deepStrictEqual(redactArguments(['trail', 'comment', '--body', 'secret'], ['--body']), [
			'trail',
			'comment',
			'--body',
			REDACTED_ARGUMENT,
		]);
	});

	test('a flag that is the last argument has no value to redact', () => {
		assert.deepStrictEqual(redactArguments(['trail', 'comment', '--body'], ['--body']), [
			'trail',
			'comment',
			'--body',
		]);
	});

	test('a flag given twice has both values redacted', () => {
		assert.deepStrictEqual(
			redactArguments(['approve', '--message', 'one', '--message', 'two'], ['--message']),
			['approve', '--message', REDACTED_ARGUMENT, '--message', REDACTED_ARGUMENT],
		);
	});
});
