import * as fs from 'fs';
import * as path from 'path';

import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { makeTempDir } from './tempDir';

/**
 * A stateful FAKE of the Entire CLI for the checkpoint deletion commands.
 *
 * The help text is CAPTURED from the real CLI (0.12.2): `entire agent-help
 * checkpoint delete`, its flag table and its prose about what a deletion
 * reaches. INVENTED, not captured, because running them would change the
 * machine: the dry-run text, the refusals, the shape of the deletion's
 * own output, and the exit code of every failure.
 *
 * It is a Node script behind a one-line shim. The checkpoints live in a
 * state file, so a deletion changes what a later `checkpoint list`
 * prints. Every call is appended to a log as one JSON line, written before
 * any output, and the login the command ran as is recorded with it.
 */

/**
 * The plan the real CLI prints for a deletion.
 *
 * CAPTURED from the real CLI 0.12.2, run against a throwaway copy of a
 * repository. The shape, the wording and the order are the CLI's own.
 * The ids in it are the ones that capture used.
 */
export const PLAN = `Checkpoint {id}

Local:
  ref refs/entire/checkpoints/{fanout}/{id}

Remotes:
  none configured

Sessions in this checkpoint (their token counts are removed with it):
  edebce2b-aa62-41df-b3d3-1e65ab54c240  Claude Code  input 92, output 16430 tokens

Other local checkpoints of these sessions (not deleted; this list is local only,
and the sessions stay visible on entire.com while these remain):
  01M6AEG27M697D463Z49694KKM  edebce2b-aa62-41df-b3d3-1e65ab54c240
  01M69TXFPXXHQDY0B765P8MJ7S  edebce2b-aa62-41df-b3d3-1e65ab54c240`;

/**
 * The dry-run's last line. CAPTURED.
 *
 * The plan is printed first, and then this, and then nothing happened.
 */
export const DRY_RUN_END = 'Dry run: nothing was changed.';

/**
 * The plan of a deletion that also reaches a remote, as the CLI prints it.
 *
 * CAPTURED. The only difference from the plan above is the remotes
 * section, which names the remote and says that it holds the checkpoint.
 */
export const PLAN_WITH_REMOTE = PLAN.replace(
	'  none configured',
	'  checkpoints (/tmp/entire-checkpoints.git): holds ref',
);

/**
 * What the real CLI prints when the deletion has happened.
 *
 * CAPTURED from the real CLI 0.12.2. The plan comes first, and then the
 * outcome, one line per copy that was reached.
 */
export const DELETED = `Local ref: deleted
Deleted checkpoint 01M69REJV7YMCYJQNZXWSX2VJZ.`;

/** The outcome of a deletion that also reached a remote. CAPTURED. */
export const DELETED_EVERYWHERE = `Local ref: deleted
checkpoints: ref deleted
Deleted checkpoint 01M69REJV7YMCYJQNZXWSX2VJZ.`;

/**
 * The outcome of a local-only deletion. CAPTURED.
 *
 * The CLI does not refuse: it deletes the local copy, says so, and warns
 * that the remote was not checked.
 */
export const DELETED_LOCAL_ONLY = `Local ref: deleted
Deleted the local copy of checkpoint 01M69REJV7YMCYJQNZXWSX2VJZ.
checkpoints was not checked (--local-only) and may still hold it.`;

/**
 * What the real CLI says when it is asked to delete without confirming.
 *
 * CAPTURED: the plan goes to stdout and the refusal to stderr, and the
 * exit code is 1.
 */
export const REFUSED = 'refusing to delete checkpoint 01M69REJV7YMCYJQNZXWSX2VJZ without confirmation; pass --force';

/** What the real CLI says about a checkpoint that is not there. CAPTURED. */
export const NOT_FOUND =
	'delete checkpoint: checkpoint not found: 01M69REJV7YMCYJQNZXWSX2VJZ is not in this repository or on any reachable checkpoint remote';

/** What the real CLI says about a prefix of an id. CAPTURED. */
export const PREFIX_REFUSED =
	'invalid checkpoint ID "01M69REJ": pass the full ID (prefixes are not accepted)';

