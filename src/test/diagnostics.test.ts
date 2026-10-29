import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { doctor, type ReportSink } from '../commands/doctor';
import { dumpCliOutput } from '../commands/dumpCliOutput';
import { AccountContextService } from '../services/accountContext';
import {
	byteLength,
	excerptPayload,
	formatBytes,
	quoteArgument,
	renderCommandLine,
	type CliInvocation,
} from '../services/cli/invocation';
import { CliInvocationRecorder } from '../services/cli/recorder';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { CliInvocationLogger } from '../services/cliLogging';
import type { Logger } from '../services/logger';
import { isGitRepository } from '../services/repository';

/** The `status --json` shape of a tracked repository, as the CLI prints it. */
const TRACKED_STATUS =
	'{"enabled":true,"agents":["Copilot CLI"],"active_sessions":[{"agent":"Copilot CLI","session_id":"abc-123","worktree_path":"/work/sandbox","branch":"master","status":"active"}],"agent_help":"entire agent-help"}';

/** A CLI that answers the commands the extension uses. */
const WORKING_CLI = [
	'case "$1" in',
	'\tversion) echo "entire 0.12.2" ;;',
	`\tstatus) echo '${TRACKED_STATUS}' ;;`,
	'\thooks) cat ;;',
	'\t*) echo "unknown command" >&2; exit 2 ;;',
	'esac',
].join('\n');

/** A CLI that works until it is asked for the workspace status. */
const FAILING_STATUS_CLI = [
	'case "$1" in',
	'\tversion) echo "entire 0.12.2" ;;',
	'\tstatus) echo "the repository is locked" >&2; exit 3 ;;',
	'\t*) echo "unknown command" >&2; exit 2 ;;',
	'esac',
].join('\n');

/** A line the logger said. */
interface CapturedLine {
	readonly level: string;
	readonly message: string;
}

/** A logger that keeps what it was told, so a test can read it back. */
function capturingLogger(): { logger: Logger; lines: CapturedLine[] } {
	const lines: CapturedLine[] = [];

	const say =
		(level: string) =>
		(message: string): void => {
			lines.push({ level, message });
		};

	return {
		logger: {
			error: say('error'),
			warn: say('warn'),
			info: say('info'),
			debug: say('debug'),
			trace: say('trace'),
		},
		lines,
	};
}

/** The messages said at one level. */
function said(lines: readonly CapturedLine[], level: string): string {
	return lines
		.filter(line => line.level === level)
		.map(line => line.message)
		.join('\n');
}

/** Everything that was said, at any level. */
function saidEverything(lines: readonly CapturedLine[]): string {
	return lines.map(line => line.message).join('\n');
}

/** An output channel that keeps what was written to it. */
class FakeSink implements ReportSink {
	readonly lines: string[] = [];
	shown = 0;

	appendLine(line: string): void {
		this.lines.push(line);
	}

	show(): void {
		this.shown += 1;
	}

	/** Everything that was written. */
	get text(): string {
		return this.lines.join('\n');
	}
}

/** An invocation that worked. */
function invocation(): CliInvocation {
	return {
		binary: '/usr/local/bin/entire',
		args: ['status', '--json'],
		cwd: '/work/entirely',
		outcome: 'ok',
		exitCode: 0,
		durationMs: 12,
		inputBytes: 0,
		stdoutBytes: 128,
		stderrBytes: 0,
		detail: undefined,
	};
}

