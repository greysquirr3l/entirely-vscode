import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	activeOnBranch,
	adoptArguments,
	asksForAgreement,
	attachArguments,
	cleanCliText,
	describeResume,
	failureDetail,
	isBranchName,
	isCommitRef,
	isStoppable,
	isWorktreePath,
	nameSession,
	planAdoptFlags,
	planAttachFlags,
	planResumeFlags,
	planStopFlags,
	resumable,
	resumeArguments,
	stopArguments,
	type LifecycleOutcome,
	type ResumeResult,
	type Session,
	type SessionListing,
	type SessionSource,
} from '../lib/entire';
import { SessionsProvider } from '../providers/sessionsProvider';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { clampLifecycleTimeout, clampResumeWatch } from '../services/configuration';
import { SessionLifecycleService, type SessionLifecycleSource } from '../services/sessionLifecycle';
import { resumeSession, type ResumeLauncher } from '../services/sessionResume';
import {
	adoptSession,
	attachSession,
	resumeStoppedSession,
	stopSession,
	type Confirmation,
	type LifecycleDependencies,
	type LifecycleUi,
} from '../commands/sessionLifecycle';

const STOP_HELP = `Usage:
  entire session stop [session-id] [flags]

Flags:
      --all     Stop all active sessions
  -f, --force   Skip confirmation prompt
  -h, --help    help for stop
`;

const ATTACH_HELP = `Usage:
  entire session attach <session-id> [flags]

Flags:
  -a, --agent string     Agent that created the session (see 'entire agent list' for registered agents, including external) (default "claude-code")
      --commit string    Link the session to this commit (hash, ref, or HEAD~n) instead of the last one
  -f, --force            Skip the confirmation. Only after the user has agreed to what attach describes
  -h, --help             help for attach
      --review           Tag the attached session as an agent review
`;

const ADOPT_HELP = `Usage:
  entire session adopt [session-id] [flags]

Flags:
      --force         replace an existing local state file for the same session
      --from string   source worktree that already tracks the session
  -h, --help          help for adopt
      --yes           confirm same-store adoption and replacement without prompting
`;

const RESUME_HELP = `Resume an agent session.

With a branch argument, switches to that branch and resumes its session directly.

Usage:
  entire session resume [branch] [flags]

Flags:
  -f, --force   Resume from older checkpoint without confirmation
`;

/** A CLI that names the same jobs with different flags. */
const RENAMED = {
	stop: 'Flags:\n      --no-prompt   Skip confirmation prompt\n',
	attach:
		'Flags:\n      --at string   Link the session to this commit instead of the last one\n      --go          Skip the confirmation. Only after the user has agreed\n',
	adopt:
		'Flags:\n      --origin string   source worktree that already tracks the session\n      --ok              confirm adoption without prompting\n',
};

const WORKTREE = '/work/other';

function session(overrides: Partial<Session> = {}): Session {
	return {
		id: 'sess-1',
		agent: 'Claude Code',
		status: 'active',
		worktreePath: WORKTREE,
		branch: 'feat/x',
		...overrides,
	};
}

