import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import { makeTempDir } from './tempDir';

/**
 * The help of the four doctor subcommands as entire 0.12.2 prints it, trimmed
 * to the flag tables. Read with `agent-help doctor <sub>`; the commands
 * themselves were never run against the real CLI.
 */
export const DOCTOR_HELPS: Record<string, string> = {
	'doctor_logs': `entire doctor logs — Show recent operational logs

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
  -f, --follow     Stream new log lines as they are written
      --tail int   Show the last N lines (use 0 for all) (default 100)

Inherited flags:
      --context name   Act as this saved login name for this command only
`,
	'doctor_trace': `entire doctor trace — Show hook performance traces

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --hook string   Filter by hook type (e.g. post-commit, prepare-commit-msg, pre-push)
      --json          Output as JSON
      --last int      Show last N hook invocations (default 1)
      --slow          Only include traces flagged slow (those logged at WARN)
      --summary       Aggregate across traces instead of showing each one (uses --last 200 unless given)

Inherited flags:
      --context name   Act as this saved login name for this command only
`,
	'doctor_bundle': `entire doctor bundle — Produce a diagnostic bundle (zip) for bug reports

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
  -o, --out string   Path to write the bundle archive (default: OS temp dir)
      --raw          Skip secret redaction. The archive will contain raw log lines, settings, and git output. Use only when support has asked for an unredacted bundle.

Inherited flags:
      --context name   Act as this saved login name for this command only
`,
	'doctor_migrate-checkpoints': `entire doctor migrate-checkpoints — Convert git-branch checkpoints into per-checkpoint git refs

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --dry-run         Report what would be migrated without writing refs
      --remote string   Remote to push migrated refs to (default: the checkpoint sync remote)

Inherited flags:
      --context name   Act as this saved login name for this command only
`,
};

export type BundleMode = 'zip' | 'empty-zip' | 'none' | 'junk' | 'empty-file' | 'junk-fail' | 'zip-then-sleep' | 'link-at-out';

export interface FakeDoctorOptions {
	/** Help texts to replace or add, by `doctor_<sub>`. A null value means the CLI has no such subcommand. */
	helps?: Record<string, string | null>;
	logText?: string;
	traceText?: string;
	dryRunText?: string;
	/** What a bundle run leaves at the path. */
	bundle?: BundleMode;
	/** How many checkpoint refs the real migration creates in the repository. */
	migrateCreates?: number;
	/** Subcommands that exit 1 with this text on stderr: logs, trace, bundle, migrate, dry-run. */
	fail?: Record<string, string>;
	/** Subcommands that sleep for this many seconds before answering. */
	slow?: Record<string, number>;
	/** After a real migration, the repository's git directory is moved away so the refs cannot be counted. */
	breakGit?: boolean;
	/** While the bundle runs, something appears at this path (a file, or a link to a decoy), as if made by another process. */
	plant?: { path: string; kind: 'file' | 'link' };
	/** The help lookup for the doctor subcommands crashes with exit code 2 and no mention of an unknown command. */
	helpCrash?: boolean;
	/** The help lookup sleeps for this many seconds before it answers. */
	slowHelp?: number;
	noCli?: boolean;
}

export interface FakeDoctorCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** A git repository with one commit, where the commands run. */
	readonly repo: string;
	/** Every command the CLI was asked, as `context|arguments`, without the help lookups. */
	calls(): string[];
	callsTo(command: string): string[];
	/** The checkpoint refs in the repository now. */
	refs(): string[];
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@example.invalid', ...args], { cwd, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout;
}

/**
 * A stand-in `entire` for the doctor's log, trace, bundle and migration
 * subcommands. Everything the doctor-depth tests prove is proved against this
 * script: the real CLI's output formats for these four were not observed, and
 * none of them was run.
 */
