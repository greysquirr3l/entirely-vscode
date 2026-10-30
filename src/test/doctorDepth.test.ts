import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	boundOutput,
	describeBound,
	isHookName,
	logArguments,
	migrateApplyArguments,
	bundleArguments,
	pickBundleFlags,
	pickLogFlags,
	pickMigrateFlags,
	pickTraceFlags,
	traceArguments,
	utf8Length,
} from '../lib/entire';
import { saveText } from '../services/bundleFile';
import { dumpCliOutput } from '../commands/dumpCliOutput';
import { showCliLog, showHookTraces } from '../commands/doctorDepth';
import { writeDiagnosticBundle } from '../commands/doctorBundle';
import { migrateCheckpoints } from '../commands/migrateCheckpoints';
import { execute } from '../services/cli/exec';
import { CliInvocationRecorder } from '../services/cli/recorder';
import { CliInvocationLogger } from '../services/cliLogging';
import {
	clampDoctorBundleTimeout,
	clampDoctorLogLines,
	clampDoctorOutputMaxKilobytes,
	clampDoctorReadTimeout,
	clampDoctorTraceCount,
	clampMigrateCheckpointsTimeout,
	MAX_DOCTOR_BUNDLE_TIMEOUT_SECONDS,
	MAX_DOCTOR_LOG_LINES,
	MAX_DOCTOR_OUTPUT_KILOBYTES,
	MAX_DOCTOR_READ_TIMEOUT_SECONDS,
	MAX_DOCTOR_TRACE_COUNT,
	MAX_MIGRATE_CHECKPOINTS_TIMEOUT_SECONDS,
	MIN_DOCTOR_BUNDLE_TIMEOUT_SECONDS,
	MIN_DOCTOR_LOG_LINES,
	MIN_DOCTOR_OUTPUT_KILOBYTES,
	MIN_DOCTOR_READ_TIMEOUT_SECONDS,
	MIN_DOCTOR_TRACE_COUNT,
	MIN_MIGRATE_CHECKPOINTS_TIMEOUT_SECONDS,
	readExtensionSettings,
} from '../services/configuration';
import { INSTALL_COMMAND, INSTALL_DOCS } from '../services/onboarding';
import { ALICE } from './support/activityCli';
import { DOCTOR_HELPS, fakeDoctorCli } from './support/doctorCli';
import { harness } from './support/depthHarness';
import { makeTempDir } from './support/tempDir';
import type { Logger } from '../services/logger';

const ROOT = path.resolve(__dirname, '..', '..');
const MARKER = 'UNIQUE-LOG-MARKER-7f3a';
const OTHER_DRY_RUN_OWNERS = ['importHistory.ts', 'trail.ts', 'trailGate.ts', 'trailService.ts'];

