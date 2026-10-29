import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	decodeCheckpointList,
	decodeSessionList,
	describeImportResult,
	importArguments,
	isImportAgent,
	isImportedCheckpoint,
	isImportedSession,
	isStoppable,
	markImported,
	parseSessionIds,
	planImportFlags,
	readImportAgents,
	readImportCounts,
	readImportPreview,
	resumable,
	unwrap,
	IMPORTED_LABEL,
	type Checkpoint,
	type ImportScope,
	type Session,
} from '../lib/entire';
import { importHistory, type ImportConfirmation, type ImportDependencies, type ImportNarrowing, type ImportUi } from '../commands/historyImport';
import { stopSession, resumeStoppedSession, type LifecycleDependencies } from '../commands/sessionLifecycle';
import { CheckpointsProvider } from '../providers/checkpointsProvider';
import { SessionsProvider } from '../providers/sessionsProvider';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { createCheckpointSource } from '../services/checkpointSource';
import { clampImportTimeout } from '../services/configuration';
import { HistoryImportService } from '../services/historyImport';

const IMPORT_HELP = `Import pre-existing agent history into Entire (experimental)

Usage:
  entire import [flags]
  entire import [command]

Available Commands:
  claude-code     Import existing Claude Code transcripts as read-only checkpoints
  codex           Import existing Codex transcripts as read-only checkpoints
  help            Help about any command

Flags:
  -h, --help   help for import

Use "entire import [command] --help" for more information about a command.
`;

const AGENT_HELP = `Import pre-existing Claude Code transcripts for this repo (the past month) as
read-only checkpoints.

Usage:
  entire import claude-code [flags]

Flags:
      --dry-run           Report what would be imported without writing
  -h, --help              help for claude-code
      --path string       Override the transcript directory to import from
      --session strings   Import only these session IDs (repeatable)
`;

const RENAMED_HELP = `Usage:
  entire import claude-code [flags]

Flags:
      --preview           Report what would be imported without writing
      --only strings      Import only these session IDs (repeatable)
`;

const NO_PREVIEW_HELP = `Usage:
  entire import claude-code [flags]

Flags:
      --path string       Override the transcript directory to import from
`;

const SESSION = '11111111-2222-3333-4444-555555555555';
const IMPORTED_SESSION = {
	session_id: SESSION,
	agent: 'Claude Code',
	status: 'ended',
	kind: 'imported',
	read_only: true,
	started_at: '2026-10-20T10:00:00Z',
	turns: 0,
	pending_turns: 1,
	checkpoints: 1,
	last_prompt: 'hello world task',
};
const LIVE_SESSION = {
	session_id: 'live-1',
	agent: 'Claude Code',
	status: 'active',
	worktree_path: '/work/here',
	branch: 'main',
};
const CHECKPOINT_ID = '01M5CC1T802WHX8DWF4FP7195H';

const PREVIEW_OUT = 'Importing Claude Code session 1/1 (1 turn)...\nWould import 3 turn(s) from 1 session(s) (2 already imported).\n';
const RUN_OUT = 'Importing Claude Code session 1/1 (3 turns)...\nImported 3 turn(s) from 1 session(s) (2 already imported).\n';

interface Behaviour {
	readonly exit?: number;
	readonly out?: string;
	readonly err?: string;
	/** Seconds the command takes. */
	readonly sleep?: number;
}

interface FakeOptions {
	importHelp?: string | null;
	agentHelp?: string | null;
	preview?: Behaviour;
	run?: Behaviour;
	sessions?: readonly unknown[];
	checkpoints?: readonly unknown[];
	/** The flag the fake treats as the dry run. */
	dryFlag?: string;
	installed?: boolean;
}

interface FakeCli {
	readonly runner: CliRunner;
	readonly dir: string;
	invocations(): string[];
	/** Invocations of `import <agent>` that were not previews. */
	imports(): string[];
}

function write(dir: string, name: string, text: string): void {
	fs.writeFileSync(path.join(dir, name), text, 'utf8');
}

