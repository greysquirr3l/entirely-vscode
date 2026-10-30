import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';

/**
 * A fake Entire CLI that answers the trail commands.
 *
 * The extension never re-implements Entire: it reads what the CLI
 * prints. The tests therefore need a CLI that prints something, and
 * this is it — one that answers the commands the extension makes and
 * records what it was asked.
 *
 * The payloads are written to files rather than carried in the script,
 * so that no JSON has to survive a shell's quoting.
 */
export interface TrailCliAnswers {
	/** What `repo view` prints. */
	readonly repo?: string;
	/** What `trail list` prints. */
	readonly list?: string;
	/** What `trail approvals` prints. */
	readonly approvals?: string;
	/** What `trail comment list` prints. */
	readonly comments?: string;
	/** What `trail finding list` prints. */
	readonly findings?: string;
	/** What `trail merge --dry-run --json` prints. */
	readonly merge?: string;
	/** What a real (not dry-run) `trail merge --json` prints. */
	readonly mergeRun?: string;
	/** Makes a real `trail merge` exit non-zero after printing its payload. */
	readonly mergeRunFails?: boolean;
	/** What `trail comment add` writes to stderr, refusing the comment. */
	readonly commentFails?: string;
	/** What `trail show --json` prints. */
	readonly show?: string;
	/** What `trail show` writes to stderr before it exits non-zero. */
	readonly showFails?: string;
	/** Makes `agent-help trail show` fail, as a CLI without the command does. */
	readonly withoutShowHelp?: boolean;
}

/**
 * The usage each trail command prints.
 *
 * The commands do not agree on how they take the trail they are about:
 * some take it as a positional argument and some as a `--trail` flag.
 * The usage here is the CLI's own, so that the extension reads the
 * form from the CLI rather than from a table in the test.
 */
const USAGE: Readonly<Record<string, string>> = {
	'trail show': 'entire trail show — Show trail intent and its repositories and branches\n',
	'trail approve': 'entire trail approve — Approve a trail\n',
	'trail approvals': 'entire trail approvals — Show a trail\'s approvals\n',
	'trail comment add': [
		'entire trail comment add — Start a discussion on the trail\n',
		'Flags:\n',
		'      --trail string     Project trail number, ID, or <repo>/<number>\n',
		'Global Flags:\n',
	].join(''),
	'trail comment list': [
		'entire trail comment list — List a trail\'s discussions\n',
		'Flags:\n',
		'      --trail string     Project trail number, ID, or <repo>/<number>\n',
		'Global Flags:\n',
	].join(''),
	'trail finding add': [
		'entire trail finding add — Record a finding on the trail\n',
		'Flags:\n',
		'      --trail string     Project trail number, ID, or <repo>/<number>\n',
		'Global Flags:\n',
	].join(''),
	'trail finding list': [
		'entire trail finding list — List the trail\'s findings\n',
		'Flags:\n',
		'      --trail string     Project trail number, ID, or <repo>/<number>\n',
		'Global Flags:\n',
	].join(''),
	'trail merge': 'entire trail merge — Merge one of a trail\'s changes into its base\n',
	'trail checkout': [
		'entire trail checkout — Check out a trail\'s branch\n',
		'Flags:\n',
		'      --trail string     Project trail number, ID, or <repo>/<number>\n',
		'Global Flags:\n',
	].join(''),
	'trail link': 'entire trail link — Link a repository branch to a trail\n',
	'trail unlink': 'entire trail unlink — Remove a branch from a trail\n',
};


/**
 * The trail the fake CLI knows about.
 *
 * One trail with one change on it, which is enough for a reviewer to
 * be offered something to act on.
 */
export const TRAIL_LIST = {
	items: [
		{
			id: '01M62YAQVTG0WN2J6G7149VCK9',
			number: 40,
			title: 'Shape the thing',
			status: 'open',
			changes: [
				{
					id: '01M62YB0HTSHFQ0WE38EHPFX1',
					repository: 'entirely-vscode',
					branch: 'shape-probe',
					number: 17,
					title: 'Shape the thing',
					status: 'open',
				},
			],
		},
	],
	nextPageToken: undefined,
};

/** What `trail show --json` prints for the trail above: the trail, its project and its changes. */
export const TRAIL_SHOW = {
	...TRAIL_LIST.items[0],
	body: 'The full description of the trail, which only the document may carry.',
	type: 'feature',
	priority: 'high',
	url: 'https://entire.example/trails/40',
	project: {
		id: '01PROJECT',
		name: 'greysquirr3l',
		provider: 'github',
		reference: { forge: 'gh', project: 'greysquirr3l' },
	},
};

/**
 * The merge plan the CLI's dry run reports.
 *
 * It names the branch, the base it would go to and the commit at its
 * head, which is what the confirmation has to say.
 */
export const MERGE_PLAN = {
	number: 17,
	change: 'entirely-vscode/17',
	trail: 40,
	project: 'gh/greysquirr3l',
	branch: 'shape-probe',
	base: 'main',
	headSha: '0e8af92c31970d63fa67d85c9ed90e6f58f4ed3d',
	mergeable: true,
	conflictStatus: 'clean',
	bypassPolicy: 'nobody',
	blockers: [],
	reasons: [],
	merged: false,
	bypassed: false,
	wouldBypass: false,
	dryRun: true,
};

