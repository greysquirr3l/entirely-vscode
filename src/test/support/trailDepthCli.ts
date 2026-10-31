import * as fs from 'fs';
import * as path from 'path';

import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import { makeTempDir } from './tempDir';
import { SHOWN_CHANGE, TRAIL_LIST } from './trailCli';

/**
 * A stateful fake of the Entire CLI for the trail depth commands.
 *
 * It is a Node script, so the discussions, findings and trails it holds
 * change when a write is made and a later listing shows the change, the
 * way a real service would. Switches make a write succeed without
 * changing anything, fail with "project not found", refuse as an agent
 * session, or be missing from `agent-help`. Everything built on it is
 * verified against a FAKE only: no create, update, discussion write,
 * finding write, apply or watch was run against the real service.
 *
 * Every call is appended to a log, one JSON object per line, so a test
 * can say what was run, as which login, and in what order.
 */

/** One discussion the fake holds. */
export interface FakeDiscussion {
	id: string;
	title?: string;
	resolved: boolean;
	lastMessageAuthor?: string;
	messageCount: number;
	messages: { id: string; author: string; body: string; createdAt: string }[];
}

/** One finding the fake holds. */
export interface FakeFinding {
	id: string;
	title?: string;
	body?: string;
	status: 'open' | 'resolved' | 'dismissed';
	severity?: string;
	confidence?: number;
	location?: { filePath: string; startLine: number };
	createdAt: string;
}

/** Everything the fake keeps. */
export interface FakeTrailDepthState {
	trails: Record<string, unknown>[];
	discussions: FakeDiscussion[];
	findings: FakeFinding[];
	/** Patches applied, by finding id, so a test can say an apply happened. */
	applied: string[];
	/** The next number for a trail, a discussion, a message. */
	next: { trail: number; discussion: number; message: number };
}

/** What the fake should do differently from a working service. */
export interface FakeTrailDepthOptions {
	/** The handle every write is recorded under. Defaults to `ada`. */
	author?: string;
	/** Commands whose `agent-help` fails, as a CLI without the command does. */
	without?: string[];
	/** Commands that exit 1 with this stderr, by command words such as `trail comment reply`. */
	fails?: Record<string, string>;
	/** Commands that exit 0 and change nothing. */
	noEffect?: string[];
	/** Every `trail` command fails with "project not found". */
	projectNotFound?: boolean;
	/** Every discussion write is refused as an agent session. */
	agentRefusal?: boolean;
	/** `trail create` adds two trails with the same title. */
	createTwice?: boolean;
	/** `trail create` exits 1 after adding the trail. */
	createFailsAfterAdding?: boolean;
	/** What `comment show --json` prints: the messages, a form nobody reads, or a failure. */
	showShape?: 'messages' | 'unreadable' | 'fail';
	/** Help text replacements, by command words. */
	helps?: Record<string, string>;
	/** Lines `trail watch` prints at once. */
	watchLines?: string[];
	/** The code `trail watch` exits with after printing them; absent keeps it running until killed. */
	watchExit?: number;
	/** What `trail watch` writes to stderr before it exits. */
	watchStderr?: string;
	/** Starting state, merged over the default. */
	state?: Partial<FakeTrailDepthState>;
}

/** One recorded call. */
export interface FakeCall {
	/** The login named by `--context`, when one was. */
	context?: string;
	/** The login named by the environment, when one was. */
	env?: string;
	/** The arguments after the leading `--context NAME`. */
	args: string[];
	/** The arguments as one line. */
	line: string;
}

export interface FakeTrailDepthCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** Every call at all, help lookups and probes included. */
	all(): FakeCall[];
	/** Every call that is not a help lookup or a probe. */
	calls(): FakeCall[];
	/** Calls that change something: create, update, discussion writes, finding writes, an apply (not a check). */
	mutations(): FakeCall[];
	/** Calls to `trail watch`. */
	watches(): FakeCall[];
	state(): FakeTrailDepthState;
	setState(change: (state: FakeTrailDepthState) => void): void;
	/** Adds a line for the running watch to print. */
	emit(line: string): void;
	/** The signals the watch process received, one per line it recorded. */
	signals(): string[];
	/** Whether a watch process is running now. */
	watchRunning(): boolean;
}