function behaviour(dir: string, name: string, value: Behaviour | undefined, fallback: string): void {
	write(dir, `${name}.exit`, String(value?.exit ?? 0));
	write(dir, `${name}.out`, value?.out ?? fallback);
	write(dir, `${name}.err`, value?.err ?? '');
	write(dir, `${name}.sleep`, String(value?.sleep ?? 0));
}

function fakeCli(options: FakeOptions = {}): FakeCli {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-import-'));
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');

	write(dir, 'import-help.txt', options.importHelp ?? IMPORT_HELP);
	write(dir, 'agent-help.txt', options.agentHelp ?? AGENT_HELP);
	behaviour(dir, 'preview', options.preview, PREVIEW_OUT);
	behaviour(dir, 'run', options.run, RUN_OUT);
	write(dir, 'sessions.json', JSON.stringify(options.sessions ?? []));
	write(dir, 'checkpoints.json', JSON.stringify(options.checkpoints ?? []));

	const act = (name: string): string =>
		`cat '${dir}/${name}.err' >&2; s=$(cat '${dir}/${name}.sleep'); ` +
		`if [ "$s" != "0" ]; then cat '${dir}/${name}.out'; exec sleep "$s"; fi; ` +
		`cat '${dir}/${name}.out'; exit $(cat '${dir}/${name}.exit')`;
	const dry = options.dryFlag ?? '--dry-run';

	const script = [
		'#!/bin/sh',
		'if [ "$1" = "--context" ]; then shift 2; fi',
		`echo "$@" >> '${log}'`,
		'case "$1 $2 $3" in',
		'\t"version  ") echo "entire 0.12.2" ;;',
		// The real CLI does not know experimental commands in agent-help.
		'\t"agent-help import "*) echo "Error: Invalid usage: unknown command" >&2; exit 2 ;;',
		`\t"import --help ") cat '${dir}/import-help.txt' ;;`,
		options.agentHelp === null
			? '\t"import claude-code --help") echo "unknown" >&2; exit 2 ;;'
			: `\t"import claude-code --help") cat '${dir}/agent-help.txt' ;;`,
		`\t"session list --json") cat '${dir}/sessions.json' ;;`,
		`\t"checkpoint list --json") cat '${dir}/checkpoints.json' ;;`,
		`\t"import claude-code "*) case " $* " in *" ${dry} "*) ${act('preview')} ;; *) ${act('run')} ;; esac ;;`,
		`\t"import claude-code ") ${act('run')} ;;`,
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');

	if (options.installed !== false) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const invocations = (): string[] =>
		fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
	return {
		runner,
		dir,
		invocations,
		imports: () => invocations().filter(line => /^import claude-code/.test(line) && !/(--dry-run|--preview|--help)/.test(line)),
	};
}

function serviceFor(cli: FakeCli, seconds = 10): HistoryImportService {
	return new HistoryImportService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => seconds });
}

const SCOPE: ImportScope = { agent: 'claude-code', sessionIds: [] };

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		id: CHECKPOINT_ID,
		message: 'hello world task',
		agent: 'Claude Code',
		sessionIds: [SESSION],
		sessionCount: 1,
		isTaskCheckpoint: false,
		isLogsOnly: true,
		...overrides,
	};
}

function sessionOf(raw: unknown): Session {
	return unwrap(decodeSessionList([raw]))[0];
}

