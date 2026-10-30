import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	EDITOR_LOADED_HOOKS_DIRECTORY,
	HOOK_EVENTS,
	HookBridge,
	copilotHome,
	resolveHookName,
	transcriptPath,
	type CliHookName,
	type EditorHookEvent,
	type HookPayload,
} from '../services/hookBridge';
import type { CliRunner } from '../services/cli';
import { makeTempDir } from './support/tempDir';
import { FixedTargets, bridgedTarget } from './support/hookTargets';

/** A runner that records what it was asked to run. */
class RecordingRunner {
	readonly calls: { args: readonly string[]; input?: string; cwd?: string }[] = [];
	/** What the runner reports when it runs. */
	failure: { reason: 'absent' | 'exit-code'; detail: string } | undefined;
	/** How long the runner takes to report itself. */
	delayMs = 0;

	async run(
		args: readonly string[],
		options: { input?: string; cwd?: string } = {},
	): Promise<{ ok: boolean; detail: string }> {
		// The call is recorded after a tick, the way a real process would
		// report itself, so a test can tell a call that has been started
		// from one that has been waited for.
		await new Promise(resolve => setTimeout(resolve, this.delayMs));
		this.calls.push({ args, input: options.input, cwd: options.cwd });

		if (this.failure) {
			return { ok: false, detail: this.failure.detail };
		}

		return { ok: true, detail: '' };
	}

	/** The runner, as the bridge takes it. */
	asRunner(): CliRunner {
		return this as unknown as CliRunner;
	}
}

/** A temporary directory that is removed when the suite ends. */
const directories: string[] = [];

suiteTeardown(() => {
	for (const directory of directories) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

/** Creates a temporary directory. */
function temporary(): string {
	const directory = makeTempDir('entire-hooks-');
	directories.push(directory);
	return directory;
}

/** The bridge under test, with a recording runner. */
function bridgeWith(
	runner: RecordingRunner,
	workspaceRoot: string | undefined,
	env: NodeJS.ProcessEnv = {},
): HookBridge {
	return new HookBridge({
		runner: runner.asRunner(),
		workspaceRoot: () => workspaceRoot,
		agents: new FixedTargets(bridgedTarget('copilot-cli')),
		env,
		homeDir: '/home/tester',
	});
}

suite('Entire hook mapping', () => {
	test('every editor event maps to a CLI verb, except the one that has none', () => {
		for (const route of HOOK_EVENTS) {
			const verb = resolveHookName(route.event);
			if (route.hook) {
				assert.strictEqual(verb, route.hook, `${route.event} maps to the wrong verb`);
			} else {
				assert.strictEqual(verb, undefined, `${route.event} has no verb to send`);
			}
		}
	});

	test('the table covers every editor event exactly once', () => {
		const events = HOOK_EVENTS.map(route => route.event);
		assert.strictEqual(new Set(events).size, events.length);
	});

	test('a terminal stop ends the session and an ordinary one ends the turn', () => {
		assert.strictEqual(resolveHookName('Stop', false), 'agent-stop');
		assert.strictEqual(resolveHookName('Stop', true), 'session-end');
	});

	test('the editor names are not the CLI names', () => {
		// The CLI drops a payload whose event name does not match the verb
		// it was sent with, without a word, so the two vocabularies have
		// to be kept apart.
		assert.notStrictEqual(resolveHookName('UserPromptSubmit'), 'UserPromptSubmitted');
		assert.strictEqual(resolveHookName('UserPromptSubmit'), 'user-prompt-submitted');
	});

	test('no editor event maps to the CLI names directly', () => {
		const verbs: CliHookName[] = [
			'session-start',
			'user-prompt-submitted',
			'agent-stop',
			'session-end',
			'pre-tool-use',
			'post-tool-use',
			'subagent-start',
			'subagent-stop',
			'error-occurred',
		];

		for (const route of HOOK_EVENTS) {
			assert.ok(
				!verbs.includes(route.event as CliHookName),
				`${route.event} is not an editor event name`,
			);
		}
	});
});

suite('Entire hook payloads', () => {
	test('uses the editor dialect', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('UserPromptSubmit', { prompt: 'do the thing' });

		const call = runner.calls[0];
		assert.deepStrictEqual(call.args, ['hooks', 'copilot-cli', 'user-prompt-submitted']);

		const payload = JSON.parse(call.input ?? '{}') as HookPayload;
		assert.strictEqual(payload.hookEventName, 'UserPromptSubmit');
		assert.strictEqual(payload.prompt, 'do the thing');
		assert.ok(payload.sessionId.length > 0);
		assert.ok(payload.cwd.length > 0);
	});

	test('never uses the camel-case spelling of the transcript path', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('SessionStart', {});

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as Record<string, unknown>;
		assert.ok('transcript_path' in payload);
		assert.ok(!('transcriptPath' in payload));
	});

	test('never sends a timestamp, which would change the dialect', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('SessionStart', {});

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as Record<string, unknown>;
		assert.ok(!('timestamp' in payload));
	});

	test('never sends a model, which the CLI resolves from the transcript', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('Stop', {});

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as Record<string, unknown>;
		assert.ok(!('model' in payload));
	});

	test('puts the transcript under a directory named for the session', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary(), { COPILOT_HOME: '/agent/home' });

		await bridge.deliver('Stop', { sessionId: 'session-42' });

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as HookPayload;
		assert.strictEqual(payload.sessionId, 'session-42');
		assert.strictEqual(
			payload.transcript_path,
			path.join('/agent/home', 'session-state', 'session-42', 'events.jsonl'),
		);
	});

	test('finds the agent home from the environment', () => {
		assert.strictEqual(copilotHome({ COPILOT_HOME: '/agent/home' }, '/home/tester'), '/agent/home');
		assert.strictEqual(copilotHome({}, '/home/tester'), path.join('/home/tester', '.copilot'));
	});

	test('builds the transcript path from the session', () => {
		assert.strictEqual(
			transcriptPath('s1', '/agent/home'),
			path.join('/agent/home', 'session-state', 's1', 'events.jsonl'),
		);
	});

	test('an ordinary stop carries the turn reason', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('Stop', {});

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as HookPayload;
		assert.strictEqual(payload.stopReason, 'end_turn');
		assert.strictEqual(payload.reason, undefined);
	});

	test('a terminal stop carries the session reason', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('Stop', { terminal: true });

		const payload = JSON.parse(runner.calls[0].input ?? '{}') as HookPayload;
		assert.ok((payload.reason ?? '').length > 0);
		assert.strictEqual(payload.stopReason, undefined);
	});

	test('a terminal stop is sent as the session end', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('Stop', { terminal: true });

		assert.deepStrictEqual(runner.calls[0].args, ['hooks', 'copilot-cli', 'session-end']);
	});
});

