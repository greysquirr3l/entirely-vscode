import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { AccountContextService } from '../services/accountContext';
import { makeTempDir } from './support/tempDir';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { StatusBar, StatusDisplay } from '../services/statusBar';
import { clickAction, StatusController } from '../services/statusController';

const temporaryDirectories: string[] = [];

function makeDirectory(prefix: string): string {
	const directory = makeTempDir(prefix);
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

			bar.show({ kind: 'invisible-to-context', context: 'greysquirr3l' });
			renderings.set('invisible-to-context', bar.text);

			bar.show({ kind: 'context-error', detail: 'no saved login' });
			renderings.set('context-error', bar.text);

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

	test('shows the logo with a codicon beside it for every state', () => {
		const bar = new StatusBar();
		try {
			const expected: [StatusDisplay, string][] = [
				[{ kind: 'tracked' }, '$(entire-logo) Entire'],
				[{ kind: 'active-session' }, '$(entire-logo) Entire $(pulse)'],
				[{ kind: 'not-set-up' }, '$(entire-logo) Entire $(circle-slash)'],
				[{ kind: 'not-a-repository' }, '$(entire-logo) Entire $(circle-outline)'],
				[{ kind: 'invisible-to-context', context: 'someone' }, '$(entire-logo) Entire $(eye-closed)'],
				[{ kind: 'context-error', detail: 'no saved login' }, '$(entire-logo) Entire $(error)'],
				[{ kind: 'error', detail: 'boom' }, '$(entire-logo) Entire $(warning)'],
			];
			for (const [display, text] of expected) {
				bar.show(display);
				assert.strictEqual(bar.text, text, `${display.kind} shows '${bar.text}'`);
			}
		} finally {
			bar.dispose();
		}
	});

	test('warns in the status bar when the checkpoints are not going anywhere', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'tracked' });
			const calm = bar.text;

			bar.show({
				kind: 'tracked',
				checkpointProblem: 'Checkpoints stay on this machine, so they will not appear on Entire.',
			});

			assert.notStrictEqual(bar.text, calm, 'the warning looks different from the calm state');
			assert.strictEqual(bar.text, '$(entire-logo) Entire $(warning)');
			assert.match(bar.tooltip, /Entire is tracking this workspace/, 'the state can still be read by hovering');
			assert.match(bar.tooltip, /will not appear on Entire/);
		} finally {
			bar.dispose();
		}
	});

	test('tells a workspace with a problem apart from one without', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'active-session', agent: 'Copilot CLI' });
			const calm = bar.text;

			bar.show({
				kind: 'active-session',
				agent: 'Copilot CLI',
				checkpointProblem: 'the CLI said nothing',
			});

			assert.notStrictEqual(bar.text, calm);
			assert.strictEqual(calm, '$(entire-logo) Entire $(pulse)');
			assert.strictEqual(bar.text, '$(entire-logo) Entire $(pulse) $(warning)');
		} finally {
			bar.dispose();
		}
	});

	test('keeps saying the session is running when the checkpoints are wrong', () => {
		const bar = new StatusBar();
		try {
			bar.show({
				kind: 'active-session',
				agent: 'Copilot CLI',
				checkpointProblem: 'the CLI said nothing',
			});

			assert.match(bar.tooltip, /Copilot CLI/);
			assert.match(bar.tooltip, /the CLI said nothing/);
		} finally {
			bar.dispose();
		}
	});

	test('does not claim where the checkpoints go when it does not know', () => {
		const bar = new StatusBar();
		try {
			bar.show({
				kind: 'tracked',
				checkpointDestination: 'an unknown destination',
				checkpointProblem: 'The Entire CLI did not say where checkpoints are being uploaded.',
			});

			assert.doesNotMatch(bar.tooltip, /Checkpoints go to this machine only/);
			assert.match(bar.tooltip, /did not say where checkpoints are being uploaded/);
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

	test('names the login it is acting as', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'tracked', context: 'greysquirr3l' });

			assert.match(bar.tooltip, /Acting as greysquirr3l/);
		} finally {
			bar.dispose();
		}
	});

	test('tells a workspace the login cannot see apart from one that is not tracked', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'not-set-up' });
			const untracked = bar.text;

			bar.show({ kind: 'invisible-to-context', context: 'greysquirr3l' });

			assert.notStrictEqual(bar.text, untracked, 'the two states look the same');
			assert.match(bar.text, /\$\(eye-closed\)/);
			assert.match(bar.tooltip, /cannot see/);
			assert.match(bar.tooltip, /greysquirr3l/, 'the login is not named');
			assert.doesNotMatch(bar.tooltip, /not set up/, 'it reads as a workspace that is not tracked');
		} finally {
			bar.dispose();
		}
	});

	test('shows a login the CLI does not have as a mistake in the settings', () => {
		const bar = new StatusBar();
		try {
			bar.show({ kind: 'context-error', detail: 'no saved login called "nobody"' });

			assert.match(bar.text, /error/);
			assert.match(bar.tooltip, /does not have/);
			assert.match(bar.tooltip, /nobody/);
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

	test('routes to an explanation when the login cannot see the workspace', () => {
		assert.strictEqual(
			clickAction({ kind: 'invisible-to-context', context: 'greysquirr3l' }),
			'explain-invisible-to-context',
		);
	});

	test('routes to an explanation when the login in the settings is not one the CLI has', () => {
		assert.strictEqual(
			clickAction({ kind: 'context-error', detail: 'no saved login' }),
			'explain-context-error',
		);
	});

	test('never offers to set up a workspace that is not a repository', () => {
		assert.notStrictEqual(clickAction({ kind: 'not-a-repository' }), 'set-up');
	});
});

suite('Entire status controller and the acting login', () => {
	suiteTeardown(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	/** The table the CLI prints for its saved logins. */
	const CONTEXTS_TABLE = [
		'CONTEXT                           HANDLE          LOGIN SERVER',
		'us.auth.entire.io                 greysquirr3l    https://us.auth.entire.io  (active)',
	].join('\n');

	/** A tracked workspace whose checkpoints go to its own repository. */
	const SAME_REPO_STATUS =
		'{"enabled":true,"agents":["Copilot CLI"],"active_sessions":[],"agent_help":"entire agent-help","checkpoint_sync_remote":"origin","checkpoint_sync_remote_source":"default"}';

	/** A fake CLI that answers the commands the controller makes. */
	function cliBody(repoLine: string): string {
		const rows = CONTEXTS_TABLE.split('\n').map(line => `'${line}'`).join(' ');

		return [
			'case "$1" in',
			'\tversion) echo "entire 0.12.2" ;;',
			`\tauth) printf '%s\\n' ${rows} ;;`,
			`\tstatus) echo '${SAME_REPO_STATUS}' ;;`,
			`\trepo) ${repoLine} ;;`,
			'esac',
		].join('\n');
	}

	/** Builds a controller over a fake CLI. */
	function controllerFor(body: string): {
		controller: StatusController;
		bar: StatusBar;
	} {
		const home = makeDirectory('entire-status-login-home-');
		writeFakeCli(path.join(home, '.local', 'bin'), body);

		const bar = new StatusBar();
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const controller = new StatusController({
			statusBar: bar,
			runner,
			output: { show: () => undefined },
			accounts: new AccountContextService(runner),
		});

		return { controller, bar };
	}

	/** Waits for a condition to come true. */
	async function waitFor(condition: () => boolean): Promise<void> {
		const deadline = Date.now() + 5_000;
		while (!condition()) {
			if (Date.now() > deadline) {
				throw new Error('the condition did not come true in time');
			}
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	}

	test('says the workspace is invisible when the login cannot see it', async () => {
		const { controller, bar } = controllerFor(
			cliBody('echo \'no repo matching "owner/repo" visible from your login\' >&2; exit 1'),
		);
		try {
			await controller.refresh();
			await waitFor(() => bar.current?.kind === 'invisible-to-context');

			assert.strictEqual(bar.current?.kind, 'invisible-to-context');
			const display = bar.current;
			assert.strictEqual(
				display?.kind === 'invisible-to-context' && display.context,
				'greysquirr3l',
				'the login is not named',
			);
			assert.match(bar.tooltip, /cannot see/);
			assert.match(bar.tooltip, /greysquirr3l/);
		} finally {
			controller.dispose();
			bar.dispose();
		}
	});

	test('says the workspace is tracked when the login can see it', async () => {
		const { controller, bar } = controllerFor(cliBody('echo \'{"repo":"/gh/owner/repo"}\''));
		try {
			await controller.refresh();
			await waitFor(() => bar.current?.kind === 'tracked');

			assert.strictEqual(bar.current?.kind, 'tracked');
		} finally {
			controller.dispose();
			bar.dispose();
		}
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
		output: Pick<vscode.OutputChannel, 'show'>;
	} {
		const home = makeDirectory('entire-status-home-');
		if (body !== undefined) {
			writeFakeCli(path.join(home, '.local', 'bin'), body);
		}

		const bar = new StatusBar();
		const output = { show: () => undefined };
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const controller = new StatusController({
			statusBar: bar,
			runner,
			output,
			accounts: new AccountContextService(runner),
		});

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
		}
	});
});

suite('Entire status bar against the real CLI', () => {
	test('reads the workspace state from the installed CLI', async function () {
		// The real CLI reaches the network to work out which repository the
		// workspace is on, and how long that takes is not the extension's
		// to decide. The default timeout is for tests that do not leave the
		// machine.
		this.timeout(30_000);

		const bar = new StatusBar();
		const output = { show: () => undefined };
		const runner = new CliRunner();
		const controller = new StatusController({
			statusBar: bar,
			runner,
			output,
			accounts: new AccountContextService(runner),
		});

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
		}
	});
});