const INHERITED = `
Inherited flags:
      --branch string    Select a repository branch within the trail
      --context name     Act as this saved login name for this command only
      --project string   Project as gh/<owner> or et/<project>; required for list, otherwise defaults to the repository's namespace
      --repo string      Target repository as forge/owner/repo (e.g. gh/acme/app) or a clone URL; for list, only filters the required --project
`;

const TRAIL_FLAG = `      --trail string     Project trail number, ID, or <repo>/<number> (defaults to the current branch's parent)\n`;

function help(title: string, flags: string, withTrail = true): string {
	return `${title}\n\nFlags:\n${flags}${INHERITED}${withTrail ? TRAIL_FLAG : ''}`;
}

/** The help of each command, copied from the real CLI (0.12.2) for the flags the extension reads. */
export const DEPTH_HELPS: Readonly<Record<string, string>> = {
	'trail create': help(
		'entire trail create — Create a trail and publish its branch',
		`      --assignee strings         Assignee logins; replaces the complete list (--assignee= clears it)
      --base string              Base branch for new code work
      --body string              Trail description (--body= clears it on update)
      --branch string            Branch to use (defaults to the current feature branch; create derives one from the title on the base branch)
      --branch-action string     Branch action: link existing remote work, or create a new branch (default "link")
      --idempotency-key string   Retry key for linking a branch; with intent-only creation, requires project management
      --json                     Output raw JSON instead of a table
      --no-branch                Create intent scoped to the current or --repo repository; --project alone creates unscoped intent
      --priority string          Priority (urgent, high, medium, low, none)
      --status string            Lifecycle status (open, closed)
      --title string             Trail title
      --type string              Type (bug, feature, task)
`,
		false,
	),
	'trail update': help(
		'entire trail update — Update project intent and lifecycle',
		`      --add-assignee strings      Add assignee logins
      --assignee strings          Assignee logins; replaces the complete list (--assignee= clears it)
      --body string               Trail description (--body= clears it on update)
      --branch string             Discover the project trail through this repository branch (defaults to current branch when no trail is given)
      --json                      Output raw JSON instead of a table
      --priority string           Priority (urgent, high, medium, low, none)
      --remove-assignee strings   Remove assignee logins
      --status string             Lifecycle status (open, closed)
      --title string              Trail title
      --type string               Type (bug, feature, task)
`,
		false,
	),
	'trail watch': help(
		"entire trail watch — Tail events for a trail's selected repository branch",
		`      --branch string   Select a repository branch within the trail
      --json            Print each event as a single JSON line
      --once            Open one SSE connection then exit instead of reconnecting
      --show-pings      Print SSE keepalive pings (otherwise suppressed)
`,
		false,
	),
	'trail comment add': help(
		'entire trail comment add — Start a discussion on the trail',
		`  -m, --body string    Message body (required)
      --json           Output raw JSON instead of a table
      --title string   Discussion title
`,
	),
	'trail comment list': help('entire trail comment list — List trail discussions', '      --json   Output raw JSON instead of a table\n'),
	'trail comment show': help('entire trail comment show — Show a discussion and its messages', '      --json   Output raw JSON instead of a table\n'),
	'trail comment reply': help(
		'entire trail comment reply — Reply to a trail discussion',
		'  -m, --body string   Message body (required)\n      --json          Output raw JSON instead of a table\n',
	),
	'trail comment edit': help(
		'entire trail comment edit — Edit a discussion message',
		'  -m, --body string   Message body (required)\n      --json          Output raw JSON instead of a table\n',
	),
	'trail comment delete': help(
		'entire trail comment delete — Delete a discussion message',
		'  -f, --force   Confirm message deletion\n      --json    Output raw JSON instead of a table\n',
	),
	'trail comment resolve': help('entire trail comment resolve — Resolve a trail discussion', '      --json   Output raw JSON instead of a table\n'),
	'trail comment unresolve': help('entire trail comment unresolve — Reopen a trail discussion', '      --json   Output raw JSON instead of a table\n'),
	'trail finding list': help(
		'entire trail finding list — List findings for a trail',
		`      --cursor string       Continue from the next cursor returned by a previous page
      --freshness string    Filter code-version freshness: current,stale,any (default "current")
      --include-dismissed   Include dismissed findings
      --json                Output as JSON
  -n, --limit int           Maximum number of findings to show (default 100)
      --severity string     Filter by comma-separated severity value(s): high,medium,low
      --status string       Filter by lifecycle status(es): open,resolved,dismissed; use 'any' for all (default "open")
`,
	),
	'trail finding show': help('entire trail finding show — Show a finding', ''),
	'trail finding apply': help(
		"entire trail finding apply — Apply a finding's unified-diff suggestion",
		`      --check     Only check whether the patch applies; do not modify files
      --resolve   Mark the finding resolved after applying
`,
	),
	'trail finding dismiss': help('entire trail finding dismiss — Dismiss a finding', '  -m, --message string   Status reason to record\n'),
	'trail finding reopen': help('entire trail finding reopen — Reopen a finding', '  -m, --message string   Status reason to record\n'),
	'trail finding resolve': help('entire trail finding resolve — Resolve a finding', '  -m, --message string   Status reason to record\n'),
	'trail finding update': help(
		"entire trail finding update — Update a finding's metadata",
		`  -m, --body string        Finding body
      --confidence float   Finding confidence from 0.0 to 1.0 (default -1)
      --json               Output as JSON
      --severity string    Finding severity: high,medium,low
`,
	),
};