/** The name a command's usage is stored under. */
function usageName(command: string): string {
	return command.replace(/\s+/g, '-');
}

/** A fake CLI, and the log of what it was asked. */
export interface FakeTrailCli {
	readonly runner: CliRunner;
	/** The file every invocation is appended to. */
	readonly log: string;
}

/**
 * Builds a fake CLI that answers the trail commands.
 */
export function fakeTrailCli(answers: TrailCliAnswers = {}): FakeTrailCli {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-trail-cli-'));
	const bin = path.join(home, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });

	const payloads = path.join(home, 'payloads');
	fs.mkdirSync(payloads, { recursive: true });

	const write = (name: string, text: string): void => {
		fs.writeFileSync(path.join(payloads, name), text, 'utf8');
	};

	write('repo', answers.repo ?? '{"repo":"/gh/greysquirr3l/entirely-vscode"}');
	write('list', answers.list ?? JSON.stringify(TRAIL_LIST));
	write('approvals', answers.approvals ?? '{"approvals":[]}');
	write('comments', answers.comments ?? '{"items":[]}');
	write('findings', answers.findings ?? '{"findings":[]}');
	write('show', answers.show ?? JSON.stringify(TRAIL_SHOW));
	write('merge', answers.merge ?? JSON.stringify(MERGE_PLAN));
	write(
		'merge-run',
		answers.mergeRun ?? JSON.stringify({ ...MERGE_PLAN, merged: true, dryRun: false }),
	);

	if (answers.mergeRunFails) {
		write('merge-run-fails', '');
	}

	if (answers.commentFails !== undefined) {
		write('comment-fails', answers.commentFails);
	}

	if (answers.showFails !== undefined) {
		write('show-fails', answers.showFails);
	}

	for (const [command, text] of Object.entries(USAGE)) {
		if (command === 'trail show' && answers.withoutShowHelp) {
			continue;
		}
		write(usageName(command), text);
	}

	const log = path.join(home, 'invocations.log');

	const body = [
		`PAYLOADS=${JSON.stringify(payloads)}`,
		`LOG=${JSON.stringify(log)}`,
		'echo "$*" >> "$LOG"',
		'case "$1" in',
		'\tversion) echo "entire 0.12.2" ;;',
		'\tagent-help) cat "$PAYLOADS/$(echo "$2 $3 $4" | sed \'s/ *$//\' | tr \' \' \'-\')" ;;',
		'\trepo) cat "$PAYLOADS/repo" ;;',
		'\ttrail)',
		'\t\tcase "$2" in',
		'\t\t\tlist) cat "$PAYLOADS/list" ;;',
		'\t\t\tshow)',
		'\t\t\t\tif [ -f "$PAYLOADS/show-fails" ]; then',
		'\t\t\t\t\tcat "$PAYLOADS/show-fails" >&2; exit 1',
		'\t\t\t\tfi',
		'\t\t\t\tcat "$PAYLOADS/show" ;;',
		'\t\t\tapprove) echo "approved" ;;',
		'\t\t\tapprovals) cat "$PAYLOADS/approvals" ;;',
		'\t\t\tcomment)',
		'\t\t\t\tcase "$3" in',
		'\t\t\t\t\tadd)',
		'\t\t\t\t\t\tif [ -f "$PAYLOADS/comment-fails" ]; then',
		'\t\t\t\t\t\t\tcat "$PAYLOADS/comment-fails" >&2; exit 1',
		'\t\t\t\t\t\tfi',
		'\t\t\t\t\t\techo "commented" ;;',
		'\t\t\t\t\tlist) cat "$PAYLOADS/comments" ;;',
		'\t\t\t\tesac',
		'\t\t\t\t;;',
		'\t\t\tfinding)',
		'\t\t\t\tcase "$3" in',
		'\t\t\t\t\tadd) echo "found" ;;',
		'\t\t\t\t\tlist) cat "$PAYLOADS/findings" ;;',
		'\t\t\t\tesac',
		'\t\t\t\t;;',
		'\t\t\tmerge)',
		'\t\t\t\tcase " $* " in',
		'\t\t\t\t\t*" --dry-run "*) cat "$PAYLOADS/merge" ;;',
		'\t\t\t\t\t*)',
		'\t\t\t\t\t\tcat "$PAYLOADS/merge-run"',
		'\t\t\t\t\t\tif [ -f "$PAYLOADS/merge-run-fails" ]; then echo "merge refused" >&2; exit 1; fi ;;',
		'\t\t\t\tesac',
		'\t\t\t\t;;',
		'\t\t\tcheckout) echo "checked out" ;;',
		'\t\t\tlink) echo "linked" ;;',
		'\t\t\tunlink) echo "unlinked" ;;',
		'\t\t\t*) echo "unknown subcommand" >&2; exit 2 ;;',
		'\t\tesac',
		'\t\t;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');

	const file = path.join(bin, 'entire');
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
	fs.chmodSync(file, 0o755);

	const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
	return { runner: new CliRunner(locator), log };
}

/**
 * What the CLI was asked to do, one command per line.
 *
 * The line is the command line as the CLI saw it, so a test can say
 * that the merge did not run before the reviewer confirmed.
 */
export function invocations(log: string): string[] {
	if (!fs.existsSync(log)) {
		return [];
	}

	return fs
		.readFileSync(log, 'utf8')
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);
}