suite('Session lifecycle flags', () => {
	test('stop finds the flag that skips the CLI prompt from its help line', () => {
		const plan = planStopFlags(STOP_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.skipPrompt, '--force');

		const renamed = planStopFlags(RENAMED.stop);
		assert.ok(renamed.ok);
		assert.strictEqual(renamed.skipPrompt, '--no-prompt');
	});

	test('stop fails when the help offers no way past the prompt', () => {
		assert.strictEqual(planStopFlags('Flags:\n      --all   Stop all\n').ok, false);
	});

	test('attach finds the commit flag and the agreement flag, not the others', () => {
		const plan = planAttachFlags(ATTACH_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.commit, '--commit');
		assert.strictEqual(plan.proceed, '--force');

		const renamed = planAttachFlags(RENAMED.attach);
		assert.ok(renamed.ok);
		assert.strictEqual(renamed.commit, '--at');
		assert.strictEqual(renamed.proceed, '--go');
	});

	test('attach fails when the help names no commit flag', () => {
		const plan = planAttachFlags('Flags:\n  -f, --force   Skip the confirmation.\n');
		assert.strictEqual(plan.ok, false);
	});

	test('adopt finds the source flag and the confirm flag, leaving force alone', () => {
		const plan = planAdoptFlags(ADOPT_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.from, '--from');
		assert.strictEqual(plan.confirm, '--yes');

		const renamed = planAdoptFlags(RENAMED.adopt);
		assert.ok(renamed.ok);
		assert.strictEqual(renamed.from, '--origin');
		assert.strictEqual(renamed.confirm, '--ok');
	});

	test('adopt fails when the help cannot be read as a worktree command', () => {
		assert.strictEqual(planAdoptFlags('Flags:\n      --yes   confirm without prompting\n').ok, false);
	});

	test('resume needs the help to describe a branch', () => {
		assert.ok(planResumeFlags(RESUME_HELP).ok);
		assert.strictEqual(planResumeFlags('Resume something.').ok, false);
	});

	test('ids, refs, branches and paths that look like flags are refused', () => {
		assert.strictEqual(isCommitRef('HEAD~2'), true);
		assert.strictEqual(isCommitRef('abc123def456'), true);
		assert.strictEqual(isCommitRef('--force'), false);
		assert.strictEqual(isCommitRef('a b'), false);
		assert.strictEqual(isCommitRef('a..b'), false);
		assert.strictEqual(isBranchName('feat/x-1'), true);
		assert.strictEqual(isBranchName('-D'), false);
		assert.strictEqual(isBranchName('x\ny'), false);
		assert.strictEqual(isBranchName('x.lock'), false);
		assert.strictEqual(isWorktreePath('/work/other'), true);
		assert.strictEqual(isWorktreePath('--force'), false);
		assert.strictEqual(isWorktreePath('../relative'), false);
		assert.strictEqual(isWorktreePath('/a\u0000b'), false);
	});

	test('ids go after the end of options and values are bound to their flags', () => {
		assert.deepStrictEqual(stopArguments({ skipPrompt: '--force' }, 'sess-1'), [
			'session', 'stop', '--force', '--', 'sess-1',
		]);
		assert.deepStrictEqual(attachArguments({ commit: '--commit', proceed: '--force' }, 'sess-1', 'HEAD~1', false), [
			'session', 'attach', '--commit=HEAD~1', '--', 'sess-1',
		]);
		assert.deepStrictEqual(attachArguments({ commit: '--commit', proceed: '--force' }, 'sess-1', 'HEAD', true), [
			'session', 'attach', '--commit=HEAD', '--force', '--', 'sess-1',
		]);
		assert.deepStrictEqual(adoptArguments({ from: '--from', confirm: '--yes' }, 'sess-1', WORKTREE), [
			'session', 'adopt', '--from=/work/other', '--yes', '--', 'sess-1',
		]);
		assert.deepStrictEqual(resumeArguments('feat/x'), ['session', 'resume', '--', 'feat/x']);
	});

	test('a refused attach is a question only when it names the agreement flag', () => {
		assert.strictEqual(asksForAgreement('rerun with --force', '--force'), true);
		assert.strictEqual(asksForAgreement('transcript not found for agent', '--force'), false);
	});

	test('CLI text loses colour codes and control characters and is bounded', () => {
		assert.strictEqual(cleanCliText('\u001b[31mred\u001b[0m\u0007 text  \n'), 'red text');
		assert.strictEqual(cleanCliText('x'.repeat(50), 10).length, 10);
		assert.strictEqual(failureDetail('', '', 'exit 1'), 'exit 1');
		assert.strictEqual(failureDetail('Session not found.\n', 'ignored', 'exit 1'), 'Session not found.');
	});

	test('names a session so a person can tell which one it is', () => {
		assert.strictEqual(nameSession(session()), 'sess-1 (Claude Code on feat/x)');
		assert.strictEqual(nameSession(session({ branch: undefined })), 'sess-1 (Claude Code)');
	});

	test('only an ended session is not stoppable, and only stopped sessions on a branch resume', () => {
		const sessions = [
			session(),
			session({ id: 'b', status: 'ended' }),
			session({ id: 'c', status: 'stale' }),
			session({ id: 'd', status: 'ended', branch: undefined }),
		];
		assert.deepStrictEqual(sessions.filter(isStoppable).map(s => s.id), ['sess-1', 'c']);
		assert.deepStrictEqual(resumable(sessions).map(s => s.id), ['b', 'c']);
		assert.deepStrictEqual(activeOnBranch(sessions, 'feat/x').map(s => s.id), ['sess-1']);
	});

	test('clamps the lifecycle settings', () => {
		assert.strictEqual(clampLifecycleTimeout(1), 5);
		assert.strictEqual(clampLifecycleTimeout(99999), 600);
		assert.strictEqual(clampLifecycleTimeout(Number.NaN), 60);
		assert.strictEqual(clampResumeWatch(0), 5);
		assert.strictEqual(clampResumeWatch(30.7), 30);
	});
});

