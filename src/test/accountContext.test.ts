import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	decodeAccountContexts,
	describeUnknownContext,
	isInvisibleToLogin,
	isUnknownContextError,
	selectAccountContext,
} from '../lib/entire';
import { AccountContextService, readAccountContext } from '../services/accountContext';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { readExtensionSettings } from '../services/configuration';
import { HookBridge } from '../services/hookBridge';
import { StatusBar } from '../services/statusBar';
import { StatusController } from '../services/statusController';
import { writeSetting } from './support/settings';

const temporaryDirectories: string[] = [];

suiteTeardown(() => {
	for (const directory of temporaryDirectories) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

/** Creates a temporary directory. */
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

/** The table the CLI prints for its saved logins. */
const CONTEXTS_TABLE = [
	'CONTEXT                           HANDLE          LOGIN SERVER',
	'us.auth.entire.io                 greysquirr3l    https://us.auth.entire.io',
	'sosh-ncampbell@us.auth.entire.io  sosh-ncampbell  https://us.auth.entire.io  (active)',
].join('\n');

/** A fake CLI that answers `auth contexts` with a table. */
function contextsCli(table: string): string {
	const rows = table
		.split('\n')
		.filter(line => line.length > 0)
		.map(line => `'${line}'`)
		.join(' ');

	return [
		'case "$1" in',
		'\tversion) echo "entire 0.12.2" ;;',
		`\tauth) printf '%s\\n' ${rows} ;;`,
		'esac',
	].join('\n');
}

suite('Entire account contexts', () => {
	test('reads the logins the CLI has saved', () => {
		const contexts = decodeAccountContexts(CONTEXTS_TABLE);

		assert.strictEqual(contexts.length, 2);
		assert.deepStrictEqual(contexts[0], {
			name: 'us.auth.entire.io',
			handle: 'greysquirr3l',
			server: 'https://us.auth.entire.io',
			active: false,
		});
		assert.deepStrictEqual(contexts[1], {
			name: 'sosh-ncampbell@us.auth.entire.io',
			handle: 'sosh-ncampbell',
			server: 'https://us.auth.entire.io',
			active: true,
		});
	});

	test('reads a table whose columns are separated by one space', () => {
		const contexts = decodeAccountContexts(
			[
				'CONTEXT HANDLE LOGIN SERVER',
				'us.auth.entire.io greysquirr3l https://us.auth.entire.io',
			].join('\n'),
		);

		assert.strictEqual(contexts.length, 1);
		assert.strictEqual(contexts[0].handle, 'greysquirr3l');
		assert.strictEqual(contexts[0].server, 'https://us.auth.entire.io');
	});

	test('reads nothing out of a table that has no logins in it', () => {
		assert.deepStrictEqual(decodeAccountContexts(''), []);
		assert.deepStrictEqual(decodeAccountContexts('No saved logins.'), []);
		assert.deepStrictEqual(decodeAccountContexts('Log in with `entire auth login`.'), []);
	});

	test('acts as the login the user named', () => {
		const saved = decodeAccountContexts(CONTEXTS_TABLE);

		const selection = selectAccountContext(saved, 'us.auth.entire.io');

		assert.strictEqual(selection.kind, 'context');
		assert.strictEqual(selection.kind === 'context' && selection.context.handle, 'greysquirr3l');
		assert.strictEqual(selection.kind === 'context' && selection.pinned, true);
	});

	test('acts as the login the CLI is using when the user named none', () => {
		const saved = decodeAccountContexts(CONTEXTS_TABLE);

		const selection = selectAccountContext(saved, undefined);

		assert.strictEqual(selection.kind, 'context');
		assert.strictEqual(selection.kind === 'context' && selection.context.handle, 'sosh-ncampbell');
		assert.strictEqual(selection.kind === 'context' && selection.pinned, false);
	});

	test('reports a login the CLI does not have', () => {
		const saved = decodeAccountContexts(CONTEXTS_TABLE);

		const selection = selectAccountContext(saved, 'nobody');

		assert.strictEqual(selection.kind, 'unknown-context');
		assert.strictEqual(selection.kind === 'unknown-context' && selection.name, 'nobody');
	});

	test('says which logins there are when the named one is not there', () => {
		const message = describeUnknownContext('nobody', decodeAccountContexts(CONTEXTS_TABLE));

		assert.strictEqual(
			message,
			'The Entire CLI has no saved login called "nobody". Saved logins: us.auth.entire.io, sosh-ncampbell@us.auth.entire.io.',
		);
	});

	test('tells the CLI refusing a login apart from any other failure', () => {
		assert.strictEqual(
			isUnknownContextError('--context selected login context "bogus", which is not saved.'),
			true,
		);
		assert.strictEqual(isUnknownContextError('the command exited with code 1'), false);
	});

	test('tells a repository the login cannot see apart from any other failure', () => {
		assert.strictEqual(
			isInvisibleToLogin('no repo matching "owner/repo" visible from your login'),
			true,
		);
		assert.strictEqual(isInvisibleToLogin('the command exited with code 1'), false);
	});
});

suite('Entire context in the CLI runner', () => {
	/** A runner over a fake CLI that records what it was given. */
	function runnerWith(): {
		runner: CliRunner;
		readArguments: () => string[];
		readEnvironment: () => string;
	} {
		const home = makeDirectory('entire-context-home-');
		const argumentsFile = path.join(home, 'arguments.txt');
		const environmentFile = path.join(home, 'environment.txt');

		// The discovery probe is answered without being recorded, so the
		// file holds the arguments of the command the test asked for.
		writeFakeCli(
			path.join(home, '.local', 'bin'),
			[
				`if [ "$1" = "version" ]; then echo "entire 0.12.2"; exit 0; fi`,
				`printf '%s\\n' "$@" > "${argumentsFile}"`,
				`printf '%s' "$ENTIRE_CONTEXT" > "${environmentFile}"`,
			].join('\n'),
		);

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));

		return {
			runner,
			readArguments: () =>
				fs.existsSync(argumentsFile)
					? fs.readFileSync(argumentsFile, 'utf8').split('\n').filter(line => line.length > 0)
					: [],
			readEnvironment: () =>
				fs.existsSync(environmentFile) ? fs.readFileSync(environmentFile, 'utf8') : '',
		};
	}

	test('adds the context to the argument vector when one is pinned', async () => {
		const { runner, readArguments } = runnerWith();

		runner.setContext('us.auth.entire.io');
		await runner.run(['status', '--json']);

		assert.deepStrictEqual(readArguments(), [
			'--context',
			'us.auth.entire.io',
			'status',
			'--json',
		]);
	});

	test('adds nothing to the argument vector when no context is pinned', async () => {
		const { runner, readArguments } = runnerWith();

		await runner.run(['status', '--json'], { env: {} });

		assert.deepStrictEqual(readArguments(), ['status', '--json']);
	});

	test('names the context in the environment as well', async () => {
		const { runner, readEnvironment } = runnerWith();

		runner.setContext('us.auth.entire.io');
		await runner.run(['status', '--json']);

		assert.strictEqual(readEnvironment(), 'us.auth.entire.io');
	});

	test('names no context in the environment when none is pinned', async () => {
		const { runner, readEnvironment } = runnerWith();

		await runner.run(['status', '--json'], { env: {} });

		assert.strictEqual(readEnvironment(), '');
	});

	test('leaves the context off the command that lists the logins', async () => {
		const { runner, readArguments, readEnvironment } = runnerWith();

		runner.setContext('us.auth.entire.io');
		await runner.run(['auth', 'contexts'], { ignoreContext: true, env: {} });

		assert.deepStrictEqual(readArguments(), ['auth', 'contexts']);
		assert.strictEqual(readEnvironment(), '');
	});
});

