import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CliLocator } from '../services/cli/locator';
import { makeTempDir } from './support/tempDir';
import { readEntireSettings } from '../services/settingsSource';

suite('Entire settings against the real CLI', function () {
	this.timeout(120_000);

	const directories: string[] = [];

	suiteTeardown(() => {
		for (const directory of directories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	/** Creates a temporary directory. */
	function temporary(prefix: string): string {
		const directory = makeTempDir(prefix);
		directories.push(directory);
		return directory;
	}

	test('reads the settings the CLI wrote into the repository', async () => {
		const locator = new CliLocator();
		const discovery = await locator.current();
		if (discovery.state !== 'available') {
			return;
		}

		const workspace = temporary('entire-settings-e2e-');
		const home = temporary('entire-settings-home-');

		execFileSync('git', ['init', '--quiet'], { cwd: workspace });

		execFileSync('entire', ['enable', '--agent', 'copilot-cli', '--no-init-repo'], {
			cwd: workspace,
			stdio: 'ignore',
		});
		execFileSync('entire', ['configure', '--telemetry=false', '--absolute-git-hook-path'], {
			cwd: workspace,
			stdio: 'ignore',
		});

		const settings = readEntireSettings(workspace, home);

		assert.strictEqual(settings.enabled, true);
		assert.strictEqual(settings.telemetry, false);
		assert.strictEqual(settings.absoluteGitHookPath, true);
		assert.strictEqual(settings.checkpointType, 'git-refs');
	});

	test('the settings in the repository beat the ones the user keeps', async () => {
		const locator = new CliLocator();
		const discovery = await locator.current();
		if (discovery.state !== 'available') {
			return;
		}

		const workspace = temporary('entire-settings-layer-');
		const home = temporary('entire-settings-layer-home-');

		execFileSync('git', ['init', '--quiet'], { cwd: workspace });
		fs.mkdirSync(path.join(workspace, '.entire'), { recursive: true });
		fs.mkdirSync(path.join(home, '.config', 'entire'), { recursive: true });

		fs.writeFileSync(
			path.join(workspace, '.entire', 'settings.json'),
			JSON.stringify({ enabled: true, telemetry: true }),
			'utf8',
		);
		fs.writeFileSync(
			path.join(home, '.config', 'entire', 'settings.json'),
			JSON.stringify({ enabled: false, telemetry: false }),
			'utf8',
		);

		const settings = readEntireSettings(workspace, home);

		// The repository is what the CLI reads, and it is what the
		// extension reads.
		assert.strictEqual(settings.enabled, true);
		assert.strictEqual(settings.telemetry, true);
	});
});
