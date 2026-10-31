import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { LineSplitter, STDERR_TAIL_BYTES, type StreamEnd } from '../services/cli/stream';
import type { CliInvocation, CliInvocationBodies } from '../services/cli/invocation';
import { makeTempDir } from './support/tempDir';

/** A fake `entire` whose commands run a shell body. `version` is answered so discovery works. */
function streamingCli(body: string, version = 'echo "entire 0.12.2"'): { runner: CliRunner; binary: string; dir: string } {
	const dir = makeTempDir('entire-stream-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const binary = path.join(bin, 'entire');
	// The --context pair is skipped so `$1` is the command, as the real CLI reads it.
	const script = [
		'#!/bin/sh',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		'case "$1" in',
		`version) ${version} ;;`,
		'*)',
		body,
		';;',
		'esac',
	].join('\n');
	fs.writeFileSync(binary, `${script}\n`, 'utf8');
	fs.chmodSync(binary, 0o755);
	return { runner: new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } })), binary, dir };
}

async function drain(runner: CliRunner, args: string[], options: Partial<Parameters<CliRunner['stream']>[1]> = {}): Promise<{ lines: string[]; end: StreamEnd }> {
	const lines: string[] = [];
	const handle = runner.stream(args, { onLine: line => lines.push(line), ...options });
	return { lines, end: await handle.done };
}

suite('Line splitting', () => {
	test('joins a line that arrives in several chunks and returns the lines a chunk completed', () => {
		const splitter = new LineSplitter();
		assert.deepStrictEqual(splitter.push('one\ntw'), ['one']);
		assert.deepStrictEqual(splitter.push('o\nthree'), ['two']);
		assert.deepStrictEqual(splitter.push('\r\nfour\n'), ['three', 'four']);
		assert.strictEqual(splitter.flush(), undefined);
	});

	test('keeps a final line that has no break until the end', () => {
		const splitter = new LineSplitter();
		assert.deepStrictEqual(splitter.push('last'), []);
		assert.strictEqual(splitter.flush(), 'last');
		assert.strictEqual(splitter.flush(), undefined);
	});

	test('drops a line that never ends rather than growing without bound', () => {
		const splitter = new LineSplitter();
		assert.deepStrictEqual(splitter.push('x'.repeat(2 * 1024 * 1024)), []);
		assert.strictEqual(splitter.flush(), undefined);
	});
});

