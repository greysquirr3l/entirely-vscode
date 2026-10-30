import * as fs from 'fs';
import * as path from 'path';

import type { AccountContext, ControlConfirmation, Project } from '../../lib/entire';
import type { ControlPlaneDependencies, ControlPlaneUi } from '../../commands/controlPlane';
import type { ApiSource } from '../../services/controlApi';
import { ControlApiService } from '../../services/controlApi';
import { ControlPlaneService } from '../../services/controlPlane';
import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import { makeTempDir } from './tempDir';

/** The flag tables of the real CLI (0.12.2), trimmed to the part the extension reads. */
export const HELPS: Record<string, string> = {
	repo_list: `Flags:
      --all                 Fetch every repository instead of the first 1000 (slower on large projects)
      --json                Output raw JSON instead of a table
      --limit int           Fetch and show only the first N repositories (0 uses the default fetch budget)
      --page-size int       Fetch a single page of at most N entries (1-500; the server may cap N further) and print the resume cursor
      --project string      Project to list (name or ULID) (required)
`,
	repo_delete: `Flags:
      --cascade                 Also delete the repo's mirrors on other clusters
  -f, --force                   Skip the confirmation prompt
      --no-wait                 Return once the server accepts a cascade delete
      --wait-timeout duration   Time limit for a cascade delete to finish (default 10m0s)
  -y, --yes                     Skip the confirmation prompt (alias for --force)
`,
	repo_create: `Flags:
      --json                    Output raw JSON instead of a table
      --no-wait                 Return after creation without confirming provisioning readiness
      --object-format string    Git object format for the repository: sha1 or sha256 (defaults to the server default)
      --project string          Owning project (by name) (required; run in a terminal without --project, --visibility or --object-format to be asked instead)
      --visibility string       Visibility to set after creation: public or private (new repositories are private)
      --wait-timeout duration   Time limit for project resolution, creation, and provisioning readiness (default 10m0s)
`,
	repo_edit: `Flags:
      --json                Output raw JSON instead of a table
      --project string      Owning project (name or ULID); required when <repo> is a bare name, redundant with a /et/<project>/<repo> path or a ULID
      --visibility string   Visibility to set: public or private (required)
`,
	project_list: `Flags:
      --json          Output raw JSON instead of a table
      --name string   Filter by exact project name
      --org string    List projects owned by this org (name or ULID)
`,
	project_delete: `Flags:
  -f, --force   Skip the confirmation prompt
  -y, --yes     Skip the confirmation prompt (alias for --force)
`,
	org_list: `Flags:
      --json   Output raw JSON instead of a table
`,
	org_delete: `Flags:
  -f, --force   Skip the confirmation prompt
  -y, --yes     Skip the confirmation prompt (alias for --force)
`,
	cluster_list: `Flags:
      --json   Output raw JSON instead of a table
`,
	repo_grant_list: `Flags:
      --json   Output raw JSON instead of a table
`,
	project_grant_list: `Flags:
      --json   Output raw JSON instead of a table
`,
	org_grant_list: `Flags:
      --json   Output raw JSON instead of a table
`,
	repo_grant_add: `Flags:
      --json          Output raw JSON instead of a table
      --role string   Role: one of reader, writer, admin (required; asked for if omitted on a terminal)
`,
	project_grant_add: `Flags:
      --json          Output raw JSON instead of a table
      --role string   Role: one of reader, writer, admin (required; asked for if omitted on a terminal)
`,
	org_grant_add: `Flags:
      --json          Output raw JSON instead of a table
      --role string   Role: one of owner, admin, member (default member)
`,
	repo_grant_remove: 'entire repo grant remove — Revoke a user\'s repo access\n',
	project_grant_remove: 'entire project grant remove — Revoke a user\'s project access\n',
	org_grant_remove: 'entire org grant remove — Revoke a grantee\'s org access\n',
	api: `Flags:
  -F, --field stringArray       add a typed parameter in key=value format; true/false/null/numbers are converted (repeatable)
  -i, --include                 print the response status line and headers too
  -j, --jurisdiction string     target a specific jurisdiction's cell (e.g. us, eu) instead of your home cell; implies --to cell
  -X, --method string           HTTP method (default GET, or POST when a field/body is given)
      --to string               which backend to call: core or cell (default "core")
`,
};