suite('Doctor depth: flags come from the help', () => {
	test('picks the log flags from the 0.12.2 help and never needs the follow flag', () => {
		const picked = pickLogFlags(DOCTOR_HELPS.doctor_logs);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, { tail: '--tail', follow: '--follow' });
		assert.strictEqual(picked.repository, 'gh/acme/widgets');
	});

	test('follows a renamed tail flag, and a follow flag is never claimed as the tail', () => {
		const renamed = `Flags:
  -f, --follow      Stream new log lines as they are written
      --lines int   Show the last N lines (use 0 for all) (default 100)
`;
		const picked = pickLogFlags(renamed);
		assert.ok(picked.ok);
		assert.strictEqual(picked.flags.tail, '--lines');
		assert.deepStrictEqual(logArguments(picked.flags.tail ?? '', 50), ['doctor', 'logs', '--lines=50']);
	});

	test('a help that cannot be parsed falls back to the 0.12.2 table, and a help without the tail flag is refused', () => {
		const unparsed = pickLogFlags('nothing that looks like a flag table');
		assert.ok(unparsed.ok && unparsed.flags.tail === '--tail');
		const noTail = pickLogFlags('Flags:\n  -f, --follow   Stream new log lines as they are written\n');
		assert.ok(!noTail.ok);
		assert.match(noTail.detail, /doctor logs/);
	});

	test('offers a trace option only when the help describes it', () => {
		const all = pickTraceFlags(DOCTOR_HELPS.doctor_trace);
		assert.ok(all.ok);
		assert.deepStrictEqual(all.flags, { last: '--last', hook: '--hook', slow: '--slow', summary: '--summary' });
		const noHook = pickTraceFlags('Flags:\n      --last int   Show last N hook invocations (default 1)\n');
		assert.ok(noHook.ok);
		assert.deepStrictEqual(noHook.flags, { last: '--last' });
		assert.deepStrictEqual(traceArguments(noHook.flags, { last: 5, hook: 'post-commit', summary: true, slow: true }), ['doctor', 'trace', '--last=5']);
	});

	test('builds the trace arguments only from what was asked and found', () => {
		const flags = { last: '--last', hook: '--hook', slow: '--slow', summary: '--summary' };
		assert.deepStrictEqual(traceArguments(flags, {}), ['doctor', 'trace']);
		assert.deepStrictEqual(traceArguments(flags, { last: 5, hook: 'post-commit' }), ['doctor', 'trace', '--last=5', '--hook=post-commit']);
		assert.deepStrictEqual(traceArguments(flags, { summary: true }), ['doctor', 'trace', '--summary']);
		assert.deepStrictEqual(traceArguments(flags, { hook: '--x' }), ['doctor', 'trace']);
	});

	test('a hook name is lower-case words joined by hyphens', () => {
		for (const good of ['post-commit', 'prepare-commit-msg', 'pre-push', 'a']) {
			assert.ok(isHookName(good), good);
		}
		for (const bad of ['', 'Post-Commit', 'a b', '--x', 'a'.repeat(60), '1abc', 'a;b']) {
			assert.ok(!isHookName(bad), bad);
		}
	});

	test('a bundle needs the out flag, and the raw flag is added only when asked for and described', () => {
		const picked = pickBundleFlags(DOCTOR_HELPS.doctor_bundle);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, { out: '--out', raw: '--raw' });
		assert.deepStrictEqual(bundleArguments({ out: '--out', raw: '--raw' }, '/tmp/a.zip', false), ['doctor', 'bundle', '--out', '/tmp/a.zip']);
		assert.deepStrictEqual(bundleArguments({ out: '--out', raw: '--raw' }, '/tmp/a.zip', true), ['doctor', 'bundle', '--out', '/tmp/a.zip', '--raw']);
		assert.deepStrictEqual(bundleArguments({ out: '--out' }, '/tmp/a.zip', true), ['doctor', 'bundle', '--out', '/tmp/a.zip']);
		const noOut = pickBundleFlags('Flags:\n      --raw   Skip secret redaction.\n');
		assert.ok(!noOut.ok);
		assert.match(noOut.detail, /doctor bundle/);
	});

	test('the migration needs a dry-run flag and the real run carries no flag at all', () => {
		const picked = pickMigrateFlags(DOCTOR_HELPS['doctor_migrate-checkpoints']);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, { dryRun: '--dry-run' });
		assert.deepStrictEqual(migrateApplyArguments(), ['doctor', 'migrate-checkpoints']);
		const none = pickMigrateFlags('Flags:\n      --remote string   Remote to push migrated refs to\n');
		assert.ok(!none.ok);
	});

	test('no source file outside the fallback table names a flag of these subcommands', () => {
		const offenders: string[] = [];
		const walk = (directory: string): void => {
			for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
				const full = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== 'test') {
						walk(full);
					}
				} else if (entry.name.endsWith('.ts') && entry.name !== 'doctorFlags.ts') {
					// `--dry-run` also belongs to `import` and `trail merge`, which name it in their own files.
					const flags = OTHER_DRY_RUN_OWNERS.includes(entry.name) ? /--(?:out|raw|tail)\b/ : /--(?:out|raw|tail|dry-run)\b/;
					if (flags.test(fs.readFileSync(full, 'utf8'))) {
						offenders.push(path.relative(ROOT, full));
					}
				}
			}
		};
		walk(path.join(ROOT, 'src'));
		assert.deepStrictEqual(offenders, []);
	});
});