suite('CliRunner.stream', () => {
	test('splits lines across chunks and handles a final line with no newline', async () => {
		const { runner } = streamingCli(`printf 'one\\ntw'; sleep 0.05; printf 'o\\nthree'`);
		const { lines, end } = await drain(runner, ['watch']);

		assert.deepStrictEqual(lines, ['one', 'two', 'three']);
		assert.deepStrictEqual(end, { kind: 'exited', code: 0, stderr: '' });
	});

	test('reports a non-zero exit with the tail of stderr, bounded', async () => {
		const { runner } = streamingCli(`i=0; while [ $i -lt 600 ]; do echo "line $i of a long complaint that goes on and on and on" >&2; i=$((i+1)); done; echo "the end" >&2; exit 3`);
		const { end } = await drain(runner, ['watch']);

		assert.strictEqual(end.kind, 'exited');
		assert.ok(end.kind === 'exited');
		assert.strictEqual(end.code, 3);
		assert.ok(end.stderr.length <= STDERR_TAIL_BYTES, `kept ${end.stderr.length} bytes`);
		assert.ok(end.stderr.trimEnd().endsWith('the end'), 'the tail is what is kept');
	});

	test('applies the pinned login, and a login named for the command wins', async () => {
		const { runner } = streamingCli('echo "ctx=$CTX env=$ENTIRE_CONTEXT first=$1"');
		runner.setContext('pinned@host');
		const pinned = await drain(runner, ['watch']);
		assert.deepStrictEqual(pinned.lines, ['ctx=pinned@host env=pinned@host first=watch']);

		const named = await drain(runner, ['watch'], { context: 'ada@host' });
		assert.deepStrictEqual(named.lines, ['ctx=ada@host env=ada@host first=watch']);

		const none = streamingCli('echo "ctx=$CTX env=$ENTIRE_CONTEXT"');
		assert.deepStrictEqual((await drain(none.runner, ['watch'])).lines, ['ctx= env=']);
	});

	test('reports a missing CLI and a broken one as values, and never throws', async () => {
		const empty = new CliRunner(new CliLocator({ homeDir: makeTempDir('entire-nocli-'), env: { PATH: '' } }));
		const missing = await drain(empty, ['watch']);
		assert.strictEqual(missing.end.kind, 'no-cli');
		assert.deepStrictEqual(missing.lines, []);

		const broken = streamingCli('echo never', 'exit 1');
		const result = await drain(broken.runner, ['watch']);
		assert.strictEqual(result.end.kind, 'no-cli');
	});

	test('reports a process that cannot start as spawn-failed', async () => {
		const { runner, binary } = streamingCli('echo hi');
		await runner.discover();
		fs.chmodSync(binary, 0o644);
		const { end } = await drain(runner, ['watch']);

		assert.strictEqual(end.kind, 'spawn-failed');
	});

	test('stop ends the process and reports stopped; stopping again does nothing', async () => {
		const { runner, dir } = streamingCli(`echo $$ > "$PWD/pid"; echo ready; exec sleep 30`);
		const lines: string[] = [];
		const handle = runner.stream(['watch'], { onLine: line => lines.push(line), cwd: dir });
		const started = Date.now();
		while (!lines.includes('ready')) {
			assert.ok(Date.now() - started < 5000, 'the stream never said ready');
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		handle.stop();
		handle.stop();
		const end = await handle.done;

		assert.deepStrictEqual(end, { kind: 'stopped' });
		const pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
		assert.throws(() => process.kill(pid, 0), 'the process is gone');
	});

	test('a stop before the process starts means it never runs', async () => {
		const { runner, dir } = streamingCli(`echo ran > "$PWD/ran"; echo hi`);
		const handle = runner.stream(['watch'], { onLine: () => undefined, cwd: dir });
		handle.stop();
		const end = await handle.done;

		assert.strictEqual(end.kind, 'stopped');
		assert.throws(() => fs.readFileSync(path.join(dir, 'ran'), 'utf8'));
	});

	test('an aborted signal stops the stream', async () => {
		const { runner } = streamingCli('echo ready; exec sleep 30');
		const controller = new AbortController();
		const lines: string[] = [];
		const handle = runner.stream(['watch'], { onLine: line => lines.push(line), signal: controller.signal });
		const started = Date.now();
		while (lines.length === 0) {
			assert.ok(Date.now() - started < 5000);
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		controller.abort();
		assert.deepStrictEqual(await handle.done, { kind: 'stopped' });
	});

	test('writes no stdout to the output record, and records the start and the end with typed values left out', async () => {
		const { runner } = streamingCli('echo "secret event text"');
		const records: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
		runner.setSink({ report: (invocation, bodies) => records.push({ invocation, bodies }) });
		await drain(runner, ['watch', '--title', 'typed words'], { redactFlags: ['--title'] });

		const stream = records.filter(record => record.invocation.args.includes('watch'));
		assert.strictEqual(stream.length, 2, 'one entry for the start and one for the end');
		assert.strictEqual(stream[0].invocation.detail, 'streaming');
		assert.strictEqual(stream[1].invocation.outcome, 'ok');
		assert.ok(!JSON.stringify(records).includes('secret event text'));
		assert.ok(!JSON.stringify(records).includes('typed words'));
		assert.ok(stream.every(record => record.bodies.stdout === undefined && record.bodies.stderr === undefined));
		assert.ok(stream.every(record => record.invocation.stdoutBytes === 0));
	});
});
