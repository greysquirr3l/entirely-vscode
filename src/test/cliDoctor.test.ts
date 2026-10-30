import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { showCliDoctorOutput } from '../commands/cliDoctorOutput';
import { doctor, type ReportSink } from '../commands/doctor';
import {
	describeCliDoctor,
	parseDoctorOutput,
	readDoctorOutput,
	MAX_DOCTOR_FINDINGS,
} from '../lib/entire';
import { AccountContextService } from '../services/accountContext';
import { CliLocator } from '../services/cli/locator';
import { CliInvocationRecorder } from '../services/cli/recorder';
import { CliRunner } from '../services/cli/runner';
import { CliInvocationLogger } from '../services/cliLogging';
import { CliDoctorService } from '../services/cliDoctor';
import { clampCliDoctorTimeout } from '../services/configuration';
import { renderDoctorReport, type DoctorFacts } from '../services/doctorReport';
import type { Logger } from '../services/logger';
import { makeTempDir } from './support/tempDir';

const HEALTHY = [
	'✓ Metadata branches: OK (no remote-tracking metadata ref found)',
	'',
	'✓ Git hooks: OK',
	'✓ Claude Code hook config: OK',
	'✓ Legacy shadow branches: none',
].join('\n');

const STUCK = [
	'✓ Git hooks: OK',
	'Found 1 stuck session(s):',
	'',
	'  Session: 57eb17c1-93e4-477f-b4c0-be92ff619bdc',
	'  Phase:   ended',
	'  Reason:  ended with uncondensed checkpoint data',
	'  Agent:   Copilot CLI',
	'  Prompt: SECRET-PROMPT-BODY',
	'  Fix: condense to permanent storage.',
	'  Run `entire doctor --force` to apply it.',
].join('\n');

/** The stuck block with the prompt line the CLI should never have to be trusted with. */
const SECRET = 'SECRET-PROMPT-BODY';

interface Fake {
	readonly runner: CliRunner;
	readonly dir: string;
	readonly invocations: () => string[];
}

interface FakeOptions {
	readonly doctorOut?: string;
	readonly doctorExit?: number;
	readonly doctorErr?: string;
	readonly hasDoctor?: boolean;
	readonly sleep?: number;
}

function fakeCli(options: FakeOptions = {}): Fake {
	const dir = makeTempDir('entire-clidoctor-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');
	fs.writeFileSync(path.join(dir, 'doctor.out'), options.doctorOut ?? HEALTHY, 'utf8');
	fs.writeFileSync(path.join(dir, 'doctor.err'), options.doctorErr ?? '', 'utf8');
	const script = [
		'#!/bin/sh',
		'if [ "$1" = "--context" ]; then shift 2; fi',
		`echo "$@" >> '${log}'`,
		'case "$1 $2" in',
		'\t"version ") echo "entire 0.12.2" ;;',
		options.hasDoctor === false
			? '\t"agent-help doctor") echo "Error: unknown command" >&2; exit 2 ;;'
			: '\t"agent-help doctor") echo "entire doctor - Diagnose and fix session issues"; echo "  -f, --force  Auto-fix"; ;;',
		`\t"doctor ") cat '${dir}/doctor.err' >&2; ${options.sleep ? `sleep ${options.sleep}; ` : ''}cat '${dir}/doctor.out'; exit ${options.doctorExit ?? 0} ;;`,
		'\t"status --json") echo \'{"enabled":false}\' ;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');
	const binary = path.join(bin, 'entire');
	fs.writeFileSync(binary, `${script}\n`, 'utf8');
	fs.chmodSync(binary, 0o755);
	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	return {
		runner,
		dir,
		invocations: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
	};
}

function serviceFor(cli: Fake, seconds = 10): CliDoctorService {
	return new CliDoctorService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => seconds });
}

class Sink implements ReportSink {
	readonly lines: string[] = [];
	appendLine(line: string): void {
		this.lines.push(line);
	}
	show(): void {}
	get text(): string {
		return this.lines.join('\n');
	}
}

function factsWith(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
	return {
		generatedAt: new Date('2026-10-28T12:00:00.000Z'),
		extensionVersion: '0.1.0',
		editorVersion: '1.140.0',
		platform: 'darwin',
		discovery: { state: 'available', path: '/bin/entire', location: 'path', directory: '/bin', version: '0.12.2' },
		status: undefined,
		statusError: undefined,
		isRepository: true,
		workspaceRoot: '/work/repo',
		settings: [],
		logLevel: 'info',
		debug: false,
		configuredPath: undefined,
		failure: undefined,
		minimumCliVersion: '0.12.2',
		checkpointDestination: undefined,
		accountContext: undefined,
		contextMechanism: 'flag and environment',
		...overrides,
	};
}