suite('Doctor depth: no follow, no zero', () => {
	test('the tail is always at least one line and the follow flag is never passed', () => {
		for (const lines of [0, -5, Number.NaN, 0.4, 1, 200, 5000, 1e9, Number.POSITIVE_INFINITY]) {
			const args = logArguments('--tail', lines);
			assert.ok(!args.includes('--follow'), `follow with ${lines}`);
			const match = /^--tail=(\d+)$/.exec(args[2] ?? '');
			assert.ok(match, `a tail value for ${lines}`);
			assert.ok(Number(match[1]) >= 1, `tail ${match[1]} for ${lines}`);
		}
	});

	test('a settings value of zero is clamped up', () => {
		assert.strictEqual(clampDoctorLogLines(0), MIN_DOCTOR_LOG_LINES);
		assert.ok(MIN_DOCTOR_LOG_LINES >= 1);
	});

	test('the service asks for the clamped count and passes no follow flag', async () => {
		const cli = fakeDoctorCli();
		const { service } = harness(cli, {}, { logLines: 0 });
		const check = await service.checkLog();
		assert.ok(check.ok);
		await service.readLog(check.flags);
		assert.deepStrictEqual(cli.callsTo('doctor logs'), ['none|doctor logs --tail=1']);
		assert.ok(!cli.calls().some(line => line.includes('--follow')));
	});
});

suite('Doctor depth: settings', () => {
	const cases: [string, (value: number) => number, number, number, number][] = [
		['doctorLogLines', clampDoctorLogLines, MIN_DOCTOR_LOG_LINES, MAX_DOCTOR_LOG_LINES, 200],
		['doctorTraceCount', clampDoctorTraceCount, MIN_DOCTOR_TRACE_COUNT, MAX_DOCTOR_TRACE_COUNT, 5],
		['doctorOutputMaxKilobytes', clampDoctorOutputMaxKilobytes, MIN_DOCTOR_OUTPUT_KILOBYTES, MAX_DOCTOR_OUTPUT_KILOBYTES, 512],
		['doctorReadTimeout', clampDoctorReadTimeout, MIN_DOCTOR_READ_TIMEOUT_SECONDS, MAX_DOCTOR_READ_TIMEOUT_SECONDS, 30],
		['doctorBundleTimeout', clampDoctorBundleTimeout, MIN_DOCTOR_BUNDLE_TIMEOUT_SECONDS, MAX_DOCTOR_BUNDLE_TIMEOUT_SECONDS, 120],
		['migrateCheckpointsTimeout', clampMigrateCheckpointsTimeout, MIN_MIGRATE_CHECKPOINTS_TIMEOUT_SECONDS, MAX_MIGRATE_CHECKPOINTS_TIMEOUT_SECONDS, 300],
	];
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
		contributes: { configuration: { properties: Record<string, { default?: number; minimum?: number; maximum?: number; markdownDescription?: string }> } };
	};

	for (const [name, clamp, min, max, fallback] of cases) {
		test(`${name} clamps below the minimum, above the maximum, NaN and fractions`, () => {
			assert.strictEqual(clamp(min - 1), min);
			assert.strictEqual(clamp(-100), min);
			assert.strictEqual(clamp(max + 1), max);
			assert.strictEqual(clamp(Number.POSITIVE_INFINITY), fallback);
			assert.strictEqual(clamp(Number.NaN), fallback);
			assert.strictEqual(clamp(min + 0.9), min);
			assert.strictEqual(clamp(min + 1.9), Math.min(max, min + 1));
			assert.strictEqual(clamp(fallback), fallback);
		});

		test(`${name} is declared with the same bounds and default, and the reader returns it`, () => {
			const declared = manifest.contributes.configuration.properties[`entirely.${name}`];
			assert.ok(declared, `${name} is not declared`);
			assert.strictEqual(declared.minimum, min);
			assert.strictEqual(declared.maximum, max);
			assert.strictEqual(declared.default, fallback);
			assert.ok((declared.markdownDescription ?? '').length > 40);
			const read = readExtensionSettings() as unknown as Record<string, unknown>;
			assert.strictEqual(read[name], fallback);
		});
	}
});

