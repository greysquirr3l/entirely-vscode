import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CliRunner } from '../services/cli';
import { CliLocator } from '../services/cli/locator';
import { WhyService } from '../services/whyService';

suite('Entire why against the real CLI', function () {
	this.timeout(120_000);

	const directories: string[] = [];

	suiteTeardown(() => {
		for (const directory of directories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	/** Creates a temporary directory. */
	function temporary(prefix: string): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

	/** Makes a commit in a repository. */
	function commit(workspace: string, message: string): void {
		execFileSync('git', ['add', '--all'], { cwd: workspace });
		execFileSync(
			'git',
			['-c', 'user.email=tester@example.com', '-c', 'user.name=Tester', 'commit', '--quiet',
				'-m', message],
			{ cwd: workspace },
		);
	}

	test('attributes a line to the commit that made it', async () => {
		const runner = await realCli();
		if (!runner) {
			return;
		}

		const workspace = temporary('entire-why-e2e-');
		execFileSync('git', ['init', '--quiet'], { cwd: workspace });
		fs.writeFileSync(path.join(workspace, 'file.txt'), 'one\ntwo\nthree\n', 'utf8');
		commit(workspace, 'start');

		const service = new WhyService({
			runner,
			workspaceRoot: () => workspace,
		});

		const result = await service.explainLine(path.join(workspace, 'file.txt'), 2);

		assert.strictEqual(result.kind, 'answered');
		if (result.kind !== 'answered' || result.answer.kind !== 'line') {
			assert.fail('the CLI did not answer about the line');
			return;
		}

		assert.strictEqual(result.answer.line.lineNumber, 2);
		assert.strictEqual(result.answer.line.attribution, 'commit');
		assert.strictEqual(result.answer.line.content, 'two');
		assert.ok((result.answer.line.shortCommitSha ?? '').length > 0);
	});

	test('attributes a line to the checkpoint an agent left behind', async () => {
		const runner = await realCli();
		if (!runner) {
			return;
		}

		const workspace = temporary('entire-why-cp-');
		const agentHome = temporary('entire-why-agent-');

		execFileSync('git', ['init', '--quiet'], { cwd: workspace });
		fs.writeFileSync(path.join(workspace, 'file.txt'), 'one\ntwo\n', 'utf8');
		commit(workspace, 'start');

		const enabled = await runner.run(['enable', '--agent', 'copilot-cli', '--no-init-repo'], {
			cwd: workspace,
			timeoutMs: 60_000,
		});
		assert.ok(enabled.ok, `the CLI could not be enabled: ${enabled.ok ? '' : enabled.detail}`);

		const sessionId = 'why-session';
		const transcript = path.join(agentHome, 'session-state', sessionId, 'events.jsonl');
		fs.mkdirSync(path.dirname(transcript), { recursive: true });
		fs.writeFileSync(
			transcript,
			JSON.stringify({
				type: 'tool.execution_complete',
				data: { toolCallId: 't1', model: 'a/model-nobody-knows' },
				id: '1',
				timestamp: '2026-10-27T00:00:01Z',
			}),
			'utf8',
		);

		const env = { ...process.env, COPILOT_HOME: agentHome };
		const started = await runner.run(
			['hooks', 'copilot-cli', 'user-prompt-submitted'],
			{
				cwd: workspace,
				env,
				timeoutMs: 60_000,
				input: JSON.stringify({
					sessionId,
					transcript_path: transcript,
					hookEventName: 'UserPromptSubmit',
					cwd: workspace,
					prompt: 'add a third line',
				}),
			},
		);
		assert.ok(started.ok, `the session could not be started: ${started.ok ? '' : started.detail}`);

		fs.writeFileSync(path.join(workspace, 'file.txt'), 'one\ntwo\nthree\n', 'utf8');
		commit(workspace, 'agent change');

		const service = new WhyService({
			runner,
			workspaceRoot: () => workspace,
		});

		const result = await service.explainLine(path.join(workspace, 'file.txt'), 3);

		assert.strictEqual(result.kind, 'answered');
		if (result.kind !== 'answered' || result.answer.kind !== 'line') {
			assert.fail('the CLI did not answer about the line');
			return;
		}

		assert.strictEqual(result.answer.line.attribution, 'checkpoint');
		assert.strictEqual(result.answer.line.sessionId, sessionId);
		assert.strictEqual(result.answer.line.agent, 'Copilot CLI');
		assert.strictEqual(result.answer.line.prompt, 'add a third line');
		assert.ok((result.answer.line.checkpointId ?? '').length > 0);
	});
});
