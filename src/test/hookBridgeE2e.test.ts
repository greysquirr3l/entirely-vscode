import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CliRunner } from '../services/cli';
import { makeTempDir } from './support/tempDir';
import { FixedTargets, supportedTarget } from './support/hookTargets';
import { CliLocator } from '../services/cli/locator';
import { HookBridge } from '../services/hookBridge';
import { decodeWorkspaceStatus, unwrap } from '../lib/entire';

/**
 * A model the extension has never heard of.
 *
 * The point of the test is that the string reaches the CLI untouched, so
 * it is deliberately one no allowlist would contain.
 */
const BYOK_MODEL = 'minimax/MiniMax-M3.1-Flash-Preview';

suite('Entire hook bridge against the real CLI', function () {
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

	/** The real CLI, when there is one. */
	async function realCli(): Promise<CliRunner | undefined> {
		const locator = new CliLocator();
		const discovery = await locator.current();
		if (discovery.state !== 'available') {
			return undefined;
		}
		return new CliRunner(locator);
	}

	test('records the model the transcript reports, untouched', async () => {
		const runner = await realCli();
		if (!runner) {
			// The extension is tested against a CLI that is not there all
			// the time, and there is nothing to check without one.
			return;
		}

		const workspace = temporary('entire-hook-e2e-');
		const agentHome = temporary('entire-hook-agent-');

		execFileSync('git', ['init', '--quiet'], { cwd: workspace });
		execFileSync(
			'git',
			['-c', 'user.email=tester@example.com', '-c', 'user.name=Tester', 'commit', '--quiet',
				'--allow-empty', '-m', 'start'],
			{ cwd: workspace },
		);

		const enabled = await runner.run(['enable', '--agent', 'copilot-cli', '--no-init-repo'], {
			cwd: workspace,
			timeoutMs: 60_000,
		});
		assert.ok(enabled.ok, `the CLI could not be enabled: ${enabled.ok ? '' : enabled.detail}`);

		// Enabling installs the CLI's own hooks for Copilot CLI, and the
		// bridge stands down when they are there so the same activity is
		// not reported twice. The repository stays enabled, which is what
		// the CLI needs to accept a hook, but the bridge is the reporter.
		fs.rmSync(path.join(workspace, '.github', 'hooks', 'entire.json'), { force: true });

		const sessionId = 'session-for-the-test';
		const transcript = path.join(agentHome, 'session-state', sessionId, 'events.jsonl');
		fs.mkdirSync(path.dirname(transcript), { recursive: true });
		fs.writeFileSync(
			transcript,
			[
				JSON.stringify({
					type: 'user.message',
					data: { content: 'do the thing' },
					id: '1',
					timestamp: '2026-10-27T00:00:00Z',
				}),
				JSON.stringify({
					type: 'tool.execution_complete',
					data: { toolCallId: 't1', model: BYOK_MODEL },
					id: '2',
					timestamp: '2026-10-27T00:00:01Z',
				}),
			].join('\n'),
			'utf8',
		);

		const env = { ...process.env, COPILOT_HOME: agentHome };
		const bridge = new HookBridge({
			runner,
			workspaceRoot: () => workspace,
			// The agent list is fixed here: the hook file the CLI wrote was
			// removed above, so the CLI no longer lists the agent as installed.
			agents: new FixedTargets([supportedTarget('copilot-cli')]),
			env,
		});

		assert.strictEqual(
			await bridge.deliver('UserPromptSubmit', { sessionId, prompt: 'do the thing' }),
			true,
		);
		assert.strictEqual(await bridge.deliver('Stop', { sessionId }), true);

		const status = await runner.runJson(
			['status', '--json'],
			value => unwrap(decodeWorkspaceStatus(value)),
			{ cwd: workspace, timeoutMs: 60_000 },
		);
		assert.ok(status.ok, `the CLI could not be read: ${status.ok ? '' : status.detail}`);
		if (!status.ok) {
			return;
		}

		const session = status.value.kind === 'tracked' ? status.value.activeSessions[0] : undefined;
		assert.ok(session, 'the session the bridge reported was not recorded');
		assert.strictEqual(session.model, BYOK_MODEL);
	});
});