suite('Resume reports', () => {
	test('says what was and was not seen', () => {
		const active: ResumeResult = { kind: 'active', session: session() };
		assert.ok(describeResume('feat/x', active).startsWith('Resumed: sess-1'));

		const running = describeResume('feat/x', { kind: 'not-seen', ended: false });
		assert.ok(running.includes('still running'));
		assert.ok(running.includes('No active session appeared'));

		const failed = describeResume('feat/x', { kind: 'not-seen', ended: true, exitCode: 2 });
		assert.ok(failed.includes('exit code 2'));

		const blind = describeResume('feat/x', { kind: 'not-seen', ended: true, unreadable: 'timed out' });
		assert.ok(blind.includes('could not be read'));
		assert.ok(!blind.includes('No active session appeared'));

		assert.ok(describeResume('feat/x', { kind: 'failed', detail: 'no CLI' }).startsWith('Could not resume'));
		assert.ok(describeResume('feat/x', { kind: 'already-active', session: session() }).includes('already active'));
	});
});

interface FakeBehaviour {
	readonly exit?: number;
	readonly out?: string;
	readonly err?: string;
}

interface FakeOptions {
	/** Help per action; an action left out is unknown to this CLI. */
	help?: Partial<Record<'stop' | 'attach' | 'adopt' | 'resume', string>>;
	stop?: FakeBehaviour;
	attachPreview?: FakeBehaviour;
	attach?: FakeBehaviour;
	adopt?: FakeBehaviour;
	sessions?: readonly unknown[];
	installed?: boolean;
	/** The flag attach is given to agree. */
	proceedFlag?: string;
}

interface FakeCli {
	readonly runner: CliRunner;
	readonly dir: string;
	invocations(): string[];
	mutations(): string[];
}

function writeBehaviour(dir: string, name: string, behaviour: FakeBehaviour | undefined): void {
	fs.writeFileSync(path.join(dir, `${name}.exit`), String(behaviour?.exit ?? 0), 'utf8');
	fs.writeFileSync(path.join(dir, `${name}.out`), behaviour?.out ?? 'ok', 'utf8');
	fs.writeFileSync(path.join(dir, `${name}.err`), behaviour?.err ?? '', 'utf8');
}

function fakeCli(options: FakeOptions = {}): FakeCli {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-lifecycle-'));
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');

	const help = options.help ?? { stop: STOP_HELP, attach: ATTACH_HELP, adopt: ADOPT_HELP, resume: RESUME_HELP };
	for (const action of ['stop', 'attach', 'adopt', 'resume'] as const) {
		fs.writeFileSync(path.join(dir, `help-${action}.txt`), help[action] ?? '', 'utf8');
	}
	writeBehaviour(dir, 'stop', options.stop);
	writeBehaviour(dir, 'attach-preview', options.attachPreview);
	writeBehaviour(dir, 'attach', options.attach);
	writeBehaviour(dir, 'adopt', options.adopt);
	fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(options.sessions ?? []), 'utf8');

	const act = (name: string): string =>
		`cat '${dir}/${name}.out'; cat '${dir}/${name}.err' >&2; exit $(cat '${dir}/${name}.exit')`;
	const known = (action: string): string =>
		help[action as keyof typeof help] === undefined
			? '\t"agent-help session ' + action + '") echo "unknown command" >&2; exit 2 ;;'
			: `\t"agent-help session ${action}") cat '${dir}/help-${action}.txt' ;;`;

	const script = [
		'#!/bin/sh',
		'if [ "$1" = "--context" ]; then shift 2; fi',
		`echo "$@" >> '${log}'`,
		'case "$1 $2 $3" in',
		'\t"version  ") echo "entire 0.12.2" ;;',
		known('stop'),
		known('attach'),
		known('adopt'),
		known('resume'),
		`\t"session list --json") cat '${dir}/sessions.json' ;;`,
		`\t"session stop "*) ${act('stop')} ;;`,
		`\t"session attach "*) case " $* " in *" ${options.proceedFlag ?? '--force'} "*) ${act('attach')} ;; *) ${act('attach-preview')} ;; esac ;;`,
		`\t"session adopt "*) ${act('adopt')} ;;`,
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
		mutations: () => invocations().filter(line => /^session (stop|attach|adopt|resume)/.test(line)),
	};
}

function serviceFor(cli: FakeCli): SessionLifecycleService {
	return new SessionLifecycleService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 10 });
}

function failed(outcome: LifecycleOutcome): string {
	assert.ok(outcome.kind === 'failed', `expected a failure, got ${outcome.kind}`);
	return outcome.detail;
}

