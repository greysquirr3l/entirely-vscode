import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

import { CliInvocationRecorder } from '../services/cli/recorder';
import type { CliInvocation, CliInvocationBodies } from '../services/cli/invocation';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { CliInvocationLogger } from '../services/cliLogging';
import { createLogger } from '../services/logger';
import { makeTempDir } from './support/tempDir';

const OUT_SECRET = 'stdout-secret-body';
const ERR_SECRET = 'stderr-secret-body';
const BODY_SECRET = 'review-comment-secret';
const FREE_SECRET = 'free-text-secret';
const OPERAND_SECRET = 'operand-secret-query';

interface Harness {
	readonly runner: CliRunner;
	readonly dir: string;
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
	readonly lines: string[];
	readonly recorder: CliInvocationRecorder;
	/** Each call as `ENTIRE_CONTEXT|argument|argument...`, split by the unit separator. */
	calls(): string[][];
}

/**
 * A fake CLI that logs the argv and ENTIRE_CONTEXT it really received and
 * answers by its first non-flag word: `ok` prints on both streams, `fail`
 * exits 1 with a secret on stderr, `hang` never returns.
 */
function harness(): Harness {
	const dir = makeTempDir('entire-runner-options-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'calls.log');
	const script = [
		'#!/bin/sh',
		'if [ "$1" = version ]; then echo "entire 0.12.2"; exit 0; fi',
		`{ printf '%s' "$ENTIRE_CONTEXT"; for a in "$@"; do printf '\\037%s' "$a"; done; printf '\\n'; } >> '${log}'`,
		'if [ "$1" = "--context" ]; then shift 2; fi',
		'case "$1" in',
		`\tok) echo "${OUT_SECRET}"; echo "${ERR_SECRET}" >&2; exit 0 ;;`,
		`\tfail) echo "${ERR_SECRET}" >&2; echo "${OUT_SECRET}"; exit 1 ;;`,
		'\thang) exec sleep 30 ;;',
		'esac',
		'exit 2',
	].join('\n');
	const binary = path.join(bin, 'entire');
	fs.writeFileSync(binary, `${script}\n`, 'utf8');
	fs.chmodSync(binary, 0o755);

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: Harness['recorded'] = [];
	const lines: string[] = [];
	const recorder = new CliInvocationRecorder();
	const channel = { appendLine: (line: string) => void lines.push(line) } as unknown as vscode.OutputChannel;
	// The loudest level, because the debug level quotes payloads.
	const logger = new CliInvocationLogger(createLogger(channel, () => 'trace'), recorder);
	runner.setSink({
		report: (invocation, bodies) => {
			// The locator's own version probe is not a command under test.
			if (invocation.args.length === 1 && invocation.args[0] === 'version') {
				return;
			}
			recorded.push({ invocation, bodies });
			logger.report(invocation, bodies);
		},
	});
	const calls = (): string[][] =>
		fs.existsSync(log)
			? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.split('\u001f'))
			: [];
	return { runner, dir, recorded, lines, recorder, calls };
}

function lastArgs(h: Harness): readonly string[] {
	const last = h.recorded[h.recorded.length - 1];
	assert.ok(last, 'nothing was recorded');
	return last.invocation.args;
}