suite('Entire hook delivery', () => {
	test('keeps the same session for the lifetime of the workspace', async () => {
		const runner = new RecordingRunner();
		const workspace = temporary();
		const bridge = bridgeWith(runner, workspace);

		await bridge.deliver('SessionStart', {});
		await bridge.deliver('UserPromptSubmit', {});
		await bridge.deliver('Stop', {});

		const sessions = runner.calls.map(
			call => (JSON.parse(call.input ?? '{}') as HookPayload).sessionId,
		);

		assert.strictEqual(new Set(sessions).size, 1);
	});

	test('gives each workspace its own session', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		const first = bridge.sessionId('/work/one');
		const second = bridge.sessionId('/work/two');

		assert.notStrictEqual(first, second);
		assert.strictEqual(bridge.sessionId('/work/one'), first);
	});

	test('sends nothing for an event the CLI cannot carry', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		const delivered = await bridge.deliver('PreCompact', {});

		assert.strictEqual(delivered, false);
		assert.strictEqual(runner.calls.length, 0);
	});

	test('stands down for an agent whose hook file the editor loads itself', async () => {
		const runner = new RecordingRunner();
		const bridge = new HookBridge({
			runner: runner.asRunner(),
			workspaceRoot: () => '/work/repo',
			agents: new FixedTargets(
				bridgedTarget('copilot-cli', [`${EDITOR_LOADED_HOOKS_DIRECTORY}entire.json`]),
			),
		});

		const results = await bridge.deliverToAgents('SessionStart', {});

		assert.deepStrictEqual(results, [{ agent: 'copilot-cli', delivered: false, skipped: 'already-reported' }]);
		assert.strictEqual(runner.calls.length, 0);
	});

	test('reports nothing when the CLI is missing', async () => {
		const runner = new RecordingRunner();
		runner.failure = { reason: 'absent', detail: 'no entire binary found' };

		const bridge = bridgeWith(runner, temporary());

		const delivered = await bridge.deliver('SessionStart', {});

		assert.strictEqual(delivered, false);
	});

	test('reports nothing when the CLI fails', async () => {
		const runner = new RecordingRunner();
		runner.failure = { reason: 'exit-code', detail: 'exit 1' };

		const bridge = bridgeWith(runner, temporary());

		const delivered = await bridge.deliver('SessionStart', {});

		assert.strictEqual(delivered, false);
	});

	test('does not wait for the delivery', async () => {
		const runner = new RecordingRunner();
		runner.delayMs = 20;
		const bridge = bridgeWith(runner, temporary());

		// The call returns before the runner has been given anything, which
		// is what keeps a hook from standing between the user and the thing
		// they asked for.
		bridge.post('SessionStart', {});

		assert.strictEqual(runner.calls.length, 0);

		// It is still delivered, just not waited for.
		await new Promise(resolve => setTimeout(resolve, 60));
		assert.strictEqual(runner.calls.length, 1);
	});

	test('sends the payload on stdin', async () => {
		const runner = new RecordingRunner();
		const bridge = bridgeWith(runner, temporary());

		await bridge.deliver('UserPromptSubmit', { prompt: 'hello' });

		assert.ok((runner.calls[0].input ?? '').includes('"prompt":"hello"'));
	});
});