suite('Entire context in the hook bridge', () => {
	/** A runner that records what it was given. */
	class RecordingRunner {
		readonly calls: { args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];

		async run(
			args: readonly string[],
			options: { env?: NodeJS.ProcessEnv } = {},
		): Promise<{ ok: boolean; detail: string }> {
			this.calls.push({ args, env: options.env });
			return { ok: true, detail: '' };
		}

		/** The runner, as the bridge takes it. */
		asRunner(): CliRunner {
			return this as unknown as CliRunner;
		}
	}

	test('names the pinned login in the environment it hands the CLI', async () => {
		const recorder = new RecordingRunner();
		const bridge = new HookBridge({
			runner: recorder.asRunner(),
			workspaceRoot: () => '/work/repo',
			env: { COPILOT_HOME: '/home/tester/.copilot' },
			homeDir: '/home/tester',
			context: () => 'us.auth.entire.io',
		});

		await bridge.deliver('UserPromptSubmit');

		assert.strictEqual(recorder.calls.length, 1);
		assert.strictEqual(recorder.calls[0].env?.ENTIRE_CONTEXT, 'us.auth.entire.io');
		assert.strictEqual(
			recorder.calls[0].env?.COPILOT_HOME,
			'/home/tester/.copilot',
			'the agent home was lost',
		);
	});

	test('names no login in the environment when none is pinned', async () => {
		const recorder = new RecordingRunner();
		const bridge = new HookBridge({
			runner: recorder.asRunner(),
			workspaceRoot: () => '/work/repo',
			env: { COPILOT_HOME: '/home/tester/.copilot' },
			homeDir: '/home/tester',
		});

		await bridge.deliver('UserPromptSubmit');

		assert.strictEqual(recorder.calls.length, 1);
		assert.strictEqual(recorder.calls[0].env?.ENTIRE_CONTEXT, undefined);
	});
});

