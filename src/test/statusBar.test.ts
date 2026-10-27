import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { StatusBar } from '../services/statusBar';
import { clickAction, StatusController } from '../services/statusController';

const temporaryDirectories: string[] = [];

function makeDirectory(prefix: string): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

/** Writes a fake `entire` binary into a directory. */
function writeFakeCli(directory: string, body: string): string {
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, 'entire');
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
	fs.chmodSync(file, 0o755);
	return file;
}

const TRACKED_STATUS =
	'{"enabled":true,"agents":["Copilot CLI"],"active_sessions":[],"agent_help":"entire agent-help"}';

const TRACKED_WITH_SESSION_STATUS =
	'{"enabled":true,"agents":["Copilot CLI"],"active_sessions":[{"agent":"Copilot CLI","session_id":"abc-123","worktree_path":"/work/sandbox","branch":"master","status":"active"}],"agent_help":"entire agent-help"}';

const NOT_SET_UP_STATUS =
	'{"enabled":false,"agents":null,"active_sessions":null,"error":"not set up"}';

const NOT_A_REPOSITORY_STATUS =
	'{"enabled":false,"agents":null,"active_sessions":null,"error":"not a git repository"}';

suite('Entire status bar', () => {
	suiteTeardown(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('renders a distinct treatment for each state', () => {
		const bar = new StatusBar();
		try {
			const renderings = new Map<string, string>();

			bar.show({ kind: 'active-session', agent: 'Copilot CLI' });
			renderings.set('active-session', bar.text);

			bar.show({ kind: 'tracked' });
			renderings.set('tracked', bar.text);

			bar.show({ kind: 'not-set-up' });
			renderings.set('not-set-up', bar.text);

			bar.show({ kind: 'not-a-repository' });
			renderings.set('not-a-repository', bar.text);

			bar.show({ kind: 'error', detail: 'the CLI crashed' });
			renderings.set('error', bar.text);

			const texts = [...renderings.values()];
			assert.strictEqual(new Set(texts).size, texts.length, 'every state renders differently');
		} finally {
			bar.dispose();
		}
	});

	test('names the running agent in the tooltip', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'active-session', agent: 'Copilot CLI' });
			assert.match(bar.tooltip, /Copilot CLI/);
		} finally {
			bar.dispose();
		}
	});

	test('hides itself when told to', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'tracked' });
			assert.strictEqual(bar.visible, true);

			bar.hide();
			assert.strictEqual(bar.visible, false);
			assert.strictEqual(bar.current, undefined);
		} finally {
			bar.dispose();
		}
	});

	test('is a command', () => {
		const bar = new StatusBar();
		try {
			assert.strictEqual(bar.command, 'entirely.statusBar');
		} finally {
			bar.dispose();
		}
	});
});

suite('Entire status bar click routing', () => {
	test('routes to set up when the workspace is not set up', () => {
		assert.strictEqual(clickAction({ kind: 'not-set-up' }), 'set-up');
	});

	test('routes to the view when the workspace is tracked', () => {
		assert.strictEqual(clickAction({ kind: 'tracked' }), 'show-sessions');
		assert.strictEqual(clickAction({ kind: 'active-session', agent: 'Copilot CLI' }), 'show-sessions');
	});

	test('routes to an explanation when the workspace is not a repository', () => {
		assert.strictEqual(clickAction({ kind: 'not-a-repository' }), 'explain-not-a-repository');
	});

	test('routes to the error when the CLI could not be read', () => {
		assert.strictEqual(clickAction({ kind: 'error', detail: 'boom' }), 'show-error');
	});

	test('never offers to set up a workspace that is not a repository', () => {
		assert.notStrictEqual(clickAction({ kind: 'not-a-repository' }), 'set-up');
	});
});