/** The state a fake starts with. */
export function defaultDepthState(): FakeTrailDepthState {
	return {
		trails: [{ ...TRAIL_LIST.items[0], assignees: [] }],
		discussions: [
			{
				id: '01DISC1',
				title: 'Naming',
				resolved: false,
				lastMessageAuthor: 'ada',
				messageCount: 2,
				messages: [
					{ id: '01MSG1', author: 'grace', body: 'Should this be renamed?', createdAt: '2026-10-02T10:00:00Z' },
					{ id: '01MSG2', author: 'ada', body: 'Yes, I will do it.', createdAt: '2026-10-02T10:05:00Z' },
				],
			},
		],
		findings: [
			{
				id: '01FIND1',
				title: 'Unchecked input',
				body: 'The input is used before it is checked.',
				status: 'open',
				severity: 'high',
				location: { filePath: 'src/a.ts', startLine: 12 },
				createdAt: '2026-10-02T11:00:00Z',
			},
			{ id: '01FIND2', title: 'Long line', body: 'A line is too long.', status: 'open', severity: 'low', createdAt: '2026-10-02T11:01:00Z' },
			{ id: '01FIND3', title: 'Old note', body: 'Done already.', status: 'resolved', severity: 'medium', createdAt: '2026-10-02T11:02:00Z' },
		],
		applied: [],
		next: { trail: 41, discussion: 2, message: 3 },
	};
}

// The script is plain JavaScript and reads its configuration from files next to it.
const SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const statePath = path.join(root, 'state.json');
const loadState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const saveState = state => fs.writeFileSync(statePath, JSON.stringify(state));

let argv = process.argv.slice(2);
let context;
if (argv[0] === '--context') { context = argv[1]; argv = argv.slice(2); }
const isHelp = argv[0] === 'agent-help' || argv.includes('--help');
fs.appendFileSync(path.join(root, 'calls.log'), JSON.stringify({ context, env: process.env.ENTIRE_CONTEXT, args: argv, help: isHelp || argv[0] === 'version' || (argv[0] === 'repo' && argv[1] === 'view') }) + '\n');

const out = text => process.stdout.write(text.endsWith('\n') ? text : text + '\n');
const fail = (text, code = 1) => { process.stderr.write(text.endsWith('\n') ? text : text + '\n'); process.exit(code); };

const VALUE_FLAGS = new Set(['--title','--body','--type','--priority','--status','--assignee','--add-assignee','--remove-assignee','--trail','--branch','--message','--severity','--confidence','--project','--repo','--context']);
const flags = {}; const pos = []; const operands = [];
let ended = false;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (ended) { operands.push(a); continue; }
  if (a === '--') { ended = true; continue; }
  if (a.startsWith('--')) {
    if (VALUE_FLAGS.has(a)) { flags[a] = argv[i + 1]; i += 1; } else { flags[a] = true; }
  } else { pos.push(a); }
}

const words = [];
for (const a of argv) { if (a.startsWith('-')) break; words.push(a); }
const key3 = words.slice(0, 3).join(' ');
const key2 = words.slice(0, 2).join(' ');