suite('Entire account context service', () => {
	/** A runner over a fake CLI that prints the logins it has saved. */
	function runnerWith(table: string): CliRunner {
		const home = makeDirectory('entire-context-service-');
		writeFakeCli(path.join(home, '.local', 'bin'), contextsCli(table));

		return new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
	}

	test('reads the login the CLI is acting as', async () => {
		const runner = runnerWith(CONTEXTS_TABLE);

		const reading = await readAccountContext(runner, undefined, undefined);

		assert.strictEqual(reading.acting?.handle, 'sosh-ncampbell');
		assert.strictEqual(reading.pinned, false);
		assert.strictEqual(reading.saved.length, 2);
		assert.strictEqual(reading.problem, undefined);
	});

	test('reports a login the CLI does not have as a problem', async () => {
		const runner = runnerWith(CONTEXTS_TABLE);

		const reading = await readAccountContext(runner, 'nobody', undefined);

		assert.strictEqual(reading.acting, undefined);
		assert.strictEqual(reading.pinned, true);
		assert.strictEqual(
			reading.problem,
			'The Entire CLI has no saved login called "nobody". Saved logins: us.auth.entire.io, sosh-ncampbell@us.auth.entire.io.',
		);
	});

});

suite('Entire account context in the settings', () => {
	const KEY = 'entirely.cliContext';

	suiteTeardown(async () => {
		await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
	});

	test('is read from the settings', async () => {
		await writeSetting(KEY, 'us.auth.entire.io', vscode.ConfigurationTarget.Global);

		assert.strictEqual(readExtensionSettings().cliContext, 'us.auth.entire.io');
	});

	test('is empty when the user has not set one', async () => {
		await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);

		assert.strictEqual(readExtensionSettings().cliContext, undefined);
	});

	test('does not pin a login the CLI does not have', async () => {
		const home = makeDirectory('entire-context-unknown-');
		writeFakeCli(path.join(home, '.local', 'bin'), contextsCli(CONTEXTS_TABLE));

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const service = new AccountContextService(runner);

		await writeSetting(KEY, 'nobody', vscode.ConfigurationTarget.Global);
		try {
			await service.refresh(undefined);
		} finally {
			await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
		}

		assert.strictEqual(runner.context, undefined, 'a login nobody has was pinned');
		assert.ok(service.current.problem, 'the problem was not reported');
	});

	test('pins the login the user named on the runner', async () => {
		const home = makeDirectory('entire-context-pinned-');
		writeFakeCli(path.join(home, '.local', 'bin'), contextsCli(CONTEXTS_TABLE));

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const service = new AccountContextService(runner);

		await writeSetting(KEY, 'us.auth.entire.io', vscode.ConfigurationTarget.Global);
		try {
			await service.refresh(undefined);
		} finally {
			await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
		}

		assert.strictEqual(runner.context, 'us.auth.entire.io');
		assert.strictEqual(service.current.acting?.handle, 'greysquirr3l');
	});
});