suite('Import planning from help', () => {
	test('finds the preview and session flags by what their help lines say', () => {
		const plan = planImportFlags(AGENT_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.dryRun, '--dry-run');
		assert.strictEqual(plan.session, '--session');
	});

	test('follows renamed flags', () => {
		const plan = planImportFlags(RENAMED_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.dryRun, '--preview');
		assert.strictEqual(plan.session, '--only');
	});

	test('refuses a CLI that cannot preview', () => {
		const plan = planImportFlags(NO_PREVIEW_HELP);
		assert.strictEqual(plan.ok, false);
		assert.ok(!plan.ok && plan.detail.includes('cannot preview'));
	});

	test('reads the agents from the help rather than naming them', () => {
		assert.deepStrictEqual(readImportAgents(IMPORT_HELP), ['claude-code', 'codex']);
		assert.deepStrictEqual(readImportAgents('nothing useful'), []);
		// A name as wide as the column leaves a single space before its description.
		assert.deepStrictEqual(
			readImportAgents('Available Commands:\n  factoryai-droid Import existing Factory AI Droid transcripts\n  pi              Import Pi\n'),
			['factoryai-droid', 'pi'],
		);
	});

	test('accepts only agents the CLI listed', () => {
		assert.ok(isImportAgent('codex', ['claude-code', 'codex']));
		assert.ok(!isImportAgent('--force', ['--force']));
		assert.ok(!isImportAgent('cursor', ['codex']));
	});

	test('builds the preview and import argument lists', () => {
		const plan = planImportFlags(RENAMED_HELP);
		assert.ok(plan.ok);
		const scope: ImportScope = { agent: 'claude-code', sessionIds: ['a1', 'b2'] };
		assert.deepStrictEqual(importArguments(plan, scope, true), ['import', 'claude-code', '--preview', '--only=a1', '--only=b2']);
		assert.deepStrictEqual(importArguments(plan, SCOPE, false), ['import', 'claude-code']);
	});

	test('parses typed session ids and rejects anything that could be a flag', () => {
		assert.deepStrictEqual(parseSessionIds(`a1, b2 ${SESSION} a1`), ['a1', 'b2', SESSION]);
		assert.strictEqual(parseSessionIds(''), undefined);
		assert.strictEqual(parseSessionIds('--all'), undefined);
		assert.strictEqual(parseSessionIds(Array.from({ length: 51 }, (_, i) => `s${i}`).join(' ')), undefined);
	});

	test('clamps the import timeout', () => {
		assert.strictEqual(clampImportTimeout(1), 10);
		assert.strictEqual(clampImportTimeout(99999), 3600);
		assert.strictEqual(clampImportTimeout(Number.NaN), 300);
		assert.strictEqual(clampImportTimeout(120.9), 120);
	});
});

suite('Import reports', () => {
	test('reads the counts from the CLI summary', () => {
		assert.deepStrictEqual(readImportCounts(PREVIEW_OUT), { turns: 3, sessions: 1, alreadyImported: 2 });
		assert.strictEqual(readImportCounts('something else entirely'), undefined);
	});

	test('a zero-turn preview means nothing to import, an unreadable one does not', () => {
		const empty = readImportPreview('Would import 0 turn(s) from 0 session(s) (0 already imported).\n', '');
		assert.strictEqual(empty.nothingToImport, true);
		const unknown = readImportPreview('The CLI said something new.', '');
		assert.strictEqual(unknown.nothingToImport, false);
		assert.strictEqual(unknown.counts, undefined);
		assert.ok(unknown.text.includes('something new'));
	});

	test('keeps the CLI progress on stderr in the preview text', () => {
		const preview = readImportPreview('Would import 1 turn(s) from 1 session(s) (0 already imported).', 'Importing Claude Code session 1/1 (1 turn)...');
		assert.ok(preview.text.includes('session 1/1'));
	});

	test('words the outcome from what the CLI said', () => {
		assert.ok(describeImportResult('claude-code', RUN_OUT).startsWith('Imported 3 turns from 1 session (2 already imported).'));
		assert.ok(describeImportResult('claude-code', 'odd output').includes('odd output'));
	});
});