async function runDoctor(cli: Fake, service: CliDoctorService, sink: Sink, debug = false): Promise<void> {
	const recorder = new CliInvocationRecorder();
	const lines: string[] = [];
	const logger: Logger = {
		error: m => lines.push(m),
		warn: m => lines.push(m),
		info: m => lines.push(m),
		debug: m => lines.push(m),
		trace: m => lines.push(m),
	};
	cli.runner.setSink(new CliInvocationLogger(logger, recorder));
	await doctor({
		runner: cli.runner,
		accounts: new AccountContextService(cli.runner),
		recorder,
		cliDoctor: service,
		workspaceRoot: () => cli.dir,
		output: sink,
		notify: async () => undefined,
	});
	if (debug) {
		for (const line of lines) {
			sink.appendLine(line);
		}
	}
}

suite('The CLI doctor reading', () => {
	test('parses passing checks and a problem with its reason and fix', () => {
		const checks = parseDoctorOutput(STUCK);

		assert.strictEqual(checks.length, 2);
		assert.strictEqual(checks[0].ok, true);
		assert.strictEqual(checks[0].title, 'Git hooks: OK');
		assert.strictEqual(checks[1].ok, false);
		assert.strictEqual(checks[1].title, 'Found 1 stuck session(s):');
		assert.deepStrictEqual(checks[1].notes, [
			'Reason:  ended with uncondensed checkpoint data',
			'Fix: condense to permanent storage.',
			'Run `entire doctor --force` to apply it.',
		]);
	});

	test('keeps detail lines that are not a reason or a fix out of the notes', () => {
		const notes = parseDoctorOutput(STUCK).flatMap(check => check.notes).join('\n');

		assert.ok(!notes.includes(SECRET));
		assert.ok(!notes.includes('57eb17c1'));
	});

	test('reads an all-passing run as healthy', () => {
		const reading = readDoctorOutput(HEALTHY);

		assert.strictEqual(reading.kind, 'healthy');
		if (reading.kind === 'healthy') {
			assert.strictEqual(reading.checks.length, 4);
		}
	});

	test('reads an empty run and a plain all-clear line as healthy', () => {
		assert.strictEqual(readDoctorOutput('').kind, 'healthy');
		assert.strictEqual(readDoctorOutput('No issues found.').kind, 'healthy');
	});

	test('reads an unmarked top-level line as a problem', () => {
		const reading = readDoctorOutput('✓ Git hooks: OK\n✗ Operational logs: .entire/logs is not writable');

		assert.strictEqual(reading.kind, 'problems');
		if (reading.kind === 'problems') {
			assert.strictEqual(reading.passed, 1);
			assert.strictEqual(reading.findings[0].title, 'Operational logs: .entire/logs is not writable');
		}
	});

	test('caps the findings it lists and counts the rest', () => {
		const many = Array.from({ length: MAX_DOCTOR_FINDINGS + 5 }, (_, i) => `✗ Problem ${i}`).join('\n');
		const reading = readDoctorOutput(many);

		assert.strictEqual(reading.kind, 'problems');
		if (reading.kind === 'problems') {
			assert.strictEqual(reading.findings.length, MAX_DOCTOR_FINDINGS);
			assert.strictEqual(reading.omitted, 5);
		}
	});

	test('describes each kind of reading', () => {
		assert.match(describeCliDoctor(readDoctorOutput(HEALTHY)).join('\n'), /Result: healthy \(4 checks passed\)/);
		assert.match(describeCliDoctor(readDoctorOutput(STUCK)).join('\n'), /1 problem found/);
		assert.match(describeCliDoctor(readDoctorOutput(STUCK)).join('\n'), /Finding: Found 1 stuck session/);
		assert.match(
			describeCliDoctor({ kind: 'failed', reason: 'timeout', detail: 'took too long' }).join('\n'),
			/did not complete \(timeout\)[\s\S]*Finding: took too long/,
		);
		assert.match(describeCliDoctor({ kind: 'unsupported', detail: 'no doctor' }).join('\n'), /not available/);
		assert.match(describeCliDoctor({ kind: 'no-cli', detail: 'missing' }).join('\n'), /not run \(missing\)/);
		assert.match(describeCliDoctor(undefined).join('\n'), /not run/);
	});

	test('the timeout setting is kept inside its range', () => {
		assert.strictEqual(clampCliDoctorTimeout(1), 5);
		assert.strictEqual(clampCliDoctorTimeout(9999), 300);
		assert.strictEqual(clampCliDoctorTimeout(Number.NaN), 30);
		assert.strictEqual(clampCliDoctorTimeout(45.7), 45);
	});
});

