import * as fs from 'fs';
import * as path from 'path';

import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import { makeTempDir } from './tempDir';

/**
 * The help of the four commands as entire 0.12.2 prints it, trimmed to the
 * parts the extension reads. Read with `agent-help <cmd>` (and
 * `runner setup --help`, which is not in `agent-help`). None of the four
 * commands was ever run against the real CLI: everything the capture-control
 * tests prove is proved against the fake below.
 */
export const DISABLE_HELP = `entire disable — Disable Entire in current repository
Disable Entire integrations in the current repository.

By default, this command will disable Entire. Hooks will exit silently and commands will
show a disabled message.

To completely remove Entire integrations from this repository, use --uninstall:
  - .entire/ directory (settings, logs, metadata)
  - Git hooks (prepare-commit-msg, commit-msg, post-commit, post-rewrite, pre-push),
    restoring any hooks Entire backed up
  - Session state files (.git/entire-sessions/)
  - Shadow branches older versions left behind (entire/<commit>-<worktree>);
    bare entire/<commit> branches are listed and kept, since a branch of
    yours named after a short SHA looks the same (entire clean --all)
  - Agent hooks

An external agent's hooks live inside its plugin, so removing them means asking the
plugin to do it. Any removal step that fails makes the uninstall exit non-zero and report that Entire
was not fully uninstalled.

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --force       Skip confirmation prompt (use with --uninstall)
      --local       Update .entire/settings.local.json (the default) instead of .entire/settings.json
      --project     Update .entire/settings.json instead of .entire/settings.local.json
      --uninstall   Completely remove Entire from this repository

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

export const CONFIGURE_HELP = `entire configure — Update Entire settings in the current repository
Update non-agent Entire settings in the current repository.

Manages telemetry, git-hook installation mode, strategy options, and summary
provider configuration. Agent installation is handled by 'entire agent'.

Examples:
  entire configure                                # Show this help
  entire configure --telemetry=false              # Opt out of telemetry

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --absolute-git-hook-path          Embed full binary path in git hooks (for GUI git clients that don't source shell profiles)
      --checkpoint-backend string       Checkpoint storage backend: refs (default; one git ref per checkpoint) or branch (legacy shared entire/checkpoints/v1 branch)
      --checkpoint-remote string        Checkpoint remote in provider:owner/repo format; providers: github, gitlab (e.g., github:org/checkpoints-repo)
  -f, --force                           Reinstall the Entire git hook
      --local                           Write settings to .entire/settings.local.json instead of .entire/settings.json
      --project                         Write settings to .entire/settings.json even if it already exists
      --skip-push-sessions              Disable automatic pushing of session logs on git push
      --summarize-model string          Set the model hint used by explain --generate
      --summarize-provider string       Set the provider used by explain --generate
      --summarize-timeout-seconds int   Set the hard deadline (seconds) for explain --generate summary generation. 0 clears the setting, leaving summary generation unbounded.
      --telemetry                       Enable anonymous usage analytics (default true)

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

export const CLEAN_HELP = `entire clean — Clean up Entire session data
Clean up Entire session data for the current HEAD commit.

By default, cleans session state for the current HEAD:
  - Session state files (.git/entire-sessions/<session-id>.json)
  - Legacy shadow branches older CLI versions left behind
    (entire/<commit-hash>-<worktree-hash>)

Use --all to clean all Entire session data across the repository:
  - All session state files (.git/entire-sessions/)
  - All legacy shadow branches, including the old entire/<commit-hash> form
  - Temporary files (.entire/tmp/)

Use --session <id> to clean a specific session only.

Without --force, prompts for confirmation before deleting.
Use --dry-run to preview what would be deleted without prompting.

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
  -a, --all              Clean all session data across the repository
  -d, --dry-run          Preview what would be deleted without deleting
  -f, --force            Skip confirmation prompt and override active session guard
      --session string   Clean a specific session by ID

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

export const RUNNER_SETUP_HELP = `Set up the .entire/runners/*.json evaluators for this repository.

Runners (risk, confidence, drift, security, review, …) score and review a
branch's changes. The shipped defaults are generic; setup can tailor them to
THIS repo using gathered signal — its docs and structure, merged PRs and
issues, checkpoint churn hotspots, and past trail findings.

In a terminal with no flags, setup asks whether you want the generic defaults
or defaults tailored to this repo. Otherwise name the action up front:

  -y, --yes           create the defaults if missing, then tailor them in place
      --defaults-only create the generic defaults and stop
      --print-prompt  create the defaults if missing, then print the tailoring prompt for your own agent to run
      --dry-run       show the tailoring as a diff and write nothing

--yes and --dry-run each call your configured summary provider once.

Usage:
  entire runner setup [<runner>] [flags]

Flags:
      --agent string       Text-generation agent to tailor with for this run (e.g. codex); skips the provider choice and saves nothing. Only for runs that tailor: --yes, --dry-run, or choosing to tailor at the prompt
      --debug-dir string   Write the assembled prompt (prompt.txt) and, when a provider runs, its raw response (response.txt) to this directory for debugging
      --defaults-only      Create the generic default runners and stop (no tailoring, no provider call)
      --dry-run            Show the tailoring as a diff and write nothing
  -h, --help               help for setup
      --limit int          How many recent PRs/issues/trails to sample (default 20)
      --print-prompt       Create the default runners if missing, then print the tailoring prompt for your own agent instead of running a provider
      --sources strings    Comma-separated data sources to gather: repo, prs, checkpoints, trails, all (default: all)
  -y, --yes                Create the default runners if missing and tailor them to this repo; add --agent to skip the provider choice too

Global Flags:
      --context name   Act as this saved login name for this command only
`;

/**
 * Reads a file the fake keeps, through one handle that refuses links and
 * is checked as a regular file. Absent or unreadable gives undefined.
 */
function readFileOnce(file: string): string | undefined {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		return fs.fstatSync(fd).isFile() ? fs.readFileSync(fd, 'utf8') : undefined;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) {
			fs.closeSync(fd);
		}
	}
}