suite('History import service', () => {
	test('lists agents from import --help after agent-help refuses the command', async () => {
		const cli = fakeCli();
		const result = await serviceFor(cli).agents();
		assert.ok(result.ok);
		assert.deepStrictEqual(result.agents, ['claude-code', 'codex']);
		assert.ok(cli.invocations().includes('agent-help import'));
		assert.ok(cli.invocations().includes('import --help'));
	});

	test('previews with the flag from help and writes nothing', async () => {
		const cli = fakeCli({ agentHelp: RENAMED_HELP, dryFlag: '--preview' });
		const result = await serviceFor(cli).preview(SCOPE);
		assert.ok(result.ok);
		assert.deepStrictEqual(result.preview.counts, { turns: 3, sessions: 1, alreadyImported: 2 });
		assert.deepStrictEqual(cli.imports(), []);
		assert.ok(cli.invocations().includes('import claude-code --preview'));
	});

	test('passes chosen sessions with the flag from help', async () => {
		const cli = fakeCli({ agentHelp: RENAMED_HELP, dryFlag: '--preview' });
		await serviceFor(cli).preview({ agent: 'claude-code', sessionIds: [SESSION] });
		assert.ok(cli.invocations().includes(`import claude-code --preview --only=${SESSION}`));
	});

	test('runs the import and words the result from the CLI output', async () => {
		const cli = fakeCli();
		const outcome = await serviceFor(cli).run(SCOPE);
		assert.ok(outcome.kind === 'done');
		assert.ok(outcome.text.startsWith('Imported 3 turns from 1 session'));
		assert.deepStrictEqual(cli.imports(), ['import claude-code']);
	});

	test('reports a CLI refusal as a failure, with what the CLI said', async () => {
		const cli = fakeCli({ run: { exit: 1, out: '', err: 'import needs a commit to anchor sessions to' } });
		const outcome = await serviceFor(cli).run(SCOPE);
		assert.ok(outcome.kind === 'failed');
		assert.ok(outcome.detail.includes('needs a commit'));
	});

	test('reports a refused preview as a failure', async () => {
		const cli = fakeCli({ preview: { exit: 1, out: '', err: 'no resolvable commit' } });
		const result = await serviceFor(cli).preview(SCOPE);
		assert.ok(!result.ok && result.detail.includes('no resolvable commit'));
	});

	test('will not import when the help offers no preview', async () => {
		const cli = fakeCli({ agentHelp: NO_PREVIEW_HELP });
		const outcome = await serviceFor(cli).run(SCOPE);
		assert.ok(outcome.kind === 'failed' && outcome.detail.includes('cannot preview'));
		assert.deepStrictEqual(cli.imports(), []);
	});

	test('refuses an agent the CLI did not list, and ids that could be flags', async () => {
		const cli = fakeCli();
		const unknown = await serviceFor(cli).preview({ agent: '--force', sessionIds: [] });
		assert.ok(!unknown.ok && unknown.detail.includes('not an agent'));
		const bad = await serviceFor(cli).preview({ agent: 'claude-code', sessionIds: ['--all'] });
		assert.ok(!bad.ok && bad.detail.includes('session id'));
		assert.deepStrictEqual(cli.imports(), []);
	});

	test('says so when the CLI is missing, or has no import command', async () => {
		const missing = await serviceFor(fakeCli({ installed: false })).agents();
		assert.ok(!missing.ok && missing.detail.includes('not installed'));
		const old = fakeCli();
		fs.writeFileSync(path.join(old.dir, '.local', 'bin', 'entire'), '#!/bin/sh\nif [ "$1" = version ]; then echo "entire 0.12.2"; exit 0; fi\necho nope >&2; exit 2\n', 'utf8');
		const result = await serviceFor(old).agents();
		assert.ok(!result.ok && result.detail.includes("no 'import' command"));
	});

	test('does not remember a failed help lookup', async () => {
		const cli = fakeCli({ importHelp: '' });
		const first = await serviceFor(cli).agents();
		assert.strictEqual(first.ok, false);
		write(cli.dir, 'import-help.txt', IMPORT_HELP);
		const second = await serviceFor(cli).agents();
		assert.ok(second.ok);
	});

	test('does not block the extension host during a long import', async () => {
		const cli = fakeCli({ run: { sleep: 0.6 } });
		let ticks = 0;
		const timer = setInterval(() => (ticks += 1), 10);
		try {
			const started = Date.now();
			const outcome = await serviceFor(cli).run(SCOPE);
			const elapsed = Date.now() - started;
			assert.ok(outcome.kind === 'done');
			assert.ok(elapsed >= 500, `the fake import should take about 600ms, took ${elapsed}`);
			assert.ok(ticks >= 20, `the event loop should keep running during the import, ticked ${ticks} times`);
		} finally {
			clearInterval(timer);
		}
	});

	test('cancelling kills the import and reports it as cancelled, not as done', async () => {
		const cli = fakeCli({ run: { sleep: 30 } });
		const controller = new AbortController();
		const pending = serviceFor(cli, 60).run(SCOPE, controller.signal);
		await new Promise(resolve => setTimeout(resolve, 400));
		controller.abort();
		const started = Date.now();
		const outcome = await pending;
		assert.strictEqual(outcome.kind, 'cancelled');
		assert.ok(Date.now() - started < 5000);
	});

	test('a timeout is a failure with a reason', async () => {
		const cli = fakeCli({ run: { sleep: 30 } });
		const outcome = await serviceFor(cli, 1).run(SCOPE);
		assert.ok(outcome.kind === 'failed' && outcome.detail.includes('did not finish'));
	});

	test('keeps the import output out of the invocation record', async () => {
		const cli = fakeCli();
		const bodies: (string | undefined)[] = [];
		cli.runner.setSink({
			report: (invocation, recorded) => {
				if (invocation.args[0] === 'import' && !invocation.args.includes('--help')) {
					bodies.push(recorded.stdout);
				}
			},
		});
		await serviceFor(cli).run(SCOPE);
		assert.ok(bodies.length > 0);
		assert.ok(bodies.every(body => body === undefined));
	});
});