suite('Session lifecycle service', () => {
	test('stop passes the skip flag from the help and the id after --', async () => {
		const cli = fakeCli({ stop: { out: '✓ Session sess-1 stopped.' } });
		const outcome = await serviceFor(cli).stop('sess-1');
		assert.deepStrictEqual(outcome, { kind: 'done', summary: '✓ Session sess-1 stopped.' });
		assert.deepStrictEqual(cli.mutations(), ['session stop --force -- sess-1']);
	});

	test('stop follows a CLI whose help renames the flag', async () => {
		const cli = fakeCli({ help: { ...{ stop: RENAMED.stop } } });
		await serviceFor(cli).stop('sess-1');
		assert.deepStrictEqual(cli.mutations(), ['session stop --no-prompt -- sess-1']);
	});

	test('stop reports a CLI that refuses as a failure, with its words', async () => {
		const cli = fakeCli({ stop: { exit: 1, out: '', err: 'Session not found.' } });
		assert.strictEqual(failed(await serviceFor(cli).stop('sess-1')), 'Session not found.');
	});

	test('stop never reaches the CLI with an id that could be read as a flag', async () => {
		const cli = fakeCli();
		assert.ok(failed(await serviceFor(cli).stop('--all')).includes('session id'));
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('stop fails with a reason when the CLI is missing or too old', async () => {
		const missing = fakeCli({ installed: false });
		assert.ok(/not installed/.test(failed(await serviceFor(missing).stop('sess-1'))));

		const old = fakeCli({ help: {} });
		const detail = failed(await serviceFor(old).stop('sess-1'));
		assert.ok(/update the CLI/.test(detail));
		assert.deepStrictEqual(old.mutations(), []);
	});

	test('a failed help lookup is not remembered', async () => {
		const cli = fakeCli({ help: {} });
		const service = serviceFor(cli);
		await service.stop('a');
		await service.stop('b');
		assert.strictEqual(cli.invocations().filter(line => line.startsWith('agent-help')).length, 2);
	});

	test('attach previews first, then agrees with the flag from the help', async () => {
		const cli = fakeCli({
			attachPreview: { exit: 1, out: '', err: 'This rewrites git history.\nrerun with --force' },
			attach: { out: 'Attached session sess-1\n  Created checkpoint 01ABC' },
		});
		const service = serviceFor(cli);

		const preview = await service.previewAttach('sess-1', 'HEAD~1');
		assert.ok(preview.kind === 'needs-agreement');
		assert.ok(preview.preview.includes('rewrites git history'));
		assert.deepStrictEqual(cli.mutations(), ['session attach --commit=HEAD~1 -- sess-1']);

		const done = await service.attach('sess-1', 'HEAD~1');
		assert.ok(done.kind === 'done');
		assert.ok(done.summary.includes('Created checkpoint 01ABC'));
		assert.strictEqual(cli.mutations()[1], 'session attach --commit=HEAD~1 --force -- sess-1');
	});

	test('attach follows renamed flags', async () => {
		const cli = fakeCli({
			help: { attach: RENAMED.attach },
			proceedFlag: '--go',
			attachPreview: { exit: 1, err: 'rerun with --go' },
		});
		const service = serviceFor(cli);
		assert.ok((await service.previewAttach('sess-1', 'HEAD')).kind === 'needs-agreement');
		await service.attach('sess-1', 'HEAD');
		assert.deepStrictEqual(cli.mutations(), [
			'session attach --at=HEAD -- sess-1',
			'session attach --at=HEAD --go -- sess-1',
		]);
	});

	test('attach reports a refusal that does not ask for agreement as a failure', async () => {
		const cli = fakeCli({ attachPreview: { exit: 1, err: 'transcript not found for agent "claude-code"' } });
		const detail = failed(await serviceFor(cli).previewAttach('sess-1', 'HEAD'));
		assert.ok(detail.startsWith('transcript not found'));
	});

	test('attach reports a CLI that fails after agreement as a failure', async () => {
		const cli = fakeCli({ attach: { exit: 1, err: 'a remote could not be reached' } });
		assert.ok(failed(await serviceFor(cli).attach('sess-1', 'HEAD')).includes('remote'));
	});

	test('attach counts a preview that succeeds as done', async () => {
		const cli = fakeCli({ attachPreview: { out: 'Session sess-1 is already in checkpoint 01ABC on commit 3367.' } });
		const outcome = await serviceFor(cli).previewAttach('sess-1', 'HEAD');
		assert.ok(outcome.kind === 'done');
		assert.ok(outcome.summary.includes('already in checkpoint'));
	});

	test('attach refuses a commit that could be read as a flag', async () => {
		const cli = fakeCli();
		assert.ok(failed(await serviceFor(cli).previewAttach('sess-1', '--force')).includes('commit'));
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('adopt passes the worktree and confirmation from the help', async () => {
		const cli = fakeCli({ adopt: { out: 'Adopted session sess-1 from /work/other' } });
		const outcome = await serviceFor(cli).adopt('sess-1', WORKTREE);
		assert.ok(outcome.kind === 'done');
		assert.deepStrictEqual(cli.mutations(), ['session adopt --from=/work/other --yes -- sess-1']);
	});

	test('adopt follows renamed flags and reports a refusal', async () => {
		const renamed = fakeCli({ help: { adopt: RENAMED.adopt } });
		await serviceFor(renamed).adopt('sess-1', WORKTREE);
		assert.deepStrictEqual(renamed.mutations(), ['session adopt --origin=/work/other --ok -- sess-1']);

		const refusing = fakeCli({ adopt: { exit: 1, err: 'session sess-1 is ended or fully condensed and cannot be adopted' } });
		assert.ok(failed(await serviceFor(refusing).adopt('sess-1', WORKTREE)).includes('cannot be adopted'));
	});

	test('adopt refuses a relative or flag-like source', async () => {
		const cli = fakeCli();
		assert.ok(failed(await serviceFor(cli).adopt('sess-1', '--yes')).includes('absolute'));
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('resume prepares the terminal command without running it', async () => {
		const cli = fakeCli();
		const launch = await serviceFor(cli).prepareResume('feat/x');
		assert.ok(launch.ok);
		assert.ok(launch.path.endsWith('entire'));
		assert.deepStrictEqual(launch.args, ['session', 'resume', '--', 'feat/x']);
		assert.deepStrictEqual(cli.mutations(), []);
	});

	test('resume carries the pinned login to the terminal', async () => {
		const cli = fakeCli();
		cli.runner.setContext('work');
		const launch = await serviceFor(cli).prepareResume('feat/x');
		assert.ok(launch.ok);
		assert.deepStrictEqual(launch.args.slice(0, 2), ['--context', 'work']);
		assert.strictEqual(launch.env['ENTIRE_CONTEXT'], 'work');
	});

	test('resume fails with a reason for a missing CLI, a too-old CLI and a bad branch', async () => {
		const missing = await serviceFor(fakeCli({ installed: false })).prepareResume('feat/x');
		assert.ok(!missing.ok && /not installed/.test(missing.detail));

		const old = await serviceFor(fakeCli({ help: {} })).prepareResume('feat/x');
		assert.ok(!old.ok && /update the CLI/.test(old.detail));

		const bad = await serviceFor(fakeCli()).prepareResume('-D');
		assert.ok(!bad.ok && /branch/.test(bad.detail));
	});
});

interface RecordedUi extends LifecycleUi {
	readonly confirmations: Confirmation[];
	readonly informed: string[];
	readonly warned: string[];
}

function fakeUi(options: {
	confirm?: boolean;
	pick?: Session;
	pickId?: string;
	commit?: string;
} = {}): RecordedUi {
	const confirmations: Confirmation[] = [];
	const informed: string[] = [];
	const warned: string[] = [];
	return {
		confirmations,
		informed,
		warned,
		confirm: async prompt => {
			confirmations.push(prompt);
			return options.confirm ?? true;
		},
		chooseSession: async () => options.pick,
		chooseSessionOrId: async () =>
			options.pickId ? { id: options.pickId } : options.pick ? { id: options.pick.id, session: options.pick } : undefined,
		chooseCommit: async () => options.commit ?? 'HEAD',
		inform: async message => void informed.push(message),
		warn: async message => void warned.push(message),
	};
}

function dependencies(
	cli: FakeCli,
	ui: LifecycleUi,
	extra: Partial<LifecycleDependencies> & { listing?: SessionSource } = {},
): LifecycleDependencies & { refreshed: number } {
	const state = { refreshed: 0 };
	const deps: LifecycleDependencies & { refreshed: number } = {
		lifecycle: serviceFor(cli),
		sessions: extra.listing ?? (async (): Promise<SessionListing> => ({ sessions: [] })),
		ui,
		refresh: async () => {
			state.refreshed += 1;
			deps.refreshed = state.refreshed;
		},
		workspaceRoot: () => '/work/here',
		launch: () => ({ status: () => ({ ended: true, exitCode: 0 }) }),
		resumeWatchMs: () => 50,
		pollMs: 1,
		sleep: async () => undefined,
		refreshed: 0,
		...extra,
	};
	return deps;
}

suite('Stop session command', () => {
	test('confirms, naming the session, and then stops it (stop-session)', async () => {
		const cli = fakeCli({ stop: { out: '✓ Session sess-1 stopped.' } });
		const ui = fakeUi({ confirm: true });
		const deps = dependencies(cli, ui);

		assert.strictEqual(await stopSession(deps, session()), 'done');

		assert.strictEqual(ui.confirmations.length, 1);
		assert.ok(ui.confirmations[0].message.includes('sess-1'));
		assert.ok(ui.confirmations[0].message.includes('Claude Code'));
		assert.ok(ui.confirmations[0].message.includes('feat/x'));
		assert.deepStrictEqual(cli.mutations(), ['session stop --force -- sess-1']);
		assert.strictEqual(deps.refreshed, 1);
		assert.ok(ui.informed[0].startsWith('Stopped sess-1'));
	});

	test('does nothing when the confirmation is declined', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ confirm: false });
		const deps = dependencies(cli, ui);

		assert.strictEqual(await stopSession(deps, session()), 'cancelled');

		assert.strictEqual(ui.confirmations.length, 1);
		assert.deepStrictEqual(cli.invocations(), []);
		assert.deepStrictEqual(ui.informed.concat(ui.warned), []);
		assert.strictEqual(deps.refreshed, 0);
	});

	test('reports a CLI that refuses as a failure, not a stop', async () => {
		const cli = fakeCli({ stop: { exit: 1, err: 'Session not found.' } });
		const ui = fakeUi();

		assert.strictEqual(await stopSession(dependencies(cli, ui), session()), 'failed');

		assert.deepStrictEqual(ui.informed, []);
		assert.ok(ui.warned[0].includes('Could not stop sess-1'));
		assert.ok(ui.warned[0].includes('Session not found.'));
	});

	test('asks which session when none was named, and stops nothing if none is chosen', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ pick: undefined });
		assert.strictEqual(await stopSession(dependencies(cli, ui)), 'cancelled');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('does not offer to stop a session that has ended', async () => {
		const cli = fakeCli();
		const ui = fakeUi();
		assert.strictEqual(await stopSession(dependencies(cli, ui), session({ status: 'ended' })), 'cancelled');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.ok(ui.informed[0].includes('already ended'));
	});
});

suite('Attach session command', () => {
	test('links the session to the chosen commit and says what the CLI linked (attach-session)', async () => {
		const cli = fakeCli({
			attachPreview: { exit: 1, err: 'This rewrites git history.\nrerun with --force' },
			attach: { out: 'Attached session sess-1\n  Created checkpoint 01ABC' },
		});
		const ui = fakeUi({ commit: 'HEAD~1' });
		const deps = dependencies(cli, ui);

		assert.strictEqual(await attachSession(deps, session()), 'done');

		assert.ok(ui.confirmations[0].message.includes('sess-1'));
		assert.ok(ui.confirmations[0].message.includes('HEAD~1'));
		assert.ok(ui.confirmations[0].detail.includes('rewrites git history'));
		assert.deepStrictEqual(cli.mutations(), [
			'session attach --commit=HEAD~1 -- sess-1',
			'session attach --commit=HEAD~1 --force -- sess-1',
		]);
		assert.ok(ui.informed[0].includes('Created checkpoint 01ABC'));
		assert.strictEqual(deps.refreshed, 1);
	});

	test('changes nothing when the description is declined', async () => {
		const cli = fakeCli({ attachPreview: { exit: 1, err: 'rerun with --force' } });
		const ui = fakeUi({ confirm: false });

		assert.strictEqual(await attachSession(dependencies(cli, ui), session()), 'cancelled');

		assert.deepStrictEqual(cli.mutations(), ['session attach --commit=HEAD -- sess-1']);
		assert.deepStrictEqual(ui.informed.concat(ui.warned), []);
	});

	test('attaches a session the tree does not list, by id', async () => {
		const cli = fakeCli({ attachPreview: { out: 'Session ext-9 is already in checkpoint 01ABC.' } });
		const ui = fakeUi({ pickId: 'ext-9' });

		assert.strictEqual(await attachSession(dependencies(cli, ui)), 'done');
		assert.deepStrictEqual(cli.mutations(), ['session attach --commit=HEAD -- ext-9']);
	});

	test('reports a refusal as a failure', async () => {
		const cli = fakeCli({ attachPreview: { exit: 1, err: 'transcript not found' } });
		const ui = fakeUi();

		assert.strictEqual(await attachSession(dependencies(cli, ui), session()), 'failed');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.ok(ui.warned[0].includes('transcript not found'));
		assert.deepStrictEqual(ui.informed, []);
	});

	test('does nothing when no commit is chosen', async () => {
		const cli = fakeCli();
		const ui = fakeUi();
		const noCommit: LifecycleUi = { ...ui, chooseCommit: async () => undefined };
		assert.strictEqual(await attachSession(dependencies(cli, noCommit), session()), 'cancelled');
		assert.deepStrictEqual(cli.invocations(), []);
	});
});

suite('Adopt session command', () => {
	const here = '/work/here';

	test('adopts the session and says it is in the tree once the tree lists it (adopt-session)', async () => {
		const cli = fakeCli({ adopt: { out: 'Adopted session sess-1 from /work/other' } });
		const ui = fakeUi();
		let adopted = false;
		const listing: SessionSource = async () => ({
			sessions: [session({ worktreePath: adopted ? here : WORKTREE })],
		});
		const base = dependencies(cli, ui, { listing });
		const deps: LifecycleDependencies = {
			...base,
			lifecycle: {
				...base.lifecycle,
				adopt: async (id, from) => {
					adopted = true;
					return serviceFor(cli).adopt(id, from);
				},
			} as SessionLifecycleSource,
		};

		assert.strictEqual(await adoptSession(deps, session()), 'done');

		assert.ok(ui.confirmations[0].message.includes('sess-1'));
		assert.ok(ui.confirmations[0].detail.includes(WORKTREE));
		assert.deepStrictEqual(cli.mutations(), ['session adopt --from=/work/other --yes -- sess-1']);
		assert.ok(ui.informed[0].includes('in the Sessions view now'));
	});

	test('does not claim the tree lists a session it does not', async () => {
		const cli = fakeCli({ adopt: { out: 'Adopted' } });
		const ui = fakeUi();
		const deps = dependencies(cli, ui, { listing: async () => ({ sessions: [session()] }) });

		assert.strictEqual(await adoptSession(deps, session()), 'done');
		assert.ok(ui.informed[0].includes('does not list it for this workspace yet'));
	});

	test('does nothing when declined', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ confirm: false });
		const deps = dependencies(cli, ui);
		assert.strictEqual(await adoptSession(deps, session()), 'cancelled');
		assert.deepStrictEqual(cli.invocations(), []);
		assert.strictEqual(deps.refreshed, 0);
	});

	test('reports a CLI that refuses as a failure', async () => {
		const cli = fakeCli({ adopt: { exit: 1, err: 'cannot be adopted' } });
		const ui = fakeUi();
		assert.strictEqual(await adoptSession(dependencies(cli, ui), session()), 'failed');
		assert.ok(ui.warned[0].includes('cannot be adopted'));
		assert.deepStrictEqual(ui.informed, []);
	});

	test('has nothing to adopt for a session already in this workspace', async () => {
		const cli = fakeCli();
		const ui = fakeUi();
		const deps = dependencies(cli, ui);
		assert.strictEqual(await adoptSession(deps, session({ worktreePath: here })), 'cancelled');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.deepStrictEqual(cli.invocations(), []);
	});
});

