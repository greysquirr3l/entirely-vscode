import * as fs from 'fs';
import * as path from 'path';

import type { AccountContext } from '../../lib/entire';
import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import { makeTempDir } from './tempDir';

/** The flag tables of the real CLI (0.12.2), trimmed to the part the extension reads. */
export const ACTIVITY_HELPS: Record<string, string> = {
	activity: `entire activity — Show your activity overview

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --commits   Show recent commits instead of recent sessions

Inherited flags:
      --context name   Act as this saved login name for this command only
`,
	recap: `entire recap — Summarize recent checkpoint activity

Flags:
      --90                   Rolling 90 days
      --agent string         Agent id to show, or all (default "all")
      --color string         Color output: auto, always, or never (default "auto")
      --day                  Today only (default)
      --insecure-http-auth   Allow plain-HTTP auth (local dev only)
      --month                This calendar month
      --static               Print static output instead of opening the interactive recap
      --view string          Which columns to show: you, team, or both (default "both")
      --week                 Last 7 days
`,
	dispatch: `entire dispatch — Generate a dispatch summarizing recent agent work

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --agent string          local text-generation agent (requires --local)
      --all-branches          include every existing local branch (--local only)
  -j, --jurisdiction string   jurisdiction slug (e.g. us, eu) whose cell generates the cloud dispatch; defaults to your home jurisdiction
      --local                 generate via the locally-installed agent CLI instead of the Entire server
      --repos strings         cloud repo slugs, up to 5, as gh/<owner>/<repo> or et/<project>/<repo>
      --since string          time window (Go duration, relative time, or ISO date) (default "7d")
      --until string          window end time (defaults to now)
      --voice string          voice preset name or literal description
`,
};

/** What the real CLI printed for `entire activity --commits` when piped (0.12.2), shortened. */
export const COMMITS_OUTPUT = `THROUGHPUT          │ ITERATION           │ CONTINUITY          │ STREAK             
0.0k                │ 1.0x                │ 0.1h                │ 1 day              
Avg. tokens/checkp… │ Avg sessions/check… │ Peak session length │ 1 current          

CONTRIBUTIONS  2 checkpoints
    SepOct                                                    
 0                                                           ·
     · 1-2   • 3-5   ● 6-9   ⬤ 10+
● Copilot 50%  ● Unknown 50%

REPOSITORIES
acme/widgets ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒ 2
acme/tools ▓▓▒▒▒▒▒▒ 1

Thursday 29 Oct (today)  2 commits
27930eb docs: d... acme/widgets  Unknown  +27 / -1  1 file  1 checkpoint
fbd0d49 feat(ac... acme/widgets  Copilot  +1598 / -61  13 files  1 checkpoint

Wednesday 28 Oct (yesterday)  1 commit
4432cdf Merge pull reques... acme/tools  +1619 / -26  20 files
`;

/** Static output with a session list. The CLI's real session layout was not seen, so this one is a guess at its shape. */
export const SESSIONS_OUTPUT = `THROUGHPUT          │ STREAK             
1.2k                │ 3 days             

CONTRIBUTIONS  5 checkpoints

REPOSITORIES
acme/widgets ▓▓▓▓ 5

Fix the retry loop  acme/widgets  Copilot
Add backoff to the client  acme/widgets  Codex
`;

export const RECAP_OUTPUT = `[day] · week · month · 90d        agent: [all]        view: you team [both]

╭──────────────────────╮
│  Today               │
│  you   1 session     │
╰──────────────────────╯
`;

export const DISPATCH_OUTPUT = '# Dispatch\n\n- Fixed the retry loop in widgets.\n- Added backoff to the client.\n';

export interface FakeActivityOptions {
	/** Help texts to replace or add, by command. A null value means the CLI has no such command. */
	helps?: Record<string, string | null>;
	activity?: string;
	activityCommits?: string;
	recap?: string;
	dispatch?: string;
	/** Commands that exit 1 with this text on stderr. */
	fail?: Record<string, string>;
	/** The dispatch sleeps for this many seconds before it answers. */
	slowDispatch?: number;
	noCli?: boolean;
}

export interface FakeActivityCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** Every command the CLI was asked, as `context|ACCESSIBLE=value|arguments`, without the help lookups. */
	calls(): string[];
	callsTo(command: string): string[];
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

/** A stand-in `entire` that prints the interactive screen unless it is asked for static output. */
export function fakeActivityCli(options: FakeActivityOptions = {}): FakeActivityCli {
	const dir = makeTempDir('entire-activity-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	fs.mkdirSync(path.join(state, 'help'), { recursive: true });
	fs.mkdirSync(path.join(state, 'out'), { recursive: true });
	fs.mkdirSync(path.join(state, 'fail'), { recursive: true });
	const log = path.join(dir, 'calls.log');

	const helps: Record<string, string | null> = { ...ACTIVITY_HELPS, ...(options.helps ?? {}) };
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	const outputs: Record<string, string> = {
		activity: options.activity ?? SESSIONS_OUTPUT,
		'activity.commits': options.activityCommits ?? COMMITS_OUTPUT,
		recap: options.recap ?? RECAP_OUTPUT,
		dispatch: options.dispatch ?? DISPATCH_OUTPUT,
	};
	for (const [key, text] of Object.entries(outputs)) {
		fs.writeFileSync(path.join(state, 'out', key), text);
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}

	const script = [
		'#!/bin/sh',
		'CTX=none',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		`S='${state}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2"; exit 0 ;;',
		'\tagent-help) shift; k=$(echo "$*" | tr " " "_"); if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; echo "unknown command" >&2; exit 1 ;;',
		'esac',
		`echo "$CTX|ACCESSIBLE=$ACCESSIBLE|$*" >> '${log}'`,
		'cmd="$1"',
		'if [ -f "$S/fail/$cmd" ]; then cat "$S/fail/$cmd" >&2; exit 1; fi',
		'key="$cmd"',
		'case "$*" in *--commits*) key="$cmd.commits" ;; esac',
		'case "$cmd" in',
		// The interactive screens: the real ones need a terminal and are not reproducible here.
		'\tactivity) if [ "$ACCESSIBLE" != "1" ]; then echo "INTERACTIVE SCREEN"; exit 1; fi ;;',
		'\trecap) case "$*" in *--static*) ;; *) echo "INTERACTIVE SCREEN"; exit 1 ;; esac ;;',
		'esac',
		options.slowDispatch ? `if [ "$cmd" = dispatch ]; then sleep ${options.slowDispatch}; fi` : ':',
		'cat "$S/out/$key"',
	].join('\n');

	if (!options.noCli) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });
	const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
	return { runner, dir, calls, callsTo: command => calls().filter(line => line.split('|')[2]?.startsWith(command)), recorded };
}

export const ALICE: AccountContext = {
	name: 'alice@us.auth.entire.io',
	handle: 'alice',
	server: 'https://us.auth.entire.io',
	active: true,
};