export interface FakeSession {
	readonly id: string;
	readonly agent?: string;
	readonly status?: string;
	readonly branch?: string;
	/** `head` sessions are removed by a default clean; `other` ones only by a clean of everything or of the session itself. */
	readonly scope?: 'head' | 'other';
}

export interface FakeCaptureOptions {
	/** Help texts to replace or add, by `disable`, `configure`, `clean` and `runner_setup`. A null value means the CLI has none. */
	helps?: Record<string, string | null>;
	sessions?: FakeSession[];
	/** Whether Entire is enabled at the start. Default true. */
	enabled?: boolean;
	/** The folder is not a git repository: status says so. */
	notARepository?: boolean;
	/** Commands that exit 1 with this text on stderr: disable, uninstall, configure, clean, preview, runner. */
	fail?: Record<string, string>;
	/** A disable that exits 0 but leaves Entire enabled. */
	disableNoEffect?: boolean;
	/** An uninstall that exits 1, says it was not fully uninstalled and leaves `.entire` behind. */
	uninstallPartial?: boolean;
	/** A configure that exits 0 and writes nothing. */
	configureIgnores?: boolean;
	/** What `clean --dry-run` prints. */
	preview?: string;
	/** A clean that exits 0 and removes nothing. */
	cleanNoEffect?: boolean;
	/** A preview of a tailoring that writes to the runner files anyway. */
	dryRunWrites?: boolean;
	/** The agents `agent list` prints; a name starting with `+` is installed. */
	agents?: string[];
	/** A command that sleeps this many seconds before it answers: disable, runner. */
	slow?: Record<string, number>;
	/** Files to create in the repository before anything runs, relative to it. */
	files?: Record<string, string>;
	noCli?: boolean;
}

export interface FakeCaptureCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** The folder the commands run in. */
	readonly repo: string;
	/** Every command that was run, as `context|ENTIRE_CONTEXT|arguments`, previews included, without help lookups and status reads. */
	calls(): string[];
	/** The calls that change something: disable, configure, runner setup and a clean that is not a preview. */
	mutating(): string[];
	/** The preview calls of clean. */
	previews(): string[];
	/** How many times a summary provider was called. */
	providerCalls(): number;
	/** The sessions the fake lists now. */
	sessionIds(): string[];
	enabled(): boolean;
	exists(relative: string): boolean;
	read(relative: string): string | undefined;
	write(relative: string, text: string): void;
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

/**
 * A stand-in `entire` for disable, uninstall, configure, clean and runner
 * setup. It keeps its state in files: whether Entire is enabled, the
 * sessions (removed by a clean), the settings files (written by configure)
 * and the runner files. It records every call with the login it was given.
 */