/** The mutations the fake CLI knows. Everything else it is asked is a read. */
const MUTATIONS = [
	'repo_delete',
	'repo_create',
	'repo_edit',
	'project_delete',
	'org_delete',
	'repo_grant_add',
	'project_grant_add',
	'org_grant_add',
	'repo_grant_remove',
	'project_grant_remove',
	'org_grant_remove',
];

export interface FakeControlOptions {
	/** Help texts to replace or add, by key such as `repo_delete`. A null value means the CLI has no such command. */
	helps?: Record<string, string | null>;
	/** Output of a read, by key (`org_list`, `project_list`, `repo_list_<project>`, `repo_grant_list__et_<project>_<repo>`). */
	out?: Record<string, string>;
	/** Output of a read once a mutation has run: `<read key>.<mutation key>`. */
	after?: Record<string, string>;
	/** A mutation that exits 1 with this text on stderr, by key. */
	fail?: Record<string, string>;
	/** A mutation that exits 1 with this text unless `--cascade` is passed. */
	failWithoutCascade?: string;
	/** Mutations that exit 0 and change nothing. */
	silent?: readonly string[];
	/** The response of `api`, by method. */
	api?: Record<string, string>;
	noCli?: boolean;
}

export interface FakeControlCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** Every command the CLI was asked, as `context|arguments`, without the lookups. */
	calls(): string[];
	/** The calls whose arguments start with the words. */
	callsTo(words: string): string[];
}

/** A stand-in `entire` whose state is a set of files, so a test sets exactly what the CLI says. */
export function fakeControlCli(options: FakeControlOptions = {}): FakeControlCli {
	const dir = makeTempDir('entire-control-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	for (const sub of ['help', 'out', 'fail', 'done', 'silent']) {
		fs.mkdirSync(path.join(state, sub), { recursive: true });
	}
	const log = path.join(dir, 'calls.log');

	const helps: Record<string, string | null> = { ...HELPS, ...(options.helps ?? {}) };
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	for (const [key, text] of Object.entries(options.out ?? {})) {
		fs.writeFileSync(path.join(state, 'out', key), text);
	}
	for (const [key, text] of Object.entries(options.after ?? {})) {
		fs.writeFileSync(path.join(state, 'out', key), text);
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}
	if (options.failWithoutCascade !== undefined) {
		fs.writeFileSync(path.join(state, 'fail', 'repo_delete.nocascade'), options.failWithoutCascade);
	}
	for (const key of options.silent ?? []) {
		fs.writeFileSync(path.join(state, 'silent', key), '');
	}
	for (const [method, text] of Object.entries(options.api ?? {})) {
		fs.writeFileSync(path.join(state, 'out', `api.${method}`), text);
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
		`echo "$CTX|$*" >> '${log}'`,
		'words=""; target=""; seen=0; method=GET',
		'for a in "$@"; do',
		'\tif [ "$seen" = 2 ]; then continue; fi',
		'\tif [ "$seen" = 1 ]; then target="$a"; seen=2; continue; fi',
		'\tcase "$a" in',
		'\t\t--) seen=1 ;;',
		'\t\t--*project=*) target="${a#*=}" ;;',
		'\t\t--method=*) method="${a#--method=}" ;;',
		'\t\t-*) ;;',
		'\t\t*) words="${words:+${words}_}$a" ;;',
		'\tesac',
		'done',
		'tkey=$(echo "$target" | tr "/" "_")',
		`mutations=' ${MUTATIONS.join(' ')} '`,
		'if [ "$words" = api ]; then',
		'\tif [ -f "$S/out/api.$method" ]; then cat "$S/out/api.$method"; exit 0; fi',
		'\techo "no response for $method" >&2; exit 1',
		'fi',
		'case "$mutations" in',
		'\t*" $words "*)',
		'\t\tif [ -f "$S/fail/$words" ]; then cat "$S/fail/$words" >&2; exit 1; fi',
		'\t\tif [ -f "$S/fail/$words.nocascade" ] && ! echo "$*" | grep -q -- "--cascade"; then cat "$S/fail/$words.nocascade" >&2; exit 1; fi',
		'\t\tif [ ! -f "$S/silent/$words" ]; then : > "$S/done/$words"; fi',
		'\t\techo "done"; exit 0 ;;',
		'esac',
		'key="$words"; [ -n "$target" ] && key="${words}_${tkey}"',
		'for m in "$S"/done/*; do',
		'\t[ -e "$m" ] || continue',
		'\tb=$(basename "$m")',
		'\tif [ -f "$S/out/$key.$b" ]; then cat "$S/out/$key.$b"; exit 0; fi',
		'done',
		'if [ -f "$S/out/$key" ]; then cat "$S/out/$key"; exit 0; fi',
		'echo "permission denied" >&2; exit 1',
	].join('\n');

	if (!options.noCli) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
	return { runner, dir, calls, callsTo: words => calls().filter(line => line.split('|')[1]?.startsWith(words)) };
}