suite('Entire diagnostics', () => {
	const temporaryDirectories: string[] = [];

	suiteTeardown(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function makeDirectory(prefix: string): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}

	/** Writes a fake `entire` binary into a directory and returns the path. */
	function writeFakeCli(directory: string, body: string): string {
		fs.mkdirSync(directory, { recursive: true });
		const file = path.join(directory, 'entire');
		fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
		fs.chmodSync(file, 0o755);
		return file;
	}

	/** A runner bound to a fake CLI in its own fake home directory. */
	function runnerFor(body: string): {
		runner: CliRunner;
		recorder: CliInvocationRecorder;
		captured: CapturedLine[];
		binary: string;
	} {
		const home = makeDirectory('entire-diagnostics-home-');
		const binary = writeFakeCli(path.join(home, '.local', 'bin'), body);
		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		const runner = new CliRunner(locator);
		const recorder = new CliInvocationRecorder();
		const captured = capturingLogger();

		runner.setSink(new CliInvocationLogger(captured.logger, recorder));

		return { runner, recorder, captured: captured.lines, binary };
	}

	test('writes the command line and the exit code of an invocation to the channel', async () => {
		const { runner, captured, binary } = runnerFor(WORKING_CLI);
		const workspace = makeDirectory('entire-diagnostics-workspace-');

		const result = await runner.run(['status', '--json'], { cwd: workspace });

		assert.strictEqual(result.ok, true);

		const saidAtInfo = said(captured, 'info');
		assert.match(saidAtInfo, /entire:/);
		assert.ok(
			saidAtInfo.includes(`${binary} status --json`),
			`the command line is not in the channel: ${saidAtInfo}`,
		);
		assert.ok(
			saidAtInfo.includes(`cwd: ${workspace}`),
			`the working directory is not in the channel: ${saidAtInfo}`,
		);
		assert.match(saidAtInfo, /exit: 0 \(ok, \d+ms\)/);
	});

	test('writes the exit code of a failing invocation to the channel', async () => {
		const { runner, captured } = runnerFor(FAILING_STATUS_CLI);

		const result = await runner.run(['status', '--json']);

		assert.strictEqual(result.ok, false);
		assert.match(said(captured, 'info'), /exit: 3 \(exit-code, \d+ms\)/);
		assert.match(said(captured, 'warn'), /failed:/);
	});

	test('reports the discovery probe as an invocation too', async () => {
		const { runner, captured, binary } = runnerFor(WORKING_CLI);

		await runner.discover();

		assert.ok(
			said(captured, 'info').includes(`${binary} version`),
			'the version probe is not in the channel',
		);
	});

	test('does not write a prompt body to the channel at the default log level', async () => {
		const { runner, captured } = runnerFor(WORKING_CLI);
		const secret = 'the prompt the user typed and did not want logged';

		const result = await runner.run(['hooks', 'copilot-cli', 'user-prompt-submitted'], {
			input: JSON.stringify({ prompt: secret }),
		});

		assert.strictEqual(result.ok, true);

		const ordinary = saidEverything(captured.filter(line => line.level !== 'debug'));
		assert.ok(
			!ordinary.includes(secret),
			`the prompt body was written to the channel: ${ordinary}`,
		);

		// The size of the body is still reported, so that a user can tell
		// that a body was sent even though it was not shown.
		assert.match(said(captured, 'info'), /stdin \d+ B/);
	});

	test('shows an excerpt of a prompt body when the log level is raised', async () => {
		const { runner, captured } = runnerFor(WORKING_CLI);
		const secret = 'the prompt the user typed';

		await runner.run(['hooks', 'copilot-cli', 'user-prompt-submitted'], {
			input: JSON.stringify({ prompt: secret }),
		});

		assert.match(said(captured, 'debug'), /stdin: /);
	});

	test('keeps the bodies of the last invocation for the explicit command', async () => {
		const { runner, recorder } = runnerFor(WORKING_CLI);

		await runner.run(['status', '--json']);

		const bodies = recorder.latestBodies();
		assert.ok(bodies, 'the invocation was not remembered');
		assert.ok(bodies.stdout?.includes('"enabled":true'), 'the payload was not kept');
	});

	test('remembers the last failure even after a later success', async () => {
		const { runner, recorder } = runnerFor(FAILING_STATUS_CLI);

		await runner.run(['status', '--json']);

		const failure = recorder.lastFailure();
		assert.ok(failure, 'the failure was not remembered');
		assert.strictEqual(failure.reason, 'exit-code');
		assert.match(failure.commandLine, /status --json/);
	});

	test('the doctor report names the CLI version and the workspace state', async () => {
		const { runner, recorder } = runnerFor(WORKING_CLI);
		const workspace = makeDirectory('entire-diagnostics-doctor-');
		const sink = new FakeSink();

		await doctor({
			runner,
			accounts: new AccountContextService(runner),
			recorder,
			workspaceRoot: () => workspace,
			output: sink,
			notify: async () => undefined,
		});

		const report = sink.text;
		assert.match(report, /Entirely doctor report/);
		assert.match(report, /0\.12\.2/, 'the CLI version is not in the report');
		assert.match(report, /Entire enabled: yes/, 'the workspace state is not in the report');
		assert.match(report, /Git repository: no/);
		assert.ok(report.includes(workspace), 'the workspace folder is not in the report');
		assert.match(report, /Last CLI error/);
	});

	test('the doctor report says what went wrong', async () => {
		const { runner, recorder } = runnerFor(FAILING_STATUS_CLI);
		const workspace = makeDirectory('entire-diagnostics-doctor-failing-');
		const sink = new FakeSink();

		await doctor({
			runner,
			accounts: new AccountContextService(runner),
			recorder,
			workspaceRoot: () => workspace,
			output: sink,
			notify: async () => undefined,
		});

		const report = sink.text;
		assert.match(report, /Reason: exit-code/);
		assert.match(report, /Command: .*status --json/);
	});

	test('the doctor report is copyable in one action', async () => {
		const { runner, recorder } = runnerFor(WORKING_CLI);
		const workspace = makeDirectory('entire-diagnostics-doctor-copy-');
		const sink = new FakeSink();
		let copied: string | undefined;

		await doctor({
			runner,
			accounts: new AccountContextService(runner),
			recorder,
			workspaceRoot: () => workspace,
			output: sink,
			notify: async (_message, actions) =>
				actions.includes('Copy to Clipboard') ? 'Copy to Clipboard' : undefined,
			copy: async text => {
				copied = text;
			},
		});

		assert.ok(copied, 'the report was not copied');
		assert.match(copied, /0\.12\.2/);
		assert.strictEqual(copied, sink.text.split('\n').slice(1).join('\n').trim());
	});

	test('the dump command writes the whole of the last payload', async () => {
		const { runner, recorder } = runnerFor(WORKING_CLI);
		const sink = new FakeSink();

		await runner.run(['status', '--json']);

		await dumpCliOutput({ recorder, output: sink, notify: async () => undefined });

		assert.match(sink.text, /### stdout/);
		assert.ok(sink.text.includes('"enabled":true'), 'the payload was not written');
	});

	test('the dump command says so when there is nothing to show', async () => {
		const recorder = new CliInvocationRecorder();
		const sink = new FakeSink();
		let told = '';

		await dumpCliOutput({
			recorder,
			output: sink,
			notify: async message => {
				told = message;
				return undefined;
			},
		});

		assert.match(told, /has not been run yet/);
		assert.strictEqual(sink.text, '');
	});
});

suite('Entire invocation helpers', () => {
	test('quotes an argument the way a shell would', () => {
		assert.strictEqual(quoteArgument('status'), 'status');
		assert.strictEqual(quoteArgument('--json'), '--json');
		assert.strictEqual(quoteArgument(''), "''");
		assert.strictEqual(quoteArgument('a b'), '"a b"');
		assert.strictEqual(quoteArgument('say "hi"'), '"say \\"hi\\""');
	});

	test('renders the command line of an invocation', () => {
		assert.strictEqual(
			renderCommandLine('/usr/local/bin/entire', ['status', '--json']),
			'/usr/local/bin/entire status --json',
		);
		assert.strictEqual(
			renderCommandLine('/usr/local/bin/entire', ['hooks', 'a b']),
			'/usr/local/bin/entire hooks "a b"',
		);
	});

	test('counts the bytes of a body', () => {
		assert.strictEqual(byteLength(undefined), 0);
		assert.strictEqual(byteLength(''), 0);
		assert.strictEqual(byteLength('abc'), 3);
		assert.strictEqual(byteLength('é'), 2);
	});

	test('formats a size for a human to read', () => {
		assert.strictEqual(formatBytes(0), '0 B');
		assert.strictEqual(formatBytes(512), '512 B');
		assert.strictEqual(formatBytes(2048), '2.0 kB');
		assert.strictEqual(formatBytes(3 * 1024 * 1024), '3.0 MB');
	});

	test('shortens a payload to something that may be shown', () => {
		assert.strictEqual(excerptPayload('  a\n b  '), 'a b');
		assert.strictEqual(excerptPayload('abcdef', 4), 'abcd...');
	});
});

suite('Entire invocation recorder', () => {
	test('keeps the invocations it has seen', () => {
		const recorder = new CliInvocationRecorder();

		recorder.record(invocation(), {});
		recorder.record(invocation(), {});

		assert.strictEqual(recorder.recent().length, 2);
	});

	test('forgets the invocations once there are too many of them', () => {
		const recorder = new CliInvocationRecorder();

		for (let index = 0; index < 40; index += 1) {
			recorder.record(invocation(), {});
		}

		assert.ok(recorder.recent().length <= 25, 'the recorder kept everything');
	});

	test('does not report a failure for an invocation that worked', () => {
		const recorder = new CliInvocationRecorder();

		recorder.record(invocation(), {});

		assert.strictEqual(recorder.lastFailure(), undefined);
	});

	test('reports the last failure', () => {
		const recorder = new CliInvocationRecorder();

		recorder.record(
			{ ...invocation(), outcome: 'exit-code', exitCode: 2, detail: 'it failed' },
			{},
		);

		const failure = recorder.lastFailure();
		assert.ok(failure);
		assert.strictEqual(failure.reason, 'exit-code');
		assert.strictEqual(failure.detail, 'it failed');
		assert.match(failure.commandLine, /entire status --json/);
	});
});

suite('Entire repository check', () => {
	test('says a folder without a .git is not a repository', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-repository-'));

		try {
			assert.strictEqual(isGitRepository(directory), false);
			assert.strictEqual(isGitRepository(undefined), false);

			fs.mkdirSync(path.join(directory, '.git'));
			assert.strictEqual(isGitRepository(directory), true);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