function resumeSource(scripted: readonly (readonly Session[] | string)[]): { source: SessionSource; reads: () => number } {
	let reads = 0;
	return {
		reads: () => reads,
		source: async () => {
			const step = scripted[Math.min(reads, scripted.length - 1)];
			reads += 1;
			return typeof step === 'string' ? { sessions: [], emptyReason: step } : { sessions: step };
		},
	};
}

const noSleep = async (): Promise<void> => undefined;

suite('Resume session', () => {
	function lifecycleReady(cli: FakeCli): SessionLifecycleSource {
		return serviceFor(cli);
	}

	test('reports the session as resumed when it shows up active (resume-session)', async () => {
		const cli = fakeCli();
		const stopped = session({ status: 'ended' });
		const { source } = resumeSource([[stopped], [stopped], [session()]]);
		const launched: string[][] = [];
		const launch: ResumeLauncher = command => {
			launched.push([...command.args]);
			return { status: () => ({ ended: false }) };
		};

		const result = await resumeSession(
			{ lifecycle: lifecycleReady(cli), sessions: source, launch, watchMs: () => 1000, pollMs: 1, sleep: noSleep },
			'feat/x',
		);

		assert.ok(result.kind === 'active');
		assert.deepStrictEqual(launched, [['session', 'resume', '--', 'feat/x']]);
		assert.deepStrictEqual(cli.mutations(), []);
	});

	test('does not claim a resume when no session appears before the watch ends', async () => {
		const cli = fakeCli();
		const { source } = resumeSource([[session({ status: 'ended' })]]);
		const result = await resumeSession(
			{
				lifecycle: lifecycleReady(cli),
				sessions: source,
				launch: () => ({ status: () => ({ ended: false }) }),
				watchMs: () => 20,
				pollMs: 1,
				sleep: () => new Promise(resolve => setTimeout(resolve, 5)),
			},
			'feat/x',
		);
		assert.ok(result.kind === 'not-seen');
		assert.strictEqual(result.ended, false);
		assert.ok(describeResume('feat/x', result).includes('still running'));
	});

	test('reports the exit code of a resume that ended without the session coming back', async () => {
		const cli = fakeCli();
		const { source } = resumeSource([[session({ status: 'ended' })]]);
		const result = await resumeSession(
			{
				lifecycle: lifecycleReady(cli),
				sessions: source,
				launch: () => ({ status: () => ({ ended: true, exitCode: 1 }) }),
				watchMs: () => 1000,
				pollMs: 1,
				sleep: noSleep,
			},
			'feat/x',
		);
		assert.ok(result.kind === 'not-seen');
		assert.strictEqual(result.exitCode, 1);
		assert.strictEqual(result.ended, true);
	});

	test('says so when the session list cannot be read, instead of saying none appeared', async () => {
		const cli = fakeCli();
		const { source } = resumeSource(['the command timed out']);
		const result = await resumeSession(
			{
				lifecycle: lifecycleReady(cli),
				sessions: source,
				launch: () => ({ status: () => ({ ended: true }) }),
				watchMs: () => 1000,
				pollMs: 1,
				sleep: noSleep,
			},
			'feat/x',
		);
		assert.ok(result.kind === 'not-seen');
		assert.strictEqual(result.unreadable, 'the command timed out');
	});

	test('starts nothing when the branch already has an active session', async () => {
		const cli = fakeCli();
		let launches = 0;
		const result = await resumeSession(
			{
				lifecycle: lifecycleReady(cli),
				sessions: resumeSource([[session()]]).source,
				launch: () => {
					launches += 1;
					return { status: () => ({ ended: true }) };
				},
				watchMs: () => 100,
				sleep: noSleep,
			},
			'feat/x',
		);
		assert.strictEqual(result.kind, 'already-active');
		assert.strictEqual(launches, 0);
	});

	test('fails, and starts nothing, when the CLI is missing', async () => {
		const cli = fakeCli({ installed: false });
		let launches = 0;
		const result = await resumeSession(
			{
				lifecycle: lifecycleReady(cli),
				sessions: resumeSource([[]]).source,
				launch: () => {
					launches += 1;
					return { status: () => ({ ended: true }) };
				},
				watchMs: () => 100,
				sleep: noSleep,
			},
			'feat/x',
		);
		assert.ok(result.kind === 'failed' && /not installed/.test(result.detail));
		assert.strictEqual(launches, 0);
	});

	test('the command reports each outcome in words and refreshes the tree', async () => {
		const cli = fakeCli();
		const ui = fakeUi();
		const stopped = session({ status: 'ended' });
		const deps = dependencies(cli, ui, {
			listing: resumeSource([[stopped], [session()]]).source,
			launch: () => ({ status: () => ({ ended: false }) }),
		});

		assert.strictEqual(await resumeStoppedSession(deps, stopped), 'done');
		assert.ok(ui.informed[0].startsWith('Resumed: sess-1'));
		assert.strictEqual(deps.refreshed, 1);

		const quiet = fakeUi();
		const none = dependencies(cli, quiet, {
			listing: resumeSource([[stopped]]).source,
			launch: () => ({ status: () => ({ ended: true, exitCode: 0 }) }),
		});
		assert.strictEqual(await resumeStoppedSession(none, stopped), 'unconfirmed');
		assert.ok(quiet.informed[0].includes('No active session appeared'));
	});

	test('the command refuses a session with no branch and a CLI that is missing', async () => {
		const ui = fakeUi();
		const noBranch = await resumeStoppedSession(
			dependencies(fakeCli(), ui),
			session({ status: 'ended', branch: undefined }),
		);
		assert.strictEqual(noBranch, 'failed');
		assert.ok(ui.warned[0].includes('no branch to resume'));

		const gone = fakeUi();
		const missing = await resumeStoppedSession(
			dependencies(fakeCli({ installed: false }), gone),
			session({ status: 'ended' }),
		);
		assert.strictEqual(missing, 'failed');
		assert.ok(gone.warned[0].includes('Could not resume'));
	});
});

suite('Lifecycle commands are never run on their own', () => {
	test('polling the Sessions view reads the list and nothing else', async function () {
		this.timeout(8000);
		const cli = fakeCli({ sessions: [] });
		serviceFor(cli);
		const tree = new SessionsProvider(
			async () => {
				await cli.runner.run(['session', 'list', '--json'], { cwd: cli.dir });
				return { sessions: [] };
			},
			() => 1,
		);
		await new Promise(resolve => setTimeout(resolve, 2300));
		tree.dispose();

		assert.ok(cli.invocations().some(line => line === 'session list --json'));
		assert.deepStrictEqual(cli.mutations(), []);
		assert.ok(!cli.invocations().some(line => line.startsWith('agent-help')));
	});

	test('the service runs nothing until a method is called', async () => {
		const cli = fakeCli();
		serviceFor(cli);
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.deepStrictEqual(cli.invocations(), []);
	});
});