suite('Entire runner option combinations', () => {
	test('a named context wins over the pin even when ignoreContext is set', async () => {
		const h = harness();
		h.runner.setContext('pinned');
		const result = await h.runner.run(['ok'], { cwd: h.dir, context: 'x', ignoreContext: true });
		assert.ok(result.ok);
		assert.deepStrictEqual(h.calls(), [['x', '--context', 'x', 'ok']]);
		assert.deepStrictEqual(lastArgs(h), ['--context', 'x', 'ok']);
	});

	test('ignoreContext alone drops the pin from the arguments and the environment', async () => {
		const h = harness();
		h.runner.setContext('pinned');
		await h.runner.run(['ok'], { cwd: h.dir, ignoreContext: true, env: {} });
		assert.deepStrictEqual(h.calls(), [['', 'ok']]);
		assert.deepStrictEqual(lastArgs(h), ['ok']);
	});

	test('a pin with neither option is sent as the flag and the environment', async () => {
		const h = harness();
		h.runner.setContext('pinned');
		await h.runner.run(['ok'], { cwd: h.dir });
		assert.deepStrictEqual(h.calls(), [['pinned', '--context', 'pinned', 'ok']]);
		assert.deepStrictEqual(lastArgs(h), ['--context', 'pinned', 'ok']);
	});

	test('redactOperands alone records everything after -- as redacted while the CLI gets the real argv', async () => {
		const h = harness();
		await h.runner.run(['ok', '--json', '--', OPERAND_SECRET, 'second'], { cwd: h.dir, redactOperands: true });
		assert.deepStrictEqual(lastArgs(h), ['ok', '--json', '--', '<redacted>', '<redacted>']);
		assert.deepStrictEqual(h.calls(), [['', 'ok', '--json', '--', OPERAND_SECRET, 'second']]);
		assert.ok(!h.lines.join('\n').includes(OPERAND_SECRET));
	});

	test('withholdBodies alone keeps output out of the record and the debug log but not from the caller', async () => {
		const h = harness();
		const result = await h.runner.run(['ok'], { cwd: h.dir, withholdBodies: true, input: 'stdin-secret' });
		assert.ok(result.ok);
		assert.strictEqual(result.stdout.trim(), OUT_SECRET);
		assert.strictEqual(result.stderr.trim(), ERR_SECRET);
		const last = h.recorded[h.recorded.length - 1];
		assert.deepStrictEqual(last.bodies, {});
		assert.ok(last.invocation.stdoutBytes > 0 && last.invocation.stderrBytes > 0 && last.invocation.inputBytes > 0);
		const text = h.lines.join('\n');
		for (const secret of [OUT_SECRET, ERR_SECRET, 'stdin-secret']) {
			assert.ok(!text.includes(secret), secret);
		}
		assert.strictEqual(h.recorder.latestBodies()?.stdout ?? '', '');
	});

	suite('combined', () => {
		const ARGS = ['ok', 'comment', '--body', BODY_SECRET, '--message', 'keep', FREE_SECRET, '--', OPERAND_SECRET];
		// --context pair (2) + ok comment --body <r> --message keep <r from index 6> -- <r>
		const EXPECTED_OK = ['--context', 'pinned', 'ok', 'comment', '--body', '<redacted>', '--message', 'keep', '<redacted>', '<redacted>', '<redacted>'];

		function assertNoSecrets(h: Harness): void {
			const everything = [JSON.stringify(h.recorded.map(item => item.invocation)), h.lines.join('\n')].join('\n');
			for (const secret of [BODY_SECRET, FREE_SECRET, OPERAND_SECRET, OUT_SECRET, ERR_SECRET]) {
				assert.ok(!everything.includes(secret), `${secret} leaked`);
			}
			assert.deepStrictEqual(h.recorded.map(item => item.bodies).filter(b => Object.keys(b).length > 0), []);
		}

		test('every redaction lands on the right argument with the --context pair accounted for', async () => {
			const h = harness();
			h.runner.setContext('pinned');
			const result = await h.runner.run(ARGS, {
				cwd: h.dir,
				redactFlags: ['--body'],
				redactFrom: 6,
				redactOperands: true,
				withholdBodies: true,
			});
			assert.ok(result.ok);
			assert.strictEqual(result.stdout.trim(), OUT_SECRET);
			assert.deepStrictEqual(lastArgs(h), EXPECTED_OK);
			assert.deepStrictEqual(h.calls(), [['pinned', '--context', 'pinned', ...ARGS]]);
			assertNoSecrets(h);
		});

		test('a failing invocation reports the same redactions and no secret in its detail', async () => {
			const h = harness();
			h.runner.setContext('pinned');
			const args = ['fail', ...ARGS.slice(1)];
			const result = await h.runner.run(args, {
				cwd: h.dir,
				redactFlags: ['--body'],
				redactFrom: 6,
				redactOperands: true,
				withholdBodies: true,
			});
			assert.ok(!result.ok);
			assert.strictEqual(result.stderr.trim(), ERR_SECRET);
			assert.deepStrictEqual(lastArgs(h), ['--context', 'pinned', ...EXPECTED_OK.slice(2).map((a, i) => (i === 0 ? 'fail' : a))]);
			assert.ok(!result.detail.includes(ERR_SECRET) && !result.detail.includes(BODY_SECRET));
			assertNoSecrets(h);
		});

		test('a timed-out invocation reports the same redactions and no secret', async () => {
			const h = harness();
			h.runner.setContext('pinned');
			const args = ['hang', ...ARGS.slice(1)];
			const result = await h.runner.run(args, {
				cwd: h.dir,
				timeoutMs: 400,
				redactFlags: ['--body'],
				redactFrom: 6,
				redactOperands: true,
				withholdBodies: true,
			});
			assert.ok(!result.ok);
			assert.strictEqual(result.reason, 'timeout');
			assert.strictEqual(h.recorded[h.recorded.length - 1].invocation.outcome, 'timeout');
			assert.strictEqual(lastArgs(h)[2], 'hang');
			assert.ok(lastArgs(h).slice(3).every(a => !a.includes('secret')));
			assert.ok(!result.detail.includes(BODY_SECRET));
			assertNoSecrets(h);
		});
	});
});