interface RecordedUi extends ImportUi {
	readonly confirmations: ImportConfirmation[];
	readonly informed: string[];
	readonly warned: string[];
	readonly progressTitles: string[];
}

function fakeUi(options: { agent?: string | undefined; narrowing?: ImportNarrowing; confirm?: boolean } = {}): RecordedUi {
	const confirmations: ImportConfirmation[] = [];
	const informed: string[] = [];
	const warned: string[] = [];
	const progressTitles: string[] = [];
	return {
		confirmations,
		informed,
		warned,
		progressTitles,
		chooseAgent: async () => ('agent' in options ? options.agent : 'claude-code'),
		chooseNarrowing: async () => options.narrowing ?? { kind: 'all' },
		confirm: async prompt => {
			confirmations.push(prompt);
			return options.confirm ?? true;
		},
		withProgress: async (title, work) => {
			progressTitles.push(title);
			return work(new AbortController().signal);
		},
		inform: async message => void informed.push(message),
		warn: async message => void warned.push(message),
	};
}

function importDeps(cli: FakeCli, ui: ImportUi): ImportDependencies & { refreshed: number } {
	const deps: ImportDependencies & { refreshed: number } = {
		importer: serviceFor(cli),
		ui,
		refresh: async () => void (deps.refreshed += 1),
		running: { active: false },
		refreshed: 0,
	};
	return deps;
}