export function serviceFor(cli: FakeControlCli, context: string | undefined = undefined): ControlPlaneService {
	return new ControlPlaneService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		timeoutSeconds: () => 20,
		context: () => context,
	});
}

export function apiFor(cli: FakeControlCli): ControlApiService {
	return new ControlApiService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20 });
}

export const ALICE: AccountContext = {
	name: 'alice@us.auth.entire.io',
	handle: 'alice',
	server: 'https://us.auth.entire.io',
	active: true,
};

export interface UiScript {
	confirms?: boolean[];
	picks?: (string | undefined)[];
	asks?: (string | undefined)[];
	project?: Project;
}

export type FakeUi = ControlPlaneUi & {
	confirmations: ControlConfirmation[];
	picked: { title: string; values: readonly string[] }[];
	asked: string[];
	informed: string[];
	warned: string[];
	shown: { heading: string; body: string }[];
};

export function fakeUi(script: UiScript = {}): FakeUi {
	const confirms = [...(script.confirms ?? [])];
	const picks = [...(script.picks ?? [])];
	const asks = [...(script.asks ?? [])];
	const ui: FakeUi = {
		confirmations: [],
		picked: [],
		asked: [],
		informed: [],
		warned: [],
		shown: [],
		async confirm(prompt) {
			ui.confirmations.push(prompt);
			return confirms.length > 0 ? (confirms.shift() ?? false) : true;
		},
		async pick(title, values) {
			ui.picked.push({ title, values });
			return picks.shift();
		},
		async ask(options) {
			ui.asked.push(options.title);
			const answer = asks.shift();
			if (answer !== undefined && options.validate(answer) !== undefined) {
				throw new Error(`the scripted answer '${answer}' fails the prompt's own validation`);
			}
			return answer;
		},
		async pickProject(projects) {
			return script.project ?? projects[0];
		},
		withProgress: (_title, work) => work(),
		async inform(message) {
			ui.informed.push(message);
		},
		async warn(message) {
			ui.warned.push(message);
		},
		async showApiResult(heading, body) {
			ui.shown.push({ heading, body });
		},
	};
	return ui;
}

export function depsFor(cli: FakeControlCli, ui: ControlPlaneUi, acting: AccountContext | null = ALICE): ControlPlaneDependencies & { refreshes: number; running: { active: boolean } } {
	let refreshes = 0;
	const deps = {
		source: serviceFor(cli),
		api: apiFor(cli) as ApiSource,
		acting: async () => acting ?? undefined,
		ui,
		refresh: () => {
			refreshes += 1;
		},
		running: { active: false },
		get refreshes() {
			return refreshes;
		},
	};
	return deps;
}

export const ORGS = JSON.stringify([{ id: 'ORG1', name: 'Acme', region: 'us', capabilities: { canDelete: true, canManageMembers: true } }]);

export const PROJECTS = JSON.stringify([
	{ id: 'PRJ1', name: 'widgets', ownerName: 'Acme', ownerType: 'org', region: 'us', repositoryCount: 2, capabilities: { canDelete: true } },
	{ id: 'PRJ2', name: 'sandbox', ownerName: 'github:alice', ownerType: 'account', repositoryCount: 0 },
]);

export const WIDGET_REPOS = JSON.stringify([
	{ id: 'R1', name: 'web', provider: 'entire', visibility: 'private', state: 'active', clusterSlug: 'aws-us-east-2', capabilities: { canManage: true } },
	{ id: 'R2', name: 'api', provider: 'entire', visibility: 'public', state: 'active' },
]);

export const WIDGET_REPOS_WITHOUT_WEB = JSON.stringify([{ id: 'R2', name: 'api', provider: 'entire', visibility: 'public', state: 'active' }]);

export const CLUSTERS = JSON.stringify([{ slug: 'aws-us-east-2', host: 'aws-us-east-2.entire.io', jurisdiction: 'us', isDefault: true }]);