if (argv[0] === 'version') { out('entire 0.12.2'); process.exit(0); }
if (argv[0] === 'agent-help') {
  const asked = argv.slice(1).join(' ');
  if (config.without.includes(asked) || config.helps[asked] === undefined) fail('unknown command "' + asked + '" for "entire"');
  out(config.helps[asked]); process.exit(0);
}
if (argv.includes('--help')) {
  const asked = argv.filter(a => a !== '--help').join(' ');
  if (config.without.includes(asked) || config.helps[asked] === undefined) fail('unknown command');
  out(config.helps[asked]); process.exit(0);
}
if (argv[0] === 'repo' && argv[1] === 'view') { out('{"repo":"/gh/greysquirr3l/entirely-vscode"}'); process.exit(0); }
if (argv[0] !== 'trail') fail('unknown command', 2);

if (config.projectNotFound) fail('Error: project not found');
const named = words[1] === 'comment' || words[1] === 'finding' ? words.slice(0, 3).join(' ') : words.slice(0, 2).join(' ');
const failKey = named === 'trail finding apply' && flags['--check'] ? 'trail finding apply --check' : named;
if (config.fails[failKey]) fail(config.fails[failKey]);
const state = loadState();
const author = config.author;
const now = '2026-10-03T09:00:00Z';
const noEffect = config.noEffect.includes(named);
const discussionRefusal = () => {
  if (config.agentRefusal) fail('refusing ' + String.fromCharCode(96) + 'entire ' + named + String.fromCharCode(96) + ': trail discussions are for people, but this is an agent session');
};
const trailSelector = flags['--trail'] || pos[named.split(' ').length];

const trailView = trail => Object.assign({}, trail, {
  url: 'https://entire.example/trails/' + trail.number,
  project: { id: '01PROJECT', name: 'greysquirr3l', provider: 'github', reference: { forge: 'gh', project: 'greysquirr3l' } },
  changes: [config.change],
});
const find = (list, id, label) => { const found = list.find(item => item.id === id); if (!found) fail(label + ' not found: ' + id); return found; };