suite('The CLI doctor in the doctor report', () => {
	test('the rendered report carries the CLI findings next to the extension facts', () => {
		const report = renderDoctorReport(factsWith({ cliDoctor: readDoctorOutput(STUCK) }));

		assert.match(report, /### Entire CLI/);
		assert.match(report, /### Capture pipeline/);
		assert.match(report, /Finding: Found 1 stuck session/);
	});

	test('healthy-cli: the report says the pipeline is healthy', async () => {
		const cli = fakeCli();
		const sink = new Sink();

		await runDoctor(cli, serviceFor(cli), sink);

		assert.match(sink.text, /### Capture pipeline/);
		assert.match(sink.text, /Result: healthy/);
		assert.match(sink.text, /Version: 0\.12\.2/);
	});

	test('failing-cli: a reported problem is named as a finding', async () => {
		const cli = fakeCli({ doctorOut: STUCK });
		const sink = new Sink();

		await runDoctor(cli, serviceFor(cli), sink);

		assert.match(sink.text, /1 problem found/);
		assert.match(sink.text, /Finding: Found 1 stuck session\(s\):/);
		assert.match(sink.text, /Reason:  ended with uncondensed/);
	});

	test('failing-cli: a doctor that exits non-zero is a finding, not an empty section', async () => {
		const cli = fakeCli({ doctorOut: '', doctorExit: 1, doctorErr: 'cannot open the repository' });
		const sink = new Sink();

		await runDoctor(cli, serviceFor(cli), sink);

		assert.match(sink.text, /did not complete \(exit-code\)/);
		assert.match(sink.text, /Finding: cannot open the repository/);
		assert.doesNotMatch(sink.text, /Result: healthy/);
	});

	test('a doctor that times out is reported as not completed', async () => {
		const cli = fakeCli({ sleep: 5 });
		const reading = await new CliDoctorService({
			runner: cli.runner,
			workspaceRoot: () => cli.dir,
			timeoutSeconds: () => 0.3,
		}).read();

		assert.strictEqual(reading.kind, 'failed');
		if (reading.kind === 'failed') {
			assert.strictEqual(reading.reason, 'timeout');
		}
	});

	test('a CLI without a doctor command is reported as lacking it', async () => {
		const cli = fakeCli({ hasDoctor: false });
		const service = serviceFor(cli);
		const reading = await service.read();

		assert.strictEqual(reading.kind, 'unsupported');
		assert.ok(!cli.invocations().some(line => line === 'doctor'), 'doctor was run anyway');
	});

	test('a missing CLI is reported as not run', async () => {
		const dir = makeTempDir('entire-clidoctor-absent-');
		const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
		const reading = await new CliDoctorService({
			runner,
			workspaceRoot: () => dir,
			timeoutSeconds: () => 5,
		}).read();

		assert.strictEqual(reading.kind, 'no-cli');
	});

	test('asks the CLI to report only: no flag is passed to doctor', async () => {
		const cli = fakeCli();

		await serviceFor(cli).read();

		const runs = cli.invocations().filter(line => /^doctor/.test(line));
		assert.deepStrictEqual(runs, ['doctor']);
	});

	test('the raw doctor output is not written to the output channel, even with debug logging', async () => {
		const cli = fakeCli({ doctorOut: STUCK });
		const sink = new Sink();

		await runDoctor(cli, serviceFor(cli), sink, true);

		assert.ok(!sink.text.includes(SECRET), 'a detail line from the CLI reached the channel');
		assert.ok(!sink.text.includes('57eb17c1'), 'a session id from the CLI reached the channel');
	});

	test('the explicit command writes the full text of the last run', async () => {
		const cli = fakeCli({ doctorOut: STUCK });
		const service = serviceFor(cli);
		const sink = new Sink();
		const told: string[] = [];

		await showCliDoctorOutput({ cliDoctor: service, output: sink, notify: async m => void told.push(m) });
		assert.match(told.join('\n'), /Run "Entirely: Doctor/);
		assert.strictEqual(sink.lines.length, 0);

		await service.read();
		await showCliDoctorOutput({ cliDoctor: service, output: sink, notify: async () => undefined });

		assert.ok(sink.text.includes(SECRET));
		assert.ok(sink.text.includes('57eb17c1'));
	});
});