suite('Import command', () => {
	test('shows what would be imported before importing, then imports (preview-import)', async () => {
		const cli = fakeCli();
		const ui = fakeUi();
		const deps = importDeps(cli, ui);

		assert.strictEqual(await importHistory(deps), 'done');

		assert.strictEqual(ui.confirmations.length, 1);
		assert.ok(ui.confirmations[0].detail.includes('Would import 3 turn(s) from 1 session(s) (2 already imported).'));
		assert.ok(ui.confirmations[0].detail.includes('Nothing has been written yet.'));
		const order = cli.invocations().filter(line => line.startsWith('import claude-code') && !line.endsWith('--help'));
		assert.deepStrictEqual(order, ['import claude-code --dry-run', 'import claude-code']);
		assert.strictEqual(deps.refreshed, 1);
		assert.ok(ui.informed[0].startsWith('Imported 3 turns'));
		assert.deepStrictEqual(ui.warned, []);
	});

	test('imports nothing when the preview is declined', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ confirm: false });
		const deps = importDeps(cli, ui);

		assert.strictEqual(await importHistory(deps), 'cancelled');

		assert.deepStrictEqual(cli.imports(), []);
		assert.strictEqual(deps.refreshed, 0);
		assert.deepStrictEqual(ui.informed.concat(ui.warned), []);
	});

	test('does not run anything when the person picks no agent or no scope', async () => {
		const cli = fakeCli();
		assert.strictEqual(await importHistory(importDeps(cli, fakeUi({ agent: undefined }))), 'cancelled');
		assert.deepStrictEqual(cli.invocations().filter(line => line.startsWith('import claude-code') && !line.endsWith('--help')), []);
	});

	test('narrows to the chosen sessions in both the preview and the import', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ narrowing: { kind: 'sessions', ids: [SESSION] } });
		assert.strictEqual(await importHistory(importDeps(cli, ui)), 'done');
		assert.deepStrictEqual(
			cli.invocations().filter(line => line.startsWith('import claude-code') && !line.endsWith('--help')),
			[`import claude-code --dry-run --session=${SESSION}`, `import claude-code --session=${SESSION}`],
		);
	});

	test('says there is nothing to import, and does not ask', async () => {
		const cli = fakeCli({ preview: { out: 'Would import 0 turn(s) from 0 session(s) (0 already imported).\n' } });
		const ui = fakeUi();
		assert.strictEqual(await importHistory(importDeps(cli, ui)), 'nothing-to-import');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.deepStrictEqual(cli.imports(), []);
	});

	test('reports a refusal by the CLI as a failure and refreshes anyway', async () => {
		const cli = fakeCli({ run: { exit: 1, out: '', err: 'transcript directory not readable' } });
		const ui = fakeUi();
		const deps = importDeps(cli, ui);

		assert.strictEqual(await importHistory(deps), 'failed');

		assert.deepStrictEqual(ui.informed, []);
		assert.ok(ui.warned[0].includes('import failed'));
		assert.ok(ui.warned[0].includes('transcript directory not readable'));
		assert.strictEqual(deps.refreshed, 1);
	});

	test('reports a refused preview as a failure and imports nothing', async () => {
		const cli = fakeCli({ preview: { exit: 1, out: '', err: 'no resolvable commit' } });
		const ui = fakeUi();
		assert.strictEqual(await importHistory(importDeps(cli, ui)), 'failed');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.ok(ui.warned[0].includes('no resolvable commit'));
		assert.deepStrictEqual(cli.imports(), []);
	});

	test('a missing CLI is a clear message, not a crash', async () => {
		const ui = fakeUi();
		assert.strictEqual(await importHistory(importDeps(fakeCli({ installed: false }), ui)), 'failed');
		assert.ok(ui.warned[0].includes('not installed'));
	});

	test('refuses a second import while one is running', async () => {
		const cli = fakeCli({ run: { sleep: 0.5 } });
		const ui = fakeUi();
		const deps = importDeps(cli, ui);
		const first = importHistory(deps);
		await new Promise(resolve => setTimeout(resolve, 150));
		assert.strictEqual(await importHistory(deps), 'cancelled');
		assert.ok(ui.informed.some(message => message.includes('already running')));
		assert.strictEqual(await first, 'done');
		assert.strictEqual(cli.imports().length, 1);
	});

	test('a cancelled import says turns may already be imported', async () => {
		const cli = fakeCli({ run: { sleep: 30 } });
		const controller = new AbortController();
		const ui: RecordedUi = {
			...fakeUi(),
			withProgress: async (_title, work) => {
				setTimeout(() => controller.abort(), 400);
				return work(controller.signal);
			},
		};
		const deps = importDeps(cli, ui);
		assert.strictEqual(await importHistory({ ...deps, importer: serviceFor(cli, 60) }), 'cancelled');
		assert.ok(ui.warned.length === 0 || ui.warned[0].includes('cancelled'));
	});
});