suite('Doctor depth: bounding an output', () => {
	test('keeps the whole text when it fits, and handles an empty one', () => {
		assert.deepStrictEqual(boundOutput('', 10, 'last'), { shown: '', omittedBytes: 0, omittedLines: 0, totalLines: 0, shownLines: 0, totalBytes: 0 });
		const whole = boundOutput('a\nb\n', 10, 'last');
		assert.strictEqual(whole.shown, 'a\nb');
		assert.strictEqual(whole.omittedBytes, 0);
		assert.strictEqual(describeBound(whole, 'last', false), undefined);
	});

	test('keeps whole lines from the end of a log and from the start of a trace', () => {
		const text = ['l1', 'l2', 'l3', 'l4'].join('\n');
		const last = boundOutput(text, 8, 'last');
		assert.deepStrictEqual([last.shown, last.omittedLines, last.omittedBytes, last.totalLines], ['l2\nl3\nl4', 1, 3, 4]);
		const first = boundOutput(text, 8, 'first');
		assert.deepStrictEqual([first.shown, first.omittedLines, first.omittedBytes], ['l1\nl2\nl3', 1, 3]);
	});

	test('cuts inside a single line that is longer than the allowance', () => {
		const bound = boundOutput('x'.repeat(100), 10, 'last');
		assert.strictEqual(bound.shown, 'x'.repeat(10));
		assert.strictEqual(bound.omittedBytes, 90);
		assert.match(describeBound(bound, 'last', false) ?? '', /part of one very long line/);
	});

	test('never splits a character that takes two UTF-16 units', () => {
		const faces = '\u{1F600}'.repeat(5);
		assert.strictEqual(utf8Length(faces), 20);
		for (const keep of ['last', 'first'] as const) {
			const bound = boundOutput(faces, 10, keep);
			assert.strictEqual(bound.shown, '\u{1F600}\u{1F600}');
			assert.strictEqual(boundOutput(faces, 6, keep).shown, '\u{1F600}');
			assert.strictEqual(boundOutput(faces, 3, keep).shown, '');
		}
		assert.strictEqual(boundOutput('é'.repeat(6), 5, 'last').shown, 'éé');
	});

	test('the banner says how much was left out, where to save it, and that the reader stopped', () => {
		const banner = describeBound(boundOutput(['l1', 'l2', 'l3', 'l4'].join('\n'), 8, 'last'), 'last', true) ?? '';
		assert.match(banner, /Showing the last 3 lines of 4\. 3 B left out\. Use Save the whole output/);
		assert.match(banner, /more than the extension reads/);
		assert.match(describeBound(boundOutput('a\nb\nc', 3, 'first'), 'first', false) ?? '', /order was not checked/);
	});
});