suite('Entire account context as a configuration mistake', () => {
	const KEY = 'entirely.cliContext';

	suiteTeardown(async () => {
		await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
	});

	test('is shown as a mistake in the settings rather than a failed command', async () => {
		const home = makeDirectory('entire-context-mistake-');
		writeFakeCli(path.join(home, '.local', 'bin'), contextsCli(CONTEXTS_TABLE));

		const bar = new StatusBar();
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const controller = new StatusController({
			statusBar: bar,
			runner,
			output: { show: () => undefined },
			accounts: new AccountContextService(runner),
		});

		await writeSetting(KEY, 'nobody', vscode.ConfigurationTarget.Global);
		try {
			await controller.refresh();
		} finally {
			await writeSetting(KEY, undefined, vscode.ConfigurationTarget.Global);
			controller.dispose();
			bar.dispose();
		}

		assert.strictEqual(bar.current?.kind, 'context-error');
		const display = bar.current;
		assert.match(
			display?.kind === 'context-error' ? display.detail : '',
			/no saved login called "nobody"/,
		);
	});
});

suite('Entire tokens', () => {
	/** The source files of the extension, without the tests. */
	function productionSources(): string[] {
		const sourceDirectory = path.resolve(__dirname, '..', '..', 'src');

		const walk = (directory: string): string[] =>
			fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
				const file = path.join(directory, entry.name);
				return entry.isDirectory() ? walk(file) : [file];
			});

		return walk(sourceDirectory).filter(
			file => !path.relative(sourceDirectory, file).startsWith(`test${path.sep}`),
		);
	}

	test('are never asked for', () => {
		// The extension reads `auth contexts`, which reports handles and
		// server URLs. Nothing asks the CLI for a token, so no token can
		// reach the output channel.
		const files = productionSources();

		assert.ok(files.length > 0, 'no source files were found');

		for (const file of files) {
			const source = fs.readFileSync(file, 'utf8');
			assert.doesNotMatch(
				source,
				/'token'|"token"|`token`|auth token/,
				`${path.relative(path.resolve(__dirname, '..', '..', 'src'), file)} asks for a token`,
			);
		}
	});

	test('are never asked for by the commands the extension runs', async () => {
		const home = makeDirectory('entire-token-home-');
		writeFakeCli(path.join(home, '.local', 'bin'), contextsCli(CONTEXTS_TABLE));

		const invocations: string[][] = [];
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		runner.setSink({
			report: invocation => {
				invocations.push([...invocation.args]);
			},
		});

		const service = new AccountContextService(runner);
		await service.refresh(undefined);

		assert.ok(invocations.length > 0, 'the CLI was never asked anything');
		for (const args of invocations) {
			assert.ok(
				!args.some(arg => arg.toLowerCase().includes('token')),
				`the CLI was asked for a token: ${args.join(' ')}`,
			);
		}
	});
});