export function fakeDoctorCli(options: FakeDoctorOptions = {}): FakeDoctorCli {
	const dir = makeTempDir('entire-doctor-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	for (const sub of ['help', 'out', 'fail', 'slow']) {
		fs.mkdirSync(path.join(state, sub), { recursive: true });
	}
	const log = path.join(dir, 'calls.log');
	const repo = path.join(dir, 'repo');
	fs.mkdirSync(repo);
	git(repo, ['init', '--quiet']);
	git(repo, ['commit', '--allow-empty', '--quiet', '-m', 'first']);

	const helps: Record<string, string | null> = { ...DOCTOR_HELPS, ...(options.helps ?? {}) };
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	const outputs: Record<string, string> = {
		logs: options.logText ?? '2026-10-30 10:00:00 INFO hook post-commit ok\n2026-10-30 10:00:01 WARN hook pre-push slow\n',
		trace: options.traceText ?? 'post-commit 1.8s\n  step a 1.2s\n',
		dryrun: options.dryRunText ?? 'Would migrate 2 checkpoints:\n  ab/cd1234\n  ef/gh5678\n',
		bundlemode: options.bundle ?? 'zip',
		creates: String(options.migrateCreates ?? 2),
		plantpath: options.plant?.path ?? '',
		plantkind: options.plant?.kind ?? '',
	};
	for (const [key, text] of Object.entries(outputs)) {
		fs.writeFileSync(path.join(state, 'out', key), text);
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}
	for (const [key, seconds] of Object.entries(options.slow ?? {})) {
		fs.writeFileSync(path.join(state, 'slow', key), String(seconds));
	}

	const script = [
		'#!/bin/sh',
		'CTX=none',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		`S='${state}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2"; exit 0 ;;',
		...(options.helpCrash ? ['\tagent-help) echo "panic: boom" >&2; exit 2 ;;'] : []),
		`\tagent-help) ${options.slowHelp ? `sleep ${options.slowHelp}; ` : ''}shift; k=$(echo "$*" | tr " " "_"); if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; echo "Error: Invalid usage: unknown command" >&2; exit 1 ;;`,
		'esac',
		`echo "$CTX|$*" >> '${log}'`,
		'[ "$1" = doctor ] || { echo "unexpected command" >&2; exit 2; }',
		'sub="$2"',
		'shift 2',
		'dry=no; out=""; prev=""',
		'for a in "$@"; do',
		'\tcase "$a" in --dry-run) dry=yes ;; esac',
		'\tif [ "$prev" = "--out" ]; then out="$a"; fi',
		'\tprev="$a"',
		'done',
		'key="$sub"',
		'if [ "$sub" = migrate-checkpoints ]; then if [ "$dry" = yes ]; then key=dry-run; else key=migrate; fi; fi',
		'if [ -f "$S/slow/$key" ]; then sleep "$(cat "$S/slow/$key")"; fi',
		'if [ -f "$S/fail/$key" ]; then cat "$S/fail/$key" >&2; exit 1; fi',
		'case "$sub" in',
		'\tlogs) cat "$S/out/logs" ;;',
		'\ttrace) cat "$S/out/trace" ;;',
		'\tbundle)',
		'\t\tmode=$(cat "$S/out/bundlemode")',
		'\t\tcase "$mode" in',
		'\t\t\tzip) printf \'PK\\003\\004fake archive\' > "$out"; echo "$out"',
		'\t\t\t\tpp=$(cat "$S/out/plantpath"); if [ -n "$pp" ]; then if [ "$(cat "$S/out/plantkind")" = link ]; then ln -sf "$S/out/plantpath" "$pp"; else echo planted > "$pp"; fi; fi ;;',
		'\t\t\tlink-at-out) rm -f "$out"; ln -s "$S/out/plantpath" "$out"; echo "$out" ;;',
		'\t\t\tjunk-fail) printf \'junk\' > "$out"; echo "boom: could not finish" >&2; exit 1 ;;',
		'\t\t\tzip-then-sleep) printf \'PK\\003\\004fake archive\' > "$out"; sleep 5 ;;',
		'\t\t\tempty-zip) printf \'PK\\005\\006\' > "$out"; echo "$out" ;;',
		'\t\t\tjunk) printf \'not a zip\' > "$out"; echo "$out" ;;',
		'\t\t\tempty-file) : > "$out"; echo "$out" ;;',
		'\t\t\tnone) echo "$out" ;;',
		'\t\tesac ;;',
		'\tmigrate-checkpoints)',
		'\t\tif [ "$dry" = yes ]; then cat "$S/out/dryrun"; exit 0; fi',
		'\t\tn=$(cat "$S/out/creates"); i=1',
		'\t\twhile [ "$i" -le "$n" ]; do git update-ref "refs/entire/checkpoints/ab/fake$i" HEAD; i=$((i+1)); done',
		'\t\techo "Migrated $n checkpoints"',
		...(options.breakGit ? ['\t\tmv .git .git.off'] : []),
		'\t\t;;',
		'esac',
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
	return {
		runner,
		dir,
		repo,
		calls,
		callsTo: command => calls().filter(line => line.slice(line.indexOf('|') + 1).startsWith(command)),
		refs: () => git(repo, ['for-each-ref', '--format=%(refname)', 'refs/entire/checkpoints/']).split('\n').filter(Boolean),
		recorded,
	};
}