switch (named) {
  case 'trail list': out(JSON.stringify({ items: state.trails })); break;
  case 'trail show': {
    const number = Number(String(trailSelector || '').replace(/^.*\//, ''));
    const trail = state.trails.find(item => item.number === number) || state.trails[0];
    out(JSON.stringify(trailView(trail))); break;
  }
  case 'trail create': {
    if (!noEffect) {
      const count = config.createTwice ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const number = state.next.trail; state.next.trail += 1;
        state.trails.push({ id: '01TRAIL' + number, number, title: flags['--title'] || '', body: flags['--body'] || '', status: 'open', type: flags['--type'] || 'task', priority: flags['--priority'] || 'none', assignees: [], projectId: '01PROJECT', isPossiblyPartial: false });
      }
      saveState(state);
    }
    if (config.createFailsAfterAdding) fail('Error: linking the branch failed after the trail was created');
    out('created'); break;
  }
  case 'trail update': {
    const number = Number(String(trailSelector || '').replace(/^.*\//, ''));
    const trail = state.trails.find(item => item.number === number) || state.trails[0];
    if (!noEffect) {
      if ('--title' in flags) trail.title = flags['--title'];
      if ('--body' in flags) trail.body = flags['--body'];
      if ('--type' in flags) trail.type = flags['--type'];
      if ('--priority' in flags) trail.priority = flags['--priority'];
      if ('--status' in flags) trail.status = flags['--status'];
      const list = text => String(text).split(',').map(item => item.trim()).filter(Boolean);
      if ('--assignee' in flags) trail.assignees = list(flags['--assignee']);
      if ('--add-assignee' in flags) trail.assignees = Array.from(new Set(trail.assignees.concat(list(flags['--add-assignee']))));
      if ('--remove-assignee' in flags) trail.assignees = trail.assignees.filter(item => !list(flags['--remove-assignee']).includes(item));
      saveState(state);
    }
    out('updated'); break;
  }
  case 'trail watch': {
    // The handler and the pid marker come first: a line on stdout is what the extension
    // (and so a test) waits for, and a stop that arrived before the handler would kill
    // the process without leaving the signal record.
    process.on('SIGTERM', () => { fs.appendFileSync(path.join(root, 'signals.log'), 'SIGTERM\n'); process.exit(143); });
    fs.writeFileSync(path.join(root, 'watch.pid'), String(process.pid));
    for (const line of config.watchLines) out(line);
    if (config.watchExit !== undefined) {
      if (config.watchStderr) process.stderr.write(config.watchStderr + '\n');
      process.exit(config.watchExit);
    }
    let offset = 0;
    const feed = path.join(root, 'feed.txt');
    setInterval(() => {
      if (!fs.existsSync(feed)) return;
      const text = fs.readFileSync(feed, 'utf8');
      if (text.length > offset) { process.stdout.write(text.slice(offset)); offset = text.length; }
    }, 15);
    break;
  }
  case 'trail comment list': out(JSON.stringify({ items: state.discussions.map(({ messages, ...row }) => row) })); break;
  case 'trail comment show': {
    if (config.showShape === 'fail') fail('Error: could not show the discussion');
    const discussion = find(state.discussions, operands[0], 'discussion');
    out(config.showShape === 'unreadable' ? JSON.stringify({ discussion: { id: discussion.id, text: 'a form nobody reads' } }) : JSON.stringify({ id: discussion.id, title: discussion.title, messages: discussion.messages }));
    break;
  }
  case 'trail comment add': {
    discussionRefusal();
    if (!noEffect) {
      const id = '01DISC' + state.next.discussion; state.next.discussion += 1;
      const mid = '01MSG' + state.next.message; state.next.message += 1;
      state.discussions.push({ id, title: flags['--title'], resolved: false, lastMessageAuthor: author, messageCount: 1, messages: [{ id: mid, author, body: flags['--body'], createdAt: now }] });
      saveState(state);
    }
    out('commented'); break;
  }
  case 'trail comment reply': {
    discussionRefusal();
    const discussion = find(state.discussions, operands[0], 'discussion');
    if (!noEffect) {
      const mid = '01MSG' + state.next.message; state.next.message += 1;
      discussion.messages.push({ id: mid, author, body: flags['--body'], createdAt: now });
      discussion.messageCount += 1; discussion.lastMessageAuthor = author;
      saveState(state);
    }
    out('replied'); break;
  }
  case 'trail comment edit': {
    discussionRefusal();
    const discussion = find(state.discussions, operands[0], 'discussion');
    const message = find(discussion.messages, operands[1], 'message');
    if (!noEffect) { message.body = flags['--body']; saveState(state); }
    out('edited'); break;
  }
  case 'trail comment delete': {
    discussionRefusal();
    if (!flags['--force']) fail('refusing to delete without confirmation; pass the force flag');
    const discussion = find(state.discussions, operands[0], 'discussion');
    find(discussion.messages, operands[1], 'message');
    if (!noEffect) {
      discussion.messages = discussion.messages.filter(item => item.id !== operands[1]);
      discussion.messageCount = discussion.messages.length;
      discussion.lastMessageAuthor = discussion.messages.length ? discussion.messages[discussion.messages.length - 1].author : undefined;
      saveState(state);
    }
    out('deleted'); break;
  }
  case 'trail comment resolve':
  case 'trail comment unresolve': {
    discussionRefusal();
    const discussion = find(state.discussions, operands[0], 'discussion');
    if (!noEffect) { discussion.resolved = named.endsWith(' unresolve') ? false : true; saveState(state); }
    out('ok'); break;
  }
  case 'trail finding list': {
    const any = flags['--status'] === 'any';
    const rows = state.findings.filter(item => any ? (flags['--include-dismissed'] || item.status !== 'dismissed') : item.status === 'open');
    out(JSON.stringify({ findings: rows })); break;
  }
  case 'trail finding show': {
    const finding = find(state.findings, operands[0], 'finding');
    out('Finding ' + finding.id + '\nStatus: ' + finding.status + '\n\n' + (finding.body || '')); break;
  }
  case 'trail finding dismiss':
  case 'trail finding reopen':
  case 'trail finding resolve': {
    const finding = find(state.findings, operands[0], 'finding');
    if (!noEffect) {
      finding.status = named.endsWith(' dismiss') ? 'dismissed' : named.endsWith(' reopen') ? 'open' : 'resolved';
      saveState(state);
    }
    out('ok'); break;
  }
  case 'trail finding update': {
    const finding = find(state.findings, operands[0], 'finding');
    if (!noEffect) {
      if ('--body' in flags) finding.body = flags['--body'];
      if ('--severity' in flags) finding.severity = flags['--severity'];
      if ('--confidence' in flags) finding.confidence = Number(flags['--confidence']);
      saveState(state);
    }
    out('{}'); break;
  }
  case 'trail finding apply': {
    const finding = find(state.findings, operands[0], 'finding');
    if (flags['--check']) { out('the patch applies'); break; }
    if (!noEffect) {
      state.applied.push(finding.id);
      if (flags['--resolve']) finding.status = 'resolved';
      saveState(state);
    }
    out('applied'); break;
  }
  default: fail('unknown subcommand', 2);
}
`;

/** Builds the fake and its runner. */
export function fakeTrailDepthCli(options: FakeTrailDepthOptions = {}): FakeTrailDepthCli {
	const dir = makeTempDir('entire-trail-depth-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });

	const without = options.without ?? [];
	const helps: Record<string, string> = { ...DEPTH_HELPS, ...(options.helps ?? {}) };
	const config = {
		author: options.author ?? 'ada',
		without,
		helps,
		fails: options.fails ?? {},
		noEffect: options.noEffect ?? [],
		projectNotFound: options.projectNotFound ?? false,
		agentRefusal: options.agentRefusal ?? false,
		createTwice: options.createTwice ?? false,
		createFailsAfterAdding: options.createFailsAfterAdding ?? false,
		showShape: options.showShape ?? 'messages',
		watchLines: options.watchLines ?? [],
		watchExit: options.watchExit,
		watchStderr: options.watchStderr,
		change: SHOWN_CHANGE,
	};
	fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
	const state: FakeTrailDepthState = { ...defaultDepthState(), ...(options.state ?? {}) };
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
	fs.writeFileSync(path.join(dir, 'calls.log'), '');

	// The script sits in .local/bin/lib/ so that `..`/`..` from it is the fake's directory.
	const lib = path.join(bin, 'lib');
	fs.mkdirSync(lib, { recursive: true });
	const script = path.join(lib, 'fake.js');
	fs.writeFileSync(script, SCRIPT, 'utf8');
	const shim = path.join(bin, 'entire');
	fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 'utf8');
	fs.chmodSync(shim, 0o755);

	const locator = new CliLocator({ homeDir: dir, env: { PATH: '' } });
	const runner = new CliRunner(locator);

	const read = (): (FakeCall & { help: boolean })[] =>
		fs
			.readFileSync(path.join(dir, 'calls.log'), 'utf8')
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => {
				const parsed = JSON.parse(line) as { context?: string; env?: string; args: string[]; help: boolean };
				return { context: parsed.context, env: parsed.env, args: parsed.args, line: parsed.args.join(' '), help: parsed.help };
			});

	const isRead = (call: FakeCall): boolean => /^trail (list|show)\b|^trail (comment|finding) (list|show)\b/.test(call.line);
	const isCheck = (call: FakeCall): boolean => /^trail finding apply\b/.test(call.line) && call.args.includes('--check');

	return {
		runner,
		dir,
		all: () => read(),
		calls: () => read().filter(call => !call.help),
		mutations: () =>
			read().filter(call => !call.help && !isRead(call) && !isCheck(call) && !/^trail watch\b/.test(call.line)),
		watches: () => read().filter(call => !call.help && /^trail watch\b/.test(call.line)),
		state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as FakeTrailDepthState,
		setState: change => {
			const current = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as FakeTrailDepthState;
			change(current);
			fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(current));
		},
		emit: line => {
			fs.appendFileSync(path.join(dir, 'feed.txt'), `${line}\n`);
		},
		signals: () => {
			try {
				return fs.readFileSync(path.join(dir, 'signals.log'), 'utf8').split('\n').filter(line => line.length > 0);
			} catch {
				return [];
			}
		},
		watchRunning: () => {
			try {
				process.kill(Number(fs.readFileSync(path.join(dir, 'watch.pid'), 'utf8')), 0);
				return true;
			} catch {
				return false;
			}
		},
	};
}