/** The help of `entire checkpoint delete`, as the real CLI prints it. */
export const DELETE_HELP = `entire checkpoint delete — Delete a checkpoint locally and from checkpoint remotes
Delete one checkpoint from this repository and from every checkpoint remote
that holds it.

The full checkpoint ID is required; prefixes are not accepted. Deleting from a
remote cannot be undone. A checkpoint on the entire/checkpoints/v1 branch is
removed from the branch tip only: the branch's history still contains it.

With --local-only no remote is contacted, except on the git-branch backend:
there a local removal reaches the sync remote on the next git push, so that
remote is checked, and --local-only (or a selection that leaves it out) is
refused while it holds a copy or cannot be reached. With push_sessions
disabled the removal is not pushed, but re-enabling it later pushes it.

Other checkpoints of the same sessions are listed but not deleted. Each one
carries the session's full transcript, so the session stays visible on
entire.com while any of them remain.

Without --force the command asks for confirmation, and refuses when it cannot
prompt. --dry-run prints what would be deleted and changes nothing.

Flags:
      --dry-run              Print what would be deleted without changing anything
  -f, --force                Delete without asking for confirmation
      --json                 Output as JSON
      --local-only           Delete only the local copy; leave every remote untouched
      --remote stringArray   Limit remote deletion to this remote; the local copy is still deleted

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

/** One checkpoint in the fake's state. */
export interface FakeCheckpoint {
	readonly checkpoint_id: string;
	readonly message?: string;
	readonly agent?: string;
	readonly date?: string;
	readonly session_ids?: readonly string[];
	readonly branch?: string;
}

/** How the fake should behave. */
export interface FakeCheckpointDeletionOptions {
	/** Commands the fake does not have, as `agent-help` names them. */
	readonly without?: readonly string[];
	/** Replaces the help of `checkpoint delete`. */
	readonly help?: string;
	/** The checkpoints the list holds. */
	readonly checkpoints?: readonly FakeCheckpoint[];
	/** The dry-run fails with this, and exits non-zero. */
	readonly dryRunFail?: string;
	/** The name of the checkpoint remote the plan names. */
	readonly remote?: string;
	/** The URL the plan gives for that remote. */
	readonly remoteUrl?: string;
	/** The session the plan names. */
	readonly session?: string;
	/** The agent of that session. */
	readonly agent?: string;
	/** The other checkpoint of that session the plan names. */
	readonly otherCheckpoint?: string;
	/** The deletion fails with this, and exits non-zero. */
	readonly deleteFail?: string;
	/** The deletion refuses `--local-only` with this, and exits non-zero. */
	readonly localOnlyRefusal?: string;
	/** The deletion takes this many milliseconds, so a timeout can be tested. */
	readonly deleteDelayMs?: number;
	/** The list fails with this, and exits non-zero. */
	readonly listFail?: string;
	/** The deletion succeeds but the checkpoint stays listed. */
	readonly keepOnDelete?: boolean;
	/** The detail of the first checkpoint. */
	readonly detail?: Record<string, unknown>;
}

/** One call the fake recorded. */
export interface FakeCall {
	readonly context: string | undefined;
	readonly args: readonly string[];
	readonly line: string;
}

/** The fake CLI. */
export interface FakeCheckpointDeletionCli {
	readonly runner: CliRunner;
	readonly dir: string;
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
	/** Every call, in order. */
	calls(): readonly FakeCall[];
	/** The calls that change something. */
	mutations(): readonly FakeCall[];
	/** The checkpoint ids the list holds now. */
	listed(): readonly string[];
}

const SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const statePath = path.join(root, 'state.json');
let args = process.argv.slice(2);
if (args[0] === '--context') args = args.slice(2);
const out = text => process.stdout.write(text.endsWith('\n') ? text : text + '\n');
const fail = (text, code = 1) => { process.stderr.write(text.endsWith('\n') ? text : text + '\n'); process.exit(code); };
const load = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = state => fs.writeFileSync(statePath, JSON.stringify(state));
const operand = () => { const i = args.indexOf('--'); return i >= 0 ? args[i + 1] : undefined; };
const planFor = id => config.plan.split('{id}').join(id).split('{fanout}').join(id.slice(-2));

fs.appendFileSync(path.join(root, 'calls.log'), JSON.stringify({ context: process.env.ENTIRE_CONTEXT, args }) + '\n');

if (args[0] === 'version') { out('entire 0.12.2'); process.exit(0); }

if (args[0] === 'agent-help') {
  const words = args.slice(1);
  if (config.without.indexOf(words.join(' ')) >= 0) {
    fail('Error: Invalid usage: unknown command "' + words.join(' ') + '"');
  }
  if (words.join(' ') === 'checkpoint delete') {
    out(config.help);
    process.exit(0);
  }
  if (words.length === 1 && words[0] === 'checkpoint') {
    out('entire checkpoint — Work with checkpoints');
    process.exit(0);
  }
  fail('Error: Invalid usage: unknown command "' + words.join(' ') + '"');
}

if (args[0] !== 'checkpoint') fail('Error: Invalid usage: unknown command "' + args[0] + '"');
const sub = args[1];
const state = load();

if (sub === 'list') {
  if (config.listFail) fail(config.listFail);
  out(JSON.stringify(state.checkpoints));
  process.exit(0);
}

if (sub === 'explain') {
  const id = operand();
  const found = state.checkpoints.filter(c => c.checkpoint_id === id)[0];
  if (!found) fail('Error: checkpoint not found');
  out(JSON.stringify(config.detail && config.detail.checkpoint_id === id ? config.detail : Object.assign({ checkpoint_id: id, session_count: 1, sessions: [], files_touched: [] }, found)));
  process.exit(0);
}

if (sub === 'delete') {
  const id = operand();
  const dryRun = args.indexOf('--dry-run') >= 0;
  const localOnly = args.indexOf('--local-only') >= 0;
  const force = args.indexOf('--force') >= 0;
  if (!id || !/^[0-9a-f]{12}$|^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) {
    fail('invalid checkpoint ID "' + id + '": pass the full ID (prefixes are not accepted)');
  }
  const found = state.checkpoints.filter(c => c.checkpoint_id === id)[0];
  if (!found) {
    fail('delete checkpoint: checkpoint not found: ' + id + ' is not in this repository or on any reachable checkpoint remote');
  }
  if (dryRun) {
    if (config.dryRunFail) fail(config.dryRunFail);
    out(planFor(id));
    out('');
    out(config.dryRunEnd);
    process.exit(0);
  }
  out(planFor(id));
  out('');
  if (!force) {
    fail('refusing to delete checkpoint ' + id + ' without confirmation; pass --force');
  }
  if (config.deleteDelayMs) {
    const until = Date.now() + config.deleteDelayMs;
    while (Date.now() < until) {}
  }
  if (config.deleteFail) fail(config.deleteFail);
  if (localOnly && config.localOnlyRefusal) fail(config.localOnlyRefusal);
  if (!config.keepOnDelete) {
    state.checkpoints = state.checkpoints.filter(c => c.checkpoint_id !== id);
    save(state);
  }
  out('Local ref: deleted');
  if (localOnly) {
    if (config.remote) out(config.remote + ' was not checked (--local-only) and may still hold it.');
    else out('Deleted checkpoint ' + id + '.');
  } else {
    if (config.remote) out(config.remote + ': ref deleted');
    out('Deleted checkpoint ' + id + '.');
  }
  process.exit(0);
}

fail('Error: Invalid usage: unknown command "checkpoint ' + sub + '"');
`;