suite('Imported checkpoints are read-only', () => {
	test('decodes an imported session that has no worktree', () => {
		const decoded = decodeSessionList([IMPORTED_SESSION, LIVE_SESSION]);
		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value[0].worktreePath, undefined);
		assert.strictEqual(decoded.value[0].kind, 'imported');
		assert.strictEqual(decoded.value[0].readOnly, true);
		assert.strictEqual(isImportedSession(decoded.value[0]), true);
		assert.strictEqual(isImportedSession(decoded.value[1]), false);
	});

	test('marks a checkpoint whose sessions are all imported', () => {
		const sessions = unwrap(decodeSessionList([IMPORTED_SESSION, LIVE_SESSION]));
		const marked = markImported(
			[checkpoint(), checkpoint({ id: 'abc123def456', sessionIds: ['live-1'] }), checkpoint({ id: 'zzz', sessionIds: ['unknown'] })],
			sessions,
		);
		assert.deepStrictEqual(marked.map(c => c.imported === true), [true, false, false]);
	});

	test('uses the single session id when the list has no session_ids', () => {
		const sessions = unwrap(decodeSessionList([IMPORTED_SESSION]));
		const [marked] = markImported([checkpoint({ sessionIds: [], sessionId: SESSION })], sessions);
		assert.strictEqual(marked.imported, true);
	});

	test('marks from the checkpoint detail as well, when the list could not', () => {
		assert.strictEqual(isImportedCheckpoint({ imported: false }), false);
		assert.strictEqual(isImportedCheckpoint({ imported: false }, { strategy: 'import', sessions: [] }), true);
		assert.strictEqual(
			isImportedCheckpoint({ imported: false }, { strategy: undefined, sessions: [{ index: 0, kind: 'imported', filesTouched: [] }] }),
			true,
		);
		assert.strictEqual(
			isImportedCheckpoint({ imported: false }, { strategy: 'manual-commit', sessions: [{ index: 0, kind: 'captured', filesTouched: [] }] }),
			false,
		);
	});

	test('the checkpoint source marks imported checkpoints from the CLI session list', async () => {
		const cli = fakeCli({
			sessions: [IMPORTED_SESSION],
			checkpoints: [
				{ checkpoint_id: CHECKPOINT_ID, session_id: SESSION, agent: 'Claude Code', date: '2026-10-20T10:00:00Z', message: 'hello world task', is_logs_only: true, session_count: 1, session_ids: [SESSION] },
			],
		});
		const listing = await createCheckpointSource(cli.runner, () => cli.dir)();
		assert.strictEqual(listing.checkpoints.length, 1);
		assert.strictEqual(listing.checkpoints[0].imported, true);
	});

	test('the checkpoint source still lists checkpoints when the session list cannot be read', async () => {
		const cli = fakeCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID, date: '2026-10-20T10:00:00Z', session_ids: [SESSION] }],
		});
		write(cli.dir, 'sessions.json', 'not json');
		const listing = await createCheckpointSource(cli.runner, () => cli.dir)();
		assert.strictEqual(listing.checkpoints.length, 1);
		assert.notStrictEqual(listing.checkpoints[0].imported, true);
	});

	test('the tree shows an imported checkpoint as read-only (imported-checkpoint)', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [checkpoint({ imported: true }), checkpoint({ id: 'abc123def456', sessionIds: ['live-1'] })] }),
			async () => undefined,
			() => 0,
		);
		try {
			await provider.refresh();
			const [importedNode, capturedNode] = provider.getChildren();
			const imported = provider.getTreeItem(importedNode);
			const captured = provider.getTreeItem(capturedNode);

			assert.strictEqual(imported.contextValue, 'entirely.importedCheckpoint');
			assert.ok(String(imported.description).includes(IMPORTED_LABEL));
			assert.ok(String(imported.tooltip instanceof Object && 'value' in imported.tooltip ? imported.tooltip.value : '').includes('Read\\-only'));
			assert.strictEqual((imported.iconPath as { id: string }).id, 'lock');

			assert.strictEqual(captured.contextValue, 'entirely.checkpoint');
			assert.ok(!String(captured.description).includes(IMPORTED_LABEL));
			assert.strictEqual((captured.iconPath as { id: string }).id, 'git-commit');
		} finally {
			provider.dispose();
		}
	});

	test('the tree marks a checkpoint once its detail says it was imported', async () => {
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [checkpoint()] }),
			async id => ({ id, strategy: 'import', filesTouched: [], sessionCount: 1, sessions: [], partial: false }),
			() => 0,
		);
		try {
			await provider.refresh();
			const node = provider.getChildren()[0];
			assert.strictEqual(provider.getTreeItem(node).contextValue, 'entirely.checkpoint');
			provider.getChildren(node);
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.strictEqual(provider.getTreeItem(node).contextValue, 'entirely.importedCheckpoint');
		} finally {
			provider.dispose();
		}
	});

	test('the sessions tree gives an imported session its own context and a lock', async () => {
		const sessions = unwrap(decodeSessionList([IMPORTED_SESSION, LIVE_SESSION]));
		const provider = new SessionsProvider(async () => ({ sessions }), () => 0);
		try {
			await provider.refresh();
			const items = provider
				.getChildren()
				.flatMap(group => provider.getChildren(group))
				.map(node => provider.getTreeItem(node));
			const imported = items.find(item => item.contextValue === 'entirely.importedSession');
			assert.ok(imported);
			assert.ok(String(imported.description).includes(IMPORTED_LABEL));
			assert.ok(items.some(item => item.contextValue === 'entirely.session'));
		} finally {
			provider.dispose();
		}
	});

	test('no menu entry offers a changing command on an imported checkpoint or session', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
			contributes: { menus: Record<string, { command: string; when?: string }[]> };
		};
		const readOnlyContexts = ['entirely.importedCheckpoint', 'entirely.importedSession'];
		const harmless = new Set(['entirely.openTranscript']);
		const matches = (when: string, context: string): boolean => {
			const exact = /viewItem == ([\w.]+)/.exec(when);
			if (exact) {
				return exact[1] === context;
			}
			const pattern = /viewItem =~ \/(.+?)\//.exec(when);
			return pattern ? new RegExp(pattern[1]).test(context) : false;
		};
		for (const entry of manifest.contributes.menus['view/item/context']) {
			for (const context of readOnlyContexts) {
				if (entry.when && matches(entry.when, context)) {
					assert.ok(harmless.has(entry.command), `${entry.command} must not be offered on ${context}`);
				}
			}
		}
	});

	test('imported sessions are not offered to stop or resume, and the commands refuse them', async () => {
		const imported = sessionOf(IMPORTED_SESSION);
		const live = sessionOf(LIVE_SESSION);
		assert.deepStrictEqual([imported, live].filter(isStoppable).map(s => s.id), ['live-1']);
		assert.deepStrictEqual(resumable([{ ...imported, branch: 'main' }]), []);

		const informed: string[] = [];
		const ui = {
			confirm: async () => true,
			chooseSession: async () => undefined,
			chooseSessionOrId: async () => undefined,
			chooseCommit: async () => undefined,
			unsavedFiles: () => [],
			inform: async (m: string) => void informed.push(m),
			warn: async () => undefined,
		};
		const calls: string[] = [];
		const deps = {
			lifecycle: new Proxy({}, { get: (_t, name) => async () => (calls.push(String(name)), { kind: 'done', summary: '' }) }),
			sessions: async () => ({ sessions: [] }),
			ui,
			refresh: async () => undefined,
			workspaceRoot: () => '/work/here',
			launch: () => ({ status: () => ({ ended: true, exitCode: 0 }) }),
			resumeWatchMs: () => 10,
		} as unknown as LifecycleDependencies;

		assert.strictEqual(await stopSession(deps, imported), 'cancelled');
		assert.strictEqual(await resumeStoppedSession(deps, { ...imported, branch: 'main' }), 'cancelled');
		assert.deepStrictEqual(calls, []);
		assert.ok(informed.every(message => message.includes('read-only')));
	});

	test('the checkpoint list decoder leaves the imported flag to the join', () => {
		const decoded = decodeCheckpointList([{ checkpoint_id: CHECKPOINT_ID, date: '2026-10-20T10:00:00Z' }]);
		assert.ok(decoded.ok);
		assert.notStrictEqual(decoded.value[0].imported, true);
	});
});