suite('Entire status controller', () => {
	suiteTeardown(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	/** Builds a controller over a fake CLI, with no CLI installed at all. */
	function controllerFor(body: string | undefined): {
		controller: StatusController;
		bar: StatusBar;
		output: vscode.OutputChannel;
	} {
		const home = makeDirectory('entire-status-home-');
		if (body !== undefined) {
			writeFakeCli(path.join(home, '.local', 'bin'), body);
		}

		const bar = new StatusBar();
		const output = vscode.window.createOutputChannel('Entirely test');
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const controller = new StatusController({ statusBar: bar, runner, output });

		return { controller, bar, output };
	}

	const CASES = [
		{
			name: 'a tracked workspace',
			body: ['case "$1" in', '\tversion) echo "entire 0.12.2" ;;', `\tstatus) echo '${TRACKED_STATUS}' ;;`, 'esac'].join('\n'),
			expected: 'tracked',
		},
		{
			name: 'a tracked workspace with a live session',
			body: ['case "$1" in', '\tversion) echo "entire 0.12.2" ;;', `\tstatus) echo '${TRACKED_WITH_SESSION_STATUS}' ;;`, 'esac'].join('\n'),
			expected: 'active-session',
		},
		{
			name: 'a workspace that is not set up',
			body: ['case "$1" in', '\tversion) echo "entire 0.12.2" ;;', `\tstatus) echo '${NOT_SET_UP_STATUS}' ;;`, 'esac'].join('\n'),
			expected: 'not-set-up',
		},
		{
			name: 'a workspace that is not a repository',
			body: ['case "$1" in', '\tversion) echo "entire 0.12.2" ;;', `\tstatus) echo '${NOT_A_REPOSITORY_STATUS}' ;;`, 'esac'].join('\n'),
			expected: 'not-a-repository',
		},
	];

	for (const testCase of CASES) {
		test(`shows the ${testCase.name} state`, async () => {
			const { controller, bar, output } = controllerFor(testCase.body);
			try {
				await controller.refresh();
				assert.strictEqual(bar.current?.kind, testCase.expected);
				assert.strictEqual(bar.visible, true);
			} finally {
				controller.dispose();
				bar.dispose();
				output.dispose();
			}
		});
	}

	test('hides the item when the CLI is absent', async () => {
		const { controller, bar, output } = controllerFor(undefined);
		try {
			await controller.refresh();
			assert.strictEqual(bar.visible, false);
			assert.strictEqual(bar.current, undefined);
		} finally {
			controller.dispose();
			bar.dispose();
			output.dispose();
		}
	});

	test('shows an error when the CLI is broken', async () => {
		const { controller, bar, output } = controllerFor('echo "boom" >&2\nexit 3');
		try {
			await controller.refresh();
			assert.strictEqual(bar.current?.kind, 'error');
			assert.strictEqual(bar.visible, true);
		} finally {
			controller.dispose();
			bar.dispose();
			output.dispose();
		}
	});

	test('shows an error when the CLI fails to answer', async () => {
		const { controller, bar, output } = controllerFor(
			['case "$1" in', '\tversion) echo "entire 0.12.2" ;;', '\tstatus) echo "not json" ;;', 'esac'].join('\n'),
		);
		try {
			await controller.refresh();
			assert.strictEqual(bar.current?.kind, 'error');
		} finally {
			controller.dispose();
			bar.dispose();
			output.dispose();
		}
	});
});

suite('Entire status bar against the real CLI', () => {
	test('reads the workspace state from the installed CLI', async function () {
		const bar = new StatusBar();
		const output = vscode.window.createOutputChannel('Entirely real test');
		const runner = new CliRunner();
		const controller = new StatusController({ statusBar: bar, runner, output });

		try {
			const discovery = await runner.discover();
			if (discovery.state === 'absent') {
				this.skip();
			}

			await controller.refresh();

			assert.strictEqual(bar.visible, true);
			const kind = bar.current?.kind;
			assert.ok(
				kind === 'tracked' ||
					kind === 'active-session' ||
					kind === 'not-set-up' ||
					kind === 'not-a-repository',
				`unexpected status '${String(kind)}'`,
			);
		} finally {
			controller.dispose();
			bar.dispose();
			output.dispose();
		}
	});
});
