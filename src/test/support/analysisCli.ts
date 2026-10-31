import * as fs from 'fs';
import * as path from 'path';

import type { AccountContext } from '../../lib/entire';
import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import {
	EXPERTS_HELP,
	REVIEW_CONFIG_JSON,
	REVIEW_HELP,
	ROOT_USAGE,
	TOKENS_PROFILE_HELP,
	TOKEN_PROFILE_JSON,
} from './analysisFixtures';
import { makeTempDir } from './tempDir';

/** A configured profile list. INVENTED: the real CLI's layout for a configured profile was not observed. The names are opaque on purpose, and one looks like a model. */
export const REVIEW_LIST_CONFIGURED = `general
  reviewers: alpha, beta
  judge: gamma
gpt-9-turbo-deep
  reviewers: alpha
  judge: alpha
`;

export const REVIEW_LIST_EMPTY = 'No review profiles configured. Create one with `entire review --configure`.\n';

/** Saved findings. INVENTED: the real CLI's listing was observed only when empty. */
export const REVIEW_FINDINGS_TEXT = 'run-7  general  2 findings\nrun-6  general  0 findings\n';

/** An experts answer. INVENTED: the real shape was never observed (the command sends the query to Entire's servers). */
export const EXPERTS_JSON = JSON.stringify({
	profiles: [
		{ name: 'agent-one', kind: 'agent', score: 12, last_seen: '2026-10-01', checkpoints: ['01HXA000000000000000000001'] },
		{ name: 'skill-two', kind: 'skill', score: 4 },
	],
});

export const REPO_VIEW_JSON = JSON.stringify({ repo: 'gh/acme/widgets', visibility: 'private' });

export interface FakeAnalysisOptions {
	/** Help texts to replace, keyed `tokens_profile`, `experts` or `review`. A null value means the CLI has no such command. */
	helps?: Record<string, string | null>;
	/** What each mode prints. Keys: `tokens_profile`, `experts`, `review.list`, `review.config`, `review.findings`, `repo_view`. */
	outputs?: Record<string, string>;
	/** Modes that exit 1 with this text on stderr. */
	fail?: Record<string, string>;
	/** Modes that wait 30 seconds before answering, as a browser waiting for a terminal does. */
	hang?: string[];
	noCli?: boolean;
}

export interface FakeAnalysisCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** Every command that was run, as `context|ACCESSIBLE=value|arguments`, without the help lookups. */
	calls(): string[];
	/** The same commands, each as its list of arguments. */
	argvs(): string[][];
	/** The calls whose mode is the given key, for example `review.run`. */
	modes(key: string): string[][];
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

/**
 * A stand-in `entire` for the token profile, experts and review commands.
 *
 * `agent-help` does not know these commands (as the real CLI), so flags come
 * from `--help`. Only a mode named `review.run` would start agents on the real
 * CLI; here it prints a line, and the tests assert it is never reached.
 */
export function fakeAnalysisCli(options: FakeAnalysisOptions = {}): FakeAnalysisCli {
	const dir = makeTempDir('entire-analysis-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	for (const sub of ['help', 'out', 'fail', 'hang']) {
		fs.mkdirSync(path.join(state, sub), { recursive: true });
	}
	const log = path.join(dir, 'calls.log');
	const argvLog = path.join(dir, 'argv.log');

	const helps: Record<string, string | null> = {
		tokens_profile: TOKENS_PROFILE_HELP,
		experts: EXPERTS_HELP,
		review: REVIEW_HELP,
		...(options.helps ?? {}),
	};
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	const outputs: Record<string, string> = {
		tokens_profile: TOKEN_PROFILE_JSON,
		experts: EXPERTS_JSON,
		'review.list': REVIEW_LIST_CONFIGURED,
		'review.config': REVIEW_CONFIG_JSON,
		'review.findings': REVIEW_FINDINGS_TEXT,
		'review.run': 'REVIEW RAN',
		repo_view: REPO_VIEW_JSON,
		...(options.outputs ?? {}),
	};
	for (const [key, text] of Object.entries(outputs)) {
		fs.writeFileSync(path.join(state, 'out', key), text);
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}
	for (const key of options.hang ?? []) {
		fs.writeFileSync(path.join(state, 'hang', key), '');
	}
	fs.writeFileSync(path.join(state, 'root'), ROOT_USAGE);

	const script = [
		'#!/bin/sh',
		'CTX=none',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		`S='${state}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2"; exit 0 ;;',
		'\tagent-help) echo "unknown command \\"$2\\"" >&2; exit 1 ;;',
		'esac',
		// `<words> --help`: the file named after the words, or the top-level usage and exit 1 as the real CLI does.
		'case "$*" in',
		'\t*--help) k=$(echo "$*" | sed \'s/ *--help *$//\' | tr " " "_"); if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; cat "$S/root" >&2; exit 1 ;;',
		'esac',
		`echo "$CTX|ACCESSIBLE=$ACCESSIBLE|$*" >> '${log}'`,
		// One write per call: the experts lookup and the repository lookup run in parallel.
		`US=$(printf '\\037'); line=''; for a in "$@"; do line="$line$a$US"; done; printf '%s\\n' "$line" >> '${argvLog}'`,
		'key="$1"',
		'case "$1" in',
		'\ttokens) key=tokens_profile ;;',
		'\trepo) key=repo_view ;;',
		'\treview) case "$*" in *--list*) key=review.list ;; *--show-config*) key=review.config ;; *--findings*) key=review.findings ;; *) key=review.run ;; esac ;;',
		'esac',
		'if [ -f "$S/hang/$key" ]; then exec sleep 30; fi',
		'if [ -f "$S/fail/$key" ]; then cat "$S/fail/$key" >&2; exit 1; fi',
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
	const argvs = (): string[][] =>
		fs.existsSync(argvLog)
			? fs
					.readFileSync(argvLog, 'utf8')
					.split('\n')
					.filter(Boolean)
					.map(line => line.split('\u001f').slice(0, -1))
			: [];
	const mode = (args: readonly string[]): string => {
		if (args[0] === 'tokens') {
			return 'tokens_profile';
		}
		if (args[0] === 'repo') {
			return 'repo_view';
		}
		if (args[0] === 'review') {
			const rest = args.join(' ');
			return rest.includes('--list') ? 'review.list' : rest.includes('--show-config') ? 'review.config' : rest.includes('--findings') ? 'review.findings' : 'review.run';
		}
		return args[0] ?? '';
	};
	return { runner, dir, calls, argvs, modes: key => argvs().filter(args => mode(args) === key), recorded };
}

export const ALICE: AccountContext = {
	name: 'alice@us.auth.entire.io',
	handle: 'alice',
	server: 'https://us.auth.entire.io',
	active: true,
};