suite('Doctor depth: the log and the traces', () => {
	test('show-log: the last lines open in a read-only document and nothing else opens', async () => {
		const cli = fakeDoctorCli({ logText: `first line\n${MARKER}\n` });
		const { depth, ui } = harness(cli);
		assert.strictEqual(await showCliLog(depth), 'shown');
		assert.deepStrictEqual(ui.opened, ['document:log']);
		assert.match(ui.documents[0].text, new RegExp(MARKER));
		assert.match(ui.documents[0].text, /did not copy it anywhere/);
		assert.strictEqual(ui.documents[0].saveWhole, undefined, 'nothing was cut, so there is nothing more to save');
		assert.deepStrictEqual(cli.callsTo('doctor logs'), ['none|doctor logs --tail=200']);
	});

	test('keeps the log text out of the output channel, the recorder and the dump command', async () => {
		const cli = fakeDoctorCli({ logText: `${MARKER}\n`, traceText: `${MARKER}\n`, dryRunText: `${MARKER}\n` });
		const channel: string[] = [];
		const say = (level: string) => (message: string): void => void channel.push(`[${level}] ${message}`);
		const logger: Logger = { error: say('error'), warn: say('warn'), info: say('info'), debug: say('debug'), trace: say('trace') };
		const recorder = new CliInvocationRecorder();
		cli.runner.setSink(new CliInvocationLogger(logger, recorder));
		const { depth, ui, migration, service, files, settings } = harness(cli, { mode: 'latest', asks: [''], choose: message => (/dry run is open/.test(message) ? 'Close' : undefined) });
		await showCliLog(depth);
		await showHookTraces(depth);
		await migrateCheckpoints({ depth: service, migration, files, ui, settings, acting: () => Promise.resolve(ALICE), workspaceName: () => 'w' });

		assert.ok(ui.documents.length >= 3);
		assert.ok(channel.some(line => /doctor logs/.test(line)));
		assert.ok(channel.some(line => /stdout \d+ B/.test(line)), 'the size is recorded');
		assert.deepStrictEqual(channel.filter(line => line.includes(MARKER)), []);
		const dumped: string[] = [];
		await dumpCliOutput({ recorder, output: { appendLine: line => void dumped.push(line), show: () => undefined }, notify: () => Promise.resolve(undefined) });
		assert.deepStrictEqual(dumped.filter(line => line.includes(MARKER)), []);
		assert.strictEqual(recorder.latestBodies()?.stdout, undefined);
	});

	test('an empty log is not a failure', async () => {
		const cli = fakeDoctorCli({ logText: '' });
		const { depth, ui } = harness(cli);
		assert.strictEqual(await showCliLog(depth), 'empty');
		assert.match(ui.notices[0].message, /The log has no lines yet/);
		assert.deepStrictEqual(ui.documents, []);
	});

	test('a failing log read is reported with the CLI detail', async () => {
		const cli = fakeDoctorCli({ fail: { logs: 'cannot open .entire/logs/entire.log' } });
		const { depth, ui } = harness(cli);
		assert.strictEqual(await showCliLog(depth), 'failed');
		assert.match(ui.notices[0].message, /cannot open \.entire\/logs\/entire\.log/);
	});

	test('show-traces: the last five filtered to one hook pass only flags the help described', async () => {
		const cli = fakeDoctorCli();
		const { depth, ui } = harness(cli, { mode: 'last', asks: ['5', 'post-commit'] });
		assert.strictEqual(await showHookTraces(depth), 'shown');
		assert.deepStrictEqual(cli.callsTo('doctor trace'), ['none|doctor trace --last=5 --hook=post-commit']);
		assert.deepStrictEqual(ui.opened, ['document:trace']);
		assert.deepStrictEqual(ui.modePicks[0], ['latest', 'last', 'summary', 'slow']);
		assert.strictEqual(ui.questions[0].value, '5', 'the count starts at the setting');
		assert.ok(ui.questions[0].validate('0') && ui.questions[0].validate('201') && ui.questions[0].validate('x'));
		assert.strictEqual(ui.questions[0].validate('7'), undefined);
		assert.ok(ui.questions[1].validate('Post-Commit') && ui.questions[1].validate('a b'));
		assert.strictEqual(ui.questions[1].validate('post-commit'), undefined);
		assert.strictEqual(ui.questions[1].validate(''), undefined);
	});

	test('a summary and the latest trace pass no count, and offer no hook question when the help lacks it', async () => {
		const cli = fakeDoctorCli({ helps: { doctor_trace: 'Flags:\n      --last int   Show last N hook invocations (default 1)\n' } });
		const { depth, ui } = harness(cli, { mode: 'latest' });
		await showHookTraces(depth);
		assert.deepStrictEqual(cli.callsTo('doctor trace'), ['none|doctor trace']);
		assert.deepStrictEqual(ui.questions, []);
		assert.deepStrictEqual(ui.modePicks[0], ['latest', 'last']);

		const full = fakeDoctorCli();
		const second = harness(full, { mode: 'summary', asks: [''] });
		await showHookTraces(second.depth);
		assert.deepStrictEqual(full.callsTo('doctor trace'), ['none|doctor trace --summary']);
	});

	test('cancelling the trace questions runs nothing', async () => {
		const cli = fakeDoctorCli();
		assert.strictEqual(await showHookTraces(harness(cli, { mode: undefined }).depth), 'cancelled');
		assert.strictEqual(await showHookTraces(harness(cli, { mode: 'last', asks: [undefined] }).depth), 'cancelled');
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('an empty trace explains the 1.5 s default and offers the CLI settings file only when there is one', async () => {
		const settingsFile = path.join(makeTempDir('entire-trace-'), 'settings.json');
		fs.writeFileSync(settingsFile, '{}');
		const cli = fakeDoctorCli({ traceText: '' });

		const withFile = harness(cli, { mode: 'latest', asks: [''], choose: (_m, actions) => actions[0] }, { settingsFile });
		assert.strictEqual(await showHookTraces(withFile.depth), 'empty');
		assert.match(withFile.ui.notices[0].message, /1\.5 s or longer/);
		assert.deepStrictEqual(withFile.ui.notices[0].actions, ['Open the CLI Settings File']);
		assert.deepStrictEqual(withFile.ui.opened, [`file:${settingsFile}`]);
		assert.strictEqual(fs.readFileSync(settingsFile, 'utf8'), '{}');

		const without = harness(cli, { mode: 'latest', asks: [''] });
		await showHookTraces(without.depth);
		assert.deepStrictEqual(without.ui.notices[0].actions, []);
	});

	test('a second command while one runs is refused with a notice, and the first can be cancelled', async () => {
		const cli = fakeDoctorCli({ slow: { logs: 5 } });
		const { depth, ui } = harness(cli, { cancelAfterMs: 400 });
		const first = showCliLog(depth);
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(await showCliLog(depth), 'busy');
		assert.match(ui.notices[0].message, /still running/);
		assert.strictEqual(await first, 'cancelled');
		assert.match(ui.notices[1].message, /cancelled/);
		assert.strictEqual(cli.callsTo('doctor logs').length, 1);
		assert.strictEqual(await showCliLog(depth), 'cancelled', 'the flag was released, so a new run is started');
	});
});

suite('Doctor depth: large output', () => {
	test('a log over the cap opens a bounded document with a banner, and the whole text can be saved to a chosen file', async () => {
		const lines = Array.from({ length: 4000 }, (_unused, index) => `line ${String(index).padStart(5, '0')} ${'x'.repeat(10)}`);
		const logText = `${lines.join('\n')}\n`;
		const cli = fakeDoctorCli({ logText });
		const folder = makeTempDir('entire-save-');
		const target = path.join(folder, 'whole.txt');
		const { depth, ui, service } = harness(cli, { paths: [target] }, { maxBytes: 16 * 1024 });
		assert.strictEqual(await showCliLog(depth), 'shown');

		const document = ui.documents[0];
		assert.match(document.text, /Showing the last \d+ lines of 4000\. [\d.]+ (?:KB|MB) left out\. Use Save the whole output/);
		assert.ok(document.text.includes('line 03999'), 'the newest line is kept');
		assert.ok(!document.text.includes('line 00000'), 'the oldest line is left out');
		assert.ok(Buffer.byteLength(document.text) < 17 * 1024 + 600);
		assert.ok(document.saveWhole);
		assert.strictEqual(service.lastOutput('log'), logText);

		await document.saveWhole();
		assert.strictEqual(fs.readFileSync(target, 'utf8'), logText);
		assert.deepStrictEqual(fs.readdirSync(folder), ['whole.txt'], 'no temporary file remains');
		assert.deepStrictEqual(ui.opened, ['document:log'], 'saving opens nothing');
	});

	test('saving refuses to replace a file until it is confirmed, by name', async () => {
		const cli = fakeDoctorCli({ logText: `${'y'.repeat(100)}\n`.repeat(400) });
		const folder = makeTempDir('entire-save-');
		const target = path.join(folder, 'whole.log');
		fs.writeFileSync(target, 'precious');
		const { depth, ui } = harness(cli, { paths: [target, target], confirms: [false, true] }, { maxBytes: 16 * 1024 });
		await showCliLog(depth);
		await ui.documents[0].saveWhole?.();
		assert.strictEqual(fs.readFileSync(target, 'utf8'), 'precious');
		assert.match(ui.confirmations[0].message, new RegExp(`Replace .*whole\\.log\\?`));
		await ui.documents[0].saveWhole?.();
		assert.ok(fs.readFileSync(target, 'utf8').startsWith('yyyy'));
	});

	test('saving applies the same path checks as a bundle', async () => {
		const cli = fakeDoctorCli({ logText: `${'y'.repeat(100)}\n`.repeat(400) });
		const folder = makeTempDir('entire-save-');
		const { depth, ui } = harness(cli, { paths: ['relative.txt', path.join(folder, 'a.zip'), path.join(folder, '.git', 'x.txt'), path.join(folder, 'missing', 'x.txt')] }, { maxBytes: 16 * 1024 });
		await showCliLog(depth);
		for (let index = 0; index < 4; index++) {
			await ui.documents[0].saveWhole?.();
		}
		const refusals = ui.notices.filter(notice => /was not saved/.test(notice.message)).map(notice => notice.message);
		assert.strictEqual(refusals.length, 4);
		assert.match(refusals[0], /not absolute/);
		assert.match(refusals[1], /\.txt or \.log/);
		assert.match(refusals[2], /\.git or \.entire/);
		assert.match(refusals[3], /does not exist/);
	});

	test('a forced failure leaves no partial file behind', async () => {
		const folder = makeTempDir('entire-save-');
		const blocker = path.join(folder, 'blocker');
		fs.mkdirSync(blocker);
		const result = await saveText(blocker, 'text');
		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(fs.readdirSync(folder), ['blocker']);
		assert.deepStrictEqual(fs.readdirSync(blocker), []);
	});

	test('the runner marks output past what it reads, and the banner says so', async function () {
		this.timeout(60_000);
		const outcome = await execute(process.execPath, ['-e', 'process.stdout.write("a".repeat(17 * 1024 * 1024))'], { timeoutMs: 30_000 });
		assert.ok(outcome.ok && outcome.truncated);
		const small = await execute(process.execPath, ['-e', 'process.stdout.write("a")'], { timeoutMs: 30_000 });
		assert.ok(small.ok && !small.truncated);

		const cli = fakeDoctorCli({ logText: `${'z'.repeat(99)}\n`.repeat(177_000) });
		const { depth, ui, service } = harness(cli, {}, { readSeconds: 60 });
		await showCliLog(depth);
		assert.match(ui.documents[0].text, /more than the extension reads/);
		assert.ok(ui.documents[0].saveWhole);
		assert.ok(Buffer.byteLength(service.lastOutput('log') ?? '') <= 16 * 1024 * 1024);
	});
});

suite('Doctor depth: a CLI that lacks a subcommand, or is missing', () => {
	const subs = ['logs', 'trace', 'bundle', 'migrate-checkpoints'] as const;

	for (const sub of subs) {
		test(`names the missing \`doctor ${sub}\` and the CLI version, and runs nothing`, async () => {
			const cli = fakeDoctorCli({ helps: { [`doctor_${sub}`]: null } });
			const { service } = harness(cli);
			const check = await { logs: () => service.checkLog(), trace: () => service.checkTrace(), bundle: () => service.checkBundle(), 'migrate-checkpoints': () => service.checkMigrate() }[sub]();
			assert.ok(!check.ok && check.reason === 'unsupported');
			assert.match(check.detail, new RegExp(`has no \`doctor ${sub}\` command`));
			assert.match(check.detail, /0\.12\.2/);
			assert.deepStrictEqual(cli.calls(), []);
		});
	}

	test('every command says so, offers the update link, and runs nothing', async () => {
		const cli = fakeDoctorCli({ helps: { doctor_logs: null, doctor_trace: null, doctor_bundle: null, 'doctor_migrate-checkpoints': null } });
		const { depth, ui, service, migration, files, settings } = harness(cli, { choose: (_m, actions) => actions[0], mode: 'latest' });
		const bundle = { service, files, ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await showCliLog(depth), 'unavailable');
		assert.strictEqual(await showHookTraces(depth), 'unavailable');
		assert.strictEqual(await writeDiagnosticBundle(bundle, { raw: false }), 'unavailable');
		assert.strictEqual(await writeDiagnosticBundle(bundle, { raw: true }), 'unavailable');
		assert.strictEqual(await migrateCheckpoints({ depth: service, migration, files, ui, settings, acting: () => Promise.resolve(ALICE), workspaceName: () => undefined }), 'unavailable');
		assert.strictEqual(ui.notices.length, 5);
		for (const notice of ui.notices) {
			assert.match(notice.message, /Entire CLI \(0\.12\.2\) has no `doctor /);
			assert.deepStrictEqual(notice.actions, ['Open Update Instructions']);
		}
		assert.deepStrictEqual(ui.urls, Array(5).fill(INSTALL_DOCS));
		assert.deepStrictEqual(cli.calls(), []);
		assert.deepStrictEqual(ui.documents, []);
	});

	test('a help lookup that fails without saying the command is unknown is a failure, not "update the CLI"', async () => {
		const cli = fakeDoctorCli({ helpCrash: true });
		const { service } = harness(cli);
		const check = await service.checkTrace();
		assert.ok(!check.ok && check.reason === 'failed');
		assert.match(check.detail, /could not read the help for doctor trace: panic: boom/);
		assert.doesNotMatch(check.detail, /Update the CLI/);
	});

	test('a timeout on the help lookup is a failure, not a missing command', async function () {
		this.timeout(15_000);
		const cli = fakeDoctorCli({ slowHelp: 4 });
		const { service } = harness(cli, {}, { readSeconds: 1 });
		const check = await service.checkLog();
		assert.ok(!check.ok);
		assert.strictEqual(check.reason, 'failed');
		assert.doesNotMatch(check.detail, /has no/);
	});

	test('a CLI that is not installed gets the install message and nothing else, in every command', async () => {
		const cli = fakeDoctorCli({ noCli: true });
		const { depth, ui, service, migration, files, settings } = harness(cli, { choose: (_m, actions) => actions[0], mode: 'latest' });
		const bundle = { service, files, ui, acting: () => Promise.resolve(ALICE) };
		await showCliLog(depth);
		await showHookTraces(depth);
		await writeDiagnosticBundle(bundle, { raw: false });
		await writeDiagnosticBundle(bundle, { raw: true });
		await migrateCheckpoints({ depth: service, migration, files, ui, settings, acting: () => Promise.resolve(ALICE), workspaceName: () => undefined });
		assert.strictEqual(ui.notices.length, 5);
		for (const notice of ui.notices) {
			assert.ok(notice.message.includes(INSTALL_COMMAND));
			assert.match(notice.message, /not installed/);
		}
		assert.deepStrictEqual(ui.opened, []);
		assert.deepStrictEqual(ui.confirmations, []);
	});
});

suite('Doctor depth: wiring', () => {
	const commands = ['entirely.showCliLog', 'entirely.showHookTraces', 'entirely.writeDiagnosticBundle', 'entirely.writeRawDiagnosticBundle', 'entirely.migrateCheckpoints'];

	test('the five commands are contributed, registered in one place, and pushed onto the subscriptions', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { contributes: { commands: { command: string; title: string }[] } };
		const source = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'doctorDepthCommands.ts'), 'utf8');
		for (const command of commands) {
			assert.ok(manifest.contributes.commands.some(entry => entry.command === command), `${command} is not contributed`);
			assert.ok(source.includes(`registerCommand('${command}'`), `${command} is not registered`);
		}
		assert.match(source, /context\.subscriptions\.push\(\s*vscode\.commands\.registerCommand\('entirely\.showCliLog'/);
		assert.strictEqual((source.match(/registerCommand\(/g) ?? []).length, 5);
		const raw = manifest.contributes.commands.find(entry => entry.command === 'entirely.writeRawDiagnosticBundle');
		assert.match(raw?.title ?? '', /Unredacted/);
		assert.match(fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8'), /registerDoctorDepthCommands\(context,/);
	});

	test('the commands are registered in the running extension', async () => {
		const vscode = await import('vscode');
		await vscode.extensions.getExtension('greysquirr3l.entirely')?.activate();
		const registered = await vscode.commands.getCommands(true);
		for (const command of commands) {
			assert.ok(registered.includes(command), `${command} is not registered`);
		}
	});

	test('no flow starts a timer of its own', async function () {
		this.timeout(60_000);
		const intervals: string[] = [];
		const timeouts: string[] = [];
		const realInterval = global.setInterval;
		const realTimeout = global.setTimeout;
		const spyInterval = ((...args: Parameters<typeof setInterval>) => {
			intervals.push(new Error().stack ?? '');
			return realInterval(...args);
		}) as typeof setInterval;
		const spyTimeout = ((...args: Parameters<typeof setTimeout>) => {
			timeouts.push(new Error().stack ?? '');
			return realTimeout(...args);
		}) as typeof setTimeout;

		const cli = fakeDoctorCli();
		const folder = makeTempDir('entire-timers-');
		const { depth, ui, service, migration, files, settings } = harness(cli, {
			mode: 'last',
			asks: ['3', 'pre-push'],
			paths: [path.join(folder, 'b.zip')],
			choose: message => (/dry run is open/.test(message) ? 'Migrate…' : undefined),
		});
		global.setInterval = spyInterval;
		global.setTimeout = spyTimeout;
		try {
			await showCliLog(depth);
			await showHookTraces(depth);
			await writeDiagnosticBundle({ service, files, ui, acting: () => Promise.resolve(ALICE) }, { raw: false });
			await migrateCheckpoints({ depth: service, migration, files, ui, settings, acting: () => Promise.resolve(ALICE), workspaceName: () => 'w' });
		} finally {
			global.setInterval = realInterval;
			global.setTimeout = realTimeout;
		}
		assert.deepStrictEqual(intervals, []);
		// The editor host starts timers of its own for its events. A timer counts against the
		// flows only when the extension's code is on its stack and the runner's exec is not.
		const ours = /out[\\/](?:commands|services|lib|providers)[\\/]/;
		const fromRunner = /services[\\/]cli[\\/]exec/;
		const foreign = timeouts.filter(stack => ours.test(stack) && !fromRunner.test(stack));
		assert.deepStrictEqual(foreign, [], 'only the runner\'s own timeout may start a timer');
		assert.ok(timeouts.some(stack => fromRunner.test(stack)), 'the spy saw the runner\'s timeout');
	});
});