/** Builds the fake CLI. */
export function fakeCheckpointDeletionCli(
	options: FakeCheckpointDeletionOptions = {},
): FakeCheckpointDeletionCli {
	const dir = makeTempDir('entire-checkpoint-delete-');
	const bin = path.join(dir, '.local', 'bin');
	const lib = path.join(bin, 'lib');
	fs.mkdirSync(lib, { recursive: true });

	const config = {
		plan: options.remote ? PLAN_WITH_REMOTE : PLAN,
		dryRunEnd: DRY_RUN_END,
		without: options.without ?? [],
		help: options.help ?? DELETE_HELP,
		dryRunFail: options.dryRunFail,
		remote: options.remote,
		remoteUrl: options.remoteUrl ?? '/tmp/entire-checkpoints.git',
		session: options.session ?? 'edebce2b-aa62-41df-b3d3-1e65ab54c240',
		agent: options.agent ?? 'Claude Code',
		otherCheckpoint: options.otherCheckpoint ?? '01M6AEG27M697D463Z49694KKM',
		deleteFail: options.deleteFail,
		localOnlyRefusal: options.localOnlyRefusal,
		deleteDelayMs: options.deleteDelayMs,
		listFail: options.listFail,
		keepOnDelete: options.keepOnDelete,
		detail: options.detail,
	};

	fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
	fs.writeFileSync(
		path.join(dir, 'state.json'),
		JSON.stringify({ checkpoints: options.checkpoints ?? [] }),
	);
	fs.writeFileSync(path.join(dir, 'calls.log'), '');

	const script = path.join(lib, 'fake.js');
	fs.writeFileSync(script, SCRIPT, 'utf8');
	const shim = path.join(bin, 'entire');
	fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 'utf8');
	fs.chmodSync(shim, 0o755);

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });

	const calls = (): FakeCall[] =>
		fs
			.readFileSync(path.join(dir, 'calls.log'), 'utf8')
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => JSON.parse(line) as { context?: string; args: string[] })
			.map(call => ({ context: call.context, args: call.args, line: call.args.join(' ') }));

	return {
		runner,
		dir,
		recorded,
		calls,
		mutations: () => calls().filter(call => /^checkpoint delete\b/.test(call.line) && !/--dry-run/.test(call.line)),
		listed: () =>
			(
				JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as {
					checkpoints: FakeCheckpoint[];
				}
			).checkpoints.map(checkpoint => checkpoint.checkpoint_id),
	};
}