export function fakeCaptureCli(options: FakeCaptureOptions = {}): FakeCaptureCli {
	const dir = makeTempDir('entire-capture-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	for (const sub of ['help', 'out', 'fail', 'slow']) {
		fs.mkdirSync(path.join(state, sub), { recursive: true });
	}
	const log = path.join(dir, 'calls.log');
	const repo = path.join(dir, 'repo');
	fs.mkdirSync(path.join(repo, '.entire'), { recursive: true });

	const helps: Record<string, string | null> = {
		disable: DISABLE_HELP,
		configure: CONFIGURE_HELP,
		clean: CLEAN_HELP,
		runner_setup: RUNNER_SETUP_HELP,
		...(options.helps ?? {}),
	};
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}
	for (const [key, seconds] of Object.entries(options.slow ?? {})) {
		fs.writeFileSync(path.join(state, 'slow', key), String(seconds));
	}
	const sessions = options.sessions ?? [];
	fs.writeFileSync(
		path.join(state, 'sessions'),
		sessions.map(s => `${s.id}|${s.agent ?? 'copilot-cli'}|${s.status ?? 'ended'}|${s.branch ?? 'main'}|${s.scope ?? 'head'}`).join('\n') + (sessions.length > 0 ? '\n' : ''),
	);
	fs.writeFileSync(path.join(state, 'enabled'), options.enabled === false || options.notARepository ? 'no' : 'yes');
	if (options.notARepository) {
		fs.writeFileSync(path.join(state, 'norepo'), 'yes');
	}
	fs.writeFileSync(path.join(state, 'preview'), options.preview ?? 'Would delete:\n  session state files: 2\n  shadow branches: 1\n');
	fs.writeFileSync(path.join(state, 'agents'), (options.agents ?? ['+copilot-cli', 'codex', 'cursor']).join('\n') + '\n');
	fs.writeFileSync(path.join(state, 'providers'), '');
	for (const [name, text] of Object.entries(options.files ?? {})) {
		const file = path.join(repo, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}

	const modes = [
		options.disableNoEffect ? 'disable-noeffect' : '',
		options.uninstallPartial ? 'uninstall-partial' : '',
		options.configureIgnores ? 'configure-ignores' : '',
		options.cleanNoEffect ? 'clean-noeffect' : '',
		options.dryRunWrites ? 'dryrun-writes' : '',
	].join(' ');

	const script = [
		'#!/bin/sh',
		'CTX=none',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		`S='${state}'`,
		`MODES='${modes}'`,
		'mode() { case " $MODES " in *" $1 "*) return 0 ;; esac; return 1; }',
		'unknown() { echo "Error: Invalid usage: unknown command \\"$1\\"; run `entire agent-help` for the list of commands" >&2; exit 1; }',
		// Help lookups: `agent-help disable`, `runner setup --help`, `disable --help`.
		'if [ "$1" = agent-help ]; then shift; k=$(echo "$*" | tr " " "_"); if [ -f "$S/help/$k" ] && [ "$1" != runner ]; then cat "$S/help/$k"; exit 0; fi; unknown "$1"; fi',
		'case "$*" in *--help) k=$(echo "$*" | sed "s/ *--help$//" | tr " " "_"); if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; unknown "$1" ;; esac',
		'case "$1" in',
		'\tversion) echo "entire 0.12.2"; exit 0 ;;',
		'\tstatus)',
		'\t\t[ -f "$S/fail/status" ] && { echo "Error: cannot read state" >&2; exit 1; }',
		'\t\tif [ "$(cat "$S/enabled")" = yes ]; then',
		'\t\t\tact=""; while IFS="|" read -r id agent status branch scope; do [ -z "$id" ] && continue; if [ "$status" = active ]; then [ -n "$act" ] && act="$act,"; act="$act{\\"agent\\":\\"$agent\\",\\"session_id\\":\\"$id\\",\\"worktree_path\\":\\"$PWD\\",\\"status\\":\\"active\\",\\"branch\\":\\"$branch\\"}"; fi; done < "$S/sessions"',
		'\t\t\techo "{\\"enabled\\":true,\\"agents\\":[\\"copilot-cli\\"],\\"active_sessions\\":[$act]}"',
		'\t\telif [ -f "$S/norepo" ]; then echo "{\\"enabled\\":false,\\"agents\\":null,\\"active_sessions\\":null,\\"error\\":\\"not a git repository\\"}"',
		'\t\telse echo "{\\"enabled\\":false,\\"agents\\":null,\\"active_sessions\\":null,\\"error\\":\\"Entire is not enabled\\"}"; fi; exit 0 ;;',
		'\tsession)',
		'\t\t[ -f "$S/fail/status" ] && { echo "Error: cannot read state" >&2; exit 1; }',
		'\t\tout=""; while IFS="|" read -r id agent status branch scope; do [ -z "$id" ] && continue; [ -n "$out" ] && out="$out,"; out="$out{\\"session_id\\":\\"$id\\",\\"agent\\":\\"$agent\\",\\"status\\":\\"$status\\",\\"branch\\":\\"$branch\\",\\"worktree_path\\":\\"$PWD\\"}"; done < "$S/sessions"',
		'\t\techo "[$out]"; exit 0 ;;',
		'\tagent)',
		'\t\techo "Agents:"; while read -r a; do case "$a" in +*) echo "  ✓ ${a#+}" ;; *) echo "    $a" ;; esac; done < "$S/agents"; exit 0 ;;',
		'esac',
		`echo "$CTX|$ENTIRE_CONTEXT|$*" >> '${path.join(dir, 'all.log')}'`,
		// The mutating commands and the preview are recorded separately.
		`LOG='${log}'`,
		'case "$1" in',
		'\tdisable)',
		'\t\tuninstall=no; force=no; for a in "$@"; do case "$a" in --uninstall) uninstall=yes ;; --force) force=yes ;; esac; done',
		'\t\techo "$CTX|$ENTIRE_CONTEXT|$*" >> "$LOG"',
		'\t\tif [ -f "$S/slow/disable" ]; then sleep "$(cat "$S/slow/disable")"; fi',
		'\t\tif [ "$uninstall" = yes ]; then',
		'\t\t\t[ "$force" = yes ] || { echo "Error: confirmation needs a terminal" >&2; exit 1; }',
		'\t\t\tif [ -f "$S/fail/uninstall" ]; then cat "$S/fail/uninstall" >&2; exit 1; fi',
		'\t\t\tif mode uninstall-partial; then echo "Entire was not fully uninstalled: could not remove the agent hooks" >&2; echo no > "$S/enabled"; exit 1; fi',
		'\t\t\techo no > "$S/enabled"; rm -rf "$PWD/.entire"; echo "Entire removed."; exit 0',
		'\t\tfi',
		'\t\tif [ -f "$S/fail/disable" ]; then cat "$S/fail/disable" >&2; exit 1; fi',
		'\t\tif mode disable-noeffect; then echo "Entire disabled."; exit 0; fi',
		'\t\techo no > "$S/enabled"; echo "Entire disabled."; exit 0 ;;',
		'\tconfigure)',
		'\t\techo "$CTX|$ENTIRE_CONTEXT|$*" >> "$LOG"',
		'\t\tif [ -f "$S/fail/configure" ]; then cat "$S/fail/configure" >&2; exit 1; fi',
		'\t\ttarget="$PWD/.entire/settings.json"; parts=""; prev=""',
		'\t\tadd() { [ -n "$parts" ] && parts="$parts,"; parts="$parts$1"; }',
		'\t\tfor a in "$@"; do',
		'\t\t\tcase "$prev" in',
		'\t\t\t\t--checkpoint-remote) add "\\"strategy_options\\":{\\"checkpoint_remote\\":{\\"provider\\":\\"${a%%:*}\\",\\"repo\\":\\"${a#*:}\\"}}" ;;',
		'\t\t\t\t--summarize-model) add "\\"summarize_model\\":\\"$a\\"" ;;',
		'\t\t\tesac',
		'\t\t\tcase "$a" in',
		'\t\t\t\t--local) target="$PWD/.entire/settings.local.json" ;;',
		'\t\t\t\t--project) target="$PWD/.entire/settings.json" ;;',
		'\t\t\t\t--telemetry=*) add "\\"telemetry\\":${a#*=}" ;;',
		'\t\t\t\t--absolute-git-hook-path=*) add "\\"absolute_git_hook_path\\":${a#*=}" ;;',
		'\t\t\t\t--checkpoint-backend=*) add "\\"checkpoints\\":{\\"primary\\":{\\"type\\":\\"${a#*=}\\"}}" ;;',
		'\t\t\t\t--skip-push-sessions=*) add "\\"skip_push_sessions\\":${a#*=}" ;;',
		'\t\t\t\t--summarize-provider=*) add "\\"summarize_provider\\":\\"${a#*=}\\"" ;;',
		'\t\t\t\t--summarize-timeout-seconds=*) add "\\"summarize_timeout_seconds\\":${a#*=}" ;;',
		'\t\t\tesac',
		'\t\t\tprev="$a"',
		'\t\tdone',
		'\t\tif mode configure-ignores; then echo "Settings updated."; exit 0; fi',
		'\t\tmkdir -p "$PWD/.entire"; echo "{$parts}" > "$target"; echo "Settings updated."; exit 0 ;;',
		'\tclean)',
		'\t\tdry=no; force=no; all=no; one=""',
		'\t\tfor a in "$@"; do case "$a" in --dry-run) dry=yes ;; --force) force=yes ;; --all) all=yes ;; --session=*) one="${a#*=}" ;; esac; done',
		'\t\tif [ "$dry" = yes ]; then echo "$CTX|$ENTIRE_CONTEXT|$*" >> "$S/../previews.log"; if [ -f "$S/fail/preview" ]; then cat "$S/fail/preview" >&2; exit 1; fi; cat "$S/preview"; exit 0; fi',
		'\t\techo "$CTX|$ENTIRE_CONTEXT|$*" >> "$LOG"',
		'\t\t[ "$force" = yes ] || { echo "Error: confirmation needs a terminal" >&2; exit 1; }',
		'\t\tif [ -f "$S/fail/clean" ]; then cat "$S/fail/clean" >&2; exit 1; fi',
		'\t\tif mode clean-noeffect; then echo "Cleaned."; exit 0; fi',
		'\t\t: > "$S/sessions.new"',
		'\t\twhile IFS="|" read -r id agent status branch scope; do [ -z "$id" ] && continue',
		'\t\t\tkeep=yes',
		'\t\t\tif [ -n "$one" ]; then [ "$id" = "$one" ] && keep=no; elif [ "$all" = yes ]; then keep=no; else [ "$scope" = head ] && keep=no; fi',
		'\t\t\t[ "$keep" = yes ] && echo "$id|$agent|$status|$branch|$scope" >> "$S/sessions.new"',
		'\t\tdone < "$S/sessions"',
		'\t\tmv "$S/sessions.new" "$S/sessions"; echo "Cleaned."; exit 0 ;;',
		'\trunner)',
		'\t\techo "$CTX|$ENTIRE_CONTEXT|$*" >> "$LOG"',
		'\t\tif [ -f "$S/slow/runner" ]; then sleep "$(cat "$S/slow/runner")"; fi',
		'\t\tR="$PWD/.entire/runners"; mode_flag=""',
		'\t\tfor a in "$@"; do case "$a" in --defaults-only|--print-prompt|--dry-run|--yes) mode_flag="$a" ;; esac; done',
		'\t\tdefaults() { mkdir -p "$R"; for n in risk review; do [ -f "$R/$n.json" ] || echo "{\\"name\\":\\"$n\\"}" > "$R/$n.json"; done; }',
		'\t\tcase "$mode_flag" in',
		'\t\t\t--defaults-only) defaults; echo "Created default runners."; exit 0 ;;',
		'\t\t\t--print-prompt) defaults; echo "TAILORING PROMPT: tailor the runners to this repo"; exit 0 ;;',
		'\t\t\t--dry-run) echo provider >> "$S/providers"; if [ -f "$S/fail/runner" ]; then cat "$S/fail/runner" >&2; exit 1; fi; if mode dryrun-writes; then defaults; echo tailored >> "$R/risk.json"; fi; echo "--- risk.json"; echo "+++ risk.json (tailored)"; exit 0 ;;',
		'\t\t\t--yes) echo provider >> "$S/providers"; if [ -f "$S/fail/runner" ]; then cat "$S/fail/runner" >&2; exit 1; fi; defaults; for f in "$R"/*.json; do echo " tailored" >> "$f"; done; echo "Tailored."; exit 0 ;;',
		'\t\tesac',
		'\t\techo "Error: choose an action" >&2; exit 1 ;;',
		'esac',
		'echo "unexpected command" >&2; exit 2',
	].join('\n');

	if (!options.noCli) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });
	const lines = (file: string): string[] => (readFileOnce(file) ?? '').split('\n').filter(Boolean);
	return {
		runner,
		dir,
		repo,
		calls: () => lines(path.join(dir, 'all.log')),
		mutating: () => lines(log),
		previews: () => lines(path.join(dir, 'previews.log')),
		providerCalls: () => lines(path.join(state, 'providers')).length,
		sessionIds: () => lines(path.join(state, 'sessions')).map(line => line.split('|')[0]),
		enabled: () => (readFileOnce(path.join(state, 'enabled')) ?? '').trim() === 'yes',
		exists: relative => fs.existsSync(path.join(repo, relative)),
		read: relative => readFileOnce(path.join(repo, relative)),
		write: (relative, text) => {
			const file = path.join(repo, relative);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		},
		recorded,
	};
}
