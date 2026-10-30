import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	codeSearchArguments,
	decodeFileHits,
	decodeWorkHits,
	describeEmptyOutcome,
	describeScope,
	isSameRepository,
	outcomeOfReport,
	planWorkSearch,
	readCurrentRepo,
	resolveInRoot,
	scopeLine,
	summariseReport,
	workSearchArguments,
	type WorkSearchOutcome,
	type WorkSearchPlan,
	type WorkSearchReport,
} from '../lib/entire';
import { buildSearchNodes, SearchProvider, type SearchTarget } from '../providers/searchProvider';
import { openSearchResult, type OpenResultDependencies } from '../commands/workSearch';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import type { CliInvocation, CliInvocationBodies } from '../services/cli/invocation';
import { readSearchScope } from '../services/configuration';
import { WorkSearchService } from '../services/workSearch';
import { makeTempDir } from './support/tempDir';

const HELP = `entire search — Search checkpoints, commits, and sessions

Current repo: gh/acme/widgets  (auto-detected from origin; pass --repo only for a DIFFERENT repo)

Flags:
      --all-repos        Search all accessible repos instead of just the current one
      --author string    Filter by author name
      --case-sensitive   Case-sensitive code search (only with --code)
      --code             Search code content across repositories
      --compact          Trimmed JSON output for agents: id, repo, score (implies --json)
      --json             Output as JSON
      --limit int        Maximum number of results (per page for checkpoint search, total for --code) (default 10)
      --repo strings     Filter by repository
`;

const RENAMED_HELP = `Flags:
      --everywhere       Search all accessible repositories
      --grep             Search code content in files
      --as-json          Print the results as JSON
      --max-results int  Maximum number of results to return
      --terse            Compact output with a truncated title
`;

const LISTING = {
	results: [
		{ id: 'sess-1234567890', type: 'session', repo: 'acme/widgets', branch: 'main', author: 'ann', title: 'fix the retry loop' },
		{ id: '8318c10e83ca7fc56009cc74b4f806a0a084a419', type: 'commit', repo: 'acme/widgets', author: 'ann', title: 'add backoff' },
		{ id: 'abc123def456', type: 'checkpoint', repo: 'acme/widgets', title: 'retry work' },
		{ id: 'p-1', type: 'pr', repo: 'acme/other', title: 'a pull request' },
	],
	total: 4,
};

const CODE = {
	query: 'retry',
	results: [
		{ repo: 'gh/acme/widgets', path: 'src/retry.ts', line: 12, column: 5, context_line: '  const retry = 3;' },
		{ repo: 'gh/acme/other', path: 'lib/retry.go', line: 3, context_line: 'func retry() {}' },
	],
	total: 2,
};

function planFrom(help: string): WorkSearchPlan {
	const planned = planWorkSearch(help);
	assert.ok(planned.ok);
	return planned.plan;
}

function report(overrides: Partial<WorkSearchReport> = {}): WorkSearchReport {
	const hits = decodeWorkHits(LISTING);
	const files = decodeFileHits(CODE);
	assert.ok(hits.ok && files.ok);
	return {
		query: 'retry',
		scope: { reach: 'current', repo: 'gh/acme/widgets', login: 'ann@host' },
		hits: hits.value.hits,
		files: files.value.files,
		notes: [],
		...overrides,
	};
}

suite('Work search flags', () => {
	test('reads each flag from what the help says it does', () => {
		const plan = planFrom(HELP);
		assert.deepStrictEqual(plan.listing, ['--json', '--compact']);
		assert.strictEqual(plan.jsonOnly, '--json');
		assert.strictEqual(plan.limitFlag, '--limit');
		assert.strictEqual(plan.allReposFlag, '--all-repos');
		assert.strictEqual(plan.codeFlag, '--code');
		assert.strictEqual(plan.currentRepo, 'gh/acme/widgets');
	});

	test('follows a CLI that names its flags differently', () => {
		const plan = planFrom(RENAMED_HELP);
		assert.strictEqual(plan.jsonOnly, '--as-json');
		assert.strictEqual(plan.allReposFlag, '--everywhere');
		assert.strictEqual(plan.codeFlag, '--grep');
		assert.deepStrictEqual(workSearchArguments(plan, 'q', 'all', 5), [
			'search', '--as-json', '--terse', '--everywhere', '--max-results', '5', '--', 'q',
		]);
	});

	test('refuses a CLI that cannot print JSON', () => {
		assert.strictEqual(planWorkSearch('Flags:\n      --author string    Filter by author\n').ok, false);
	});

	test('builds the listing and code searches, with the query after the separator', () => {
		const plan = planFrom(HELP);
		assert.deepStrictEqual(workSearchArguments(plan, '--limit 1', 'current'), [
			'search', '--json', '--compact', '--limit', '50', '--', '--limit 1',
		]);
		assert.deepStrictEqual(codeSearchArguments(plan, 'x', 'all'), [
			'search', '--json', '--code', '--all-repos', '--limit', '50', '--', 'x',
		]);
	});

	test('has no code search when the help offers none', () => {
		const plan = planFrom('Flags:\n      --json   Output as JSON\n');
		assert.strictEqual(codeSearchArguments(plan, 'x', 'current'), undefined);
	});

	test('reads the detected repository from the help', () => {
		assert.strictEqual(readCurrentRepo(HELP), 'gh/acme/widgets');
		assert.strictEqual(readCurrentRepo('Flags:'), undefined);
	});
});

suite('Work search results', () => {
	test('decodes sessions, commits, checkpoints and other hits', () => {
		const decoded = decodeWorkHits(LISTING);
		assert.ok(decoded.ok);
		assert.deepStrictEqual(decoded.value.hits.map(hit => hit.kind), ['session', 'commit', 'checkpoint', 'other']);
		assert.strictEqual(decoded.value.hits[3].typeName, 'pr');
		assert.strictEqual(decoded.value.total, 4);
		assert.strictEqual(decodeWorkHits([]).ok, false);
		assert.strictEqual(decodeWorkHits({ results: [{ type: 'commit' }] }).ok, false);
	});

	test('decodes file matches', () => {
		const decoded = decodeFileHits(CODE);
		assert.ok(decoded.ok);
		assert.strictEqual(decoded.value.files[0].path, 'src/retry.ts');
		assert.strictEqual(decoded.value.files[0].line, 12);
		assert.strictEqual(decodeFileHits({ results: [{ line: 1 }] }).ok, false);
		const empty = decodeFileHits({ query: 'x', results: [], total: 0 });
		assert.ok(empty.ok);
		assert.strictEqual(empty.value.files.length, 0);
	});

	test('states the scope: repository, login and reach', () => {
		assert.strictEqual(describeScope({ reach: 'current', repo: 'gh/a/b', login: 'ann' }), 'this repository (gh/a/b) as ann');
		assert.strictEqual(describeScope({ reach: 'all' }), 'every repository this login can see');
		assert.strictEqual(
			describeScope({ reach: 'all', widened: false, repo: 'gh/a/b' }),
			'this repository (gh/a/b)',
		);
		assert.strictEqual(scopeLine({ reach: 'current', repo: 'gh/a/b' }), 'Searched this repository (gh/a/b).');
	});

	test('an empty result says nothing was found, and where (empty-result)', () => {
		const outcome = outcomeOfReport(report({ hits: [], files: [] }));
		assert.strictEqual(outcome.kind, 'none');
		const message = describeEmptyOutcome(outcome);
		assert.ok(message?.includes('found nothing'));
		assert.ok(message?.includes('this repository (gh/acme/widgets) as ann@host'));
	});

	test('an empty result does not hide a part that failed', () => {
		const outcome = outcomeOfReport(report({ hits: [], files: [], notes: ['Files could not be searched: boom.'] }));
		assert.ok(describeEmptyOutcome(outcome)?.includes('Files could not be searched'));
	});

	test('a failed search is not worded as an empty one', () => {
		const message = describeEmptyOutcome({
			kind: 'failed', detail: 'not signed in', query: 'q', scope: { reach: 'all' },
		});
		assert.ok(message?.startsWith('The search failed'));
		assert.ok(!message?.includes('found nothing'));
		assert.strictEqual(describeEmptyOutcome(outcomeOfReport(report())), undefined);
	});

	test('summarises what was found', () => {
		assert.strictEqual(
			summariseReport(report()),
			'1 session, 1 commit, 1 checkpoint, 1 other result, 2 file matches',
		);
		assert.strictEqual(summariseReport(report({ files: report().files.slice(0, 1) })).endsWith('1 file match'), true);
	});

	test('tells this repository from another', () => {
		assert.ok(isSameRepository('acme/widgets', 'gh/acme/widgets'));
		assert.ok(isSameRepository('gh/Acme/Widgets', 'acme/widgets'));
		assert.ok(!isSameRepository('acme/other', 'gh/acme/widgets'));
		assert.ok(!isSameRepository(undefined, 'gh/acme/widgets'));
	});

	test('keeps a result path inside the root', () => {
		const root = path.join(path.sep, 'work', 'repo');
		assert.strictEqual(resolveInRoot(root, 'src/a.ts'), path.join(root, 'src', 'a.ts'));
		assert.strictEqual(resolveInRoot(root, '../secret'), undefined);
		assert.strictEqual(resolveInRoot(root, 'a/../../b'), undefined);
		assert.strictEqual(resolveInRoot(root, '/etc/passwd'), undefined);
		assert.strictEqual(resolveInRoot(root, 'C:\\x'), undefined);
		assert.strictEqual(resolveInRoot(root, ''), undefined);
	});

	test('reads the scope setting, narrow by default', () => {
		assert.strictEqual(readSearchScope('all-repositories'), 'all-repositories');
		assert.strictEqual(readSearchScope('everything'), 'repository');
	});
});

interface FakeCli {
	readonly runner: CliRunner;
	readonly dir: string;
	invocations(): string[];
	recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

interface FakeOptions {
	help?: string;
	listing?: unknown;
	code?: unknown;
	listingExit?: number;
	codeExit?: number;
	knowsHelp?: boolean;
	installed?: boolean;
}

function fakeCli(options: FakeOptions = {}): FakeCli {
	const dir = makeTempDir('entire-worksearch-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');
	fs.writeFileSync(path.join(dir, 'help.txt'), options.help ?? HELP, 'utf8');
	fs.writeFileSync(path.join(dir, 'listing.json'), JSON.stringify(options.listing ?? LISTING), 'utf8');
	fs.writeFileSync(path.join(dir, 'code.json'), JSON.stringify(options.code ?? CODE), 'utf8');

	const script = [
		'#!/bin/sh',
		`echo "$@" >> '${log}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2" ;;',
		options.knowsHelp === false
			? '\tagent-help) echo "unknown command agent-help" >&2; exit 2 ;;'
			: `\tagent-help) cat '${dir}/help.txt' ;;`,
		'\tsearch)',
		'\t\tcase "$*" in',
		`\t\t\t*--code*) if [ ${options.codeExit ?? 0} -ne 0 ]; then echo "code index down" >&2; exit ${options.codeExit ?? 0}; fi; cat '${dir}/code.json' ;;`,
		`\t\t\t*) if [ ${options.listingExit ?? 0} -ne 0 ]; then echo "not signed in" >&2; exit ${options.listingExit ?? 0}; fi; cat '${dir}/listing.json' ;;`,
		'\t\tesac ;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');
	if (options.installed !== false) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: FakeCli['recorded'] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });
	return {
		runner,
		dir,
		recorded,
		invocations: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
	};
}

function serviceFor(cli: FakeCli, reach: 'current' | 'all' = 'current'): WorkSearchService {
	return new WorkSearchService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		reach: () => reach,
		login: () => 'ann@host',
	});
}

suite('Work search service', () => {
	test('runs the CLI search and lists sessions, commits and files (search-work)', async () => {
		const cli = fakeCli();
		const outcome = await serviceFor(cli).search('retry');

		assert.ok(outcome.kind === 'results');
		assert.deepStrictEqual(outcome.report.hits.map(hit => hit.kind), ['session', 'commit', 'checkpoint', 'other']);
		assert.strictEqual(outcome.report.files.length, 2);
		assert.ok(cli.invocations().includes('search --json --compact --limit 50 -- retry'));
		assert.ok(cli.invocations().includes('search --json --code --limit 50 -- retry'));
	});

	test('states the scope it ran in with the results', async () => {
		const narrow = await serviceFor(fakeCli()).search('retry');
		assert.ok(narrow.kind === 'results');
		assert.deepStrictEqual(narrow.report.scope, { reach: 'current', repo: 'gh/acme/widgets', login: 'ann@host', widened: undefined });

		const cli = fakeCli();
		const wide = await serviceFor(cli, 'all').search('retry');
		assert.ok(wide.kind === 'results');
		assert.strictEqual(wide.report.scope.reach, 'all');
		assert.ok(cli.invocations().includes('search --json --compact --all-repos --limit 50 -- retry'));
		assert.ok(describeScope(wide.report.scope).includes('every repository'));
	});

	test('reports no match as none, with the scope (empty-result)', async () => {
		const cli = fakeCli({ listing: { results: [], total: 0 }, code: { results: [], total: 0 } });
		const outcome = await serviceFor(cli).search('nothing');
		assert.ok(outcome.kind === 'none');
		assert.ok(describeEmptyOutcome(outcome)?.includes('found nothing'));
	});

	test('lists the part that worked when the other failed, and says so', async () => {
		const cli = fakeCli({ codeExit: 1 });
		const outcome = await serviceFor(cli).search('retry');
		assert.ok(outcome.kind === 'results');
		assert.strictEqual(outcome.report.files.length, 0);
		assert.ok(outcome.report.notes.some(note => note.startsWith('Files could not be searched')));
	});

	test('does not call a failed listing an empty one', async () => {
		const cli = fakeCli({ listingExit: 1, codeExit: 1 });
		const outcome = await serviceFor(cli).search('retry');
		assert.strictEqual(outcome.kind, 'failed');
	});

	test('says when only some of the results are shown', async () => {
		const cli = fakeCli({ listing: { ...LISTING, total: 90 } });
		const outcome = await serviceFor(cli).search('retry');
		assert.ok(outcome.kind === 'results');
		assert.ok(outcome.report.notes.some(note => note.includes('Showing 4 of 90 results')));
	});

	test('fails clearly when the CLI is missing', async () => {
		const outcome = await serviceFor(fakeCli({ installed: false })).search('retry');
		assert.ok(outcome.kind === 'failed');
		assert.ok(/not installed/.test(outcome.detail));
	});

	test('fails with a way out when the CLI has no search command', async () => {
		const cli = fakeCli({ knowsHelp: false });
		const outcome = await serviceFor(cli).search('retry');
		assert.ok(outcome.kind === 'failed');
		assert.ok(/update/.test(outcome.detail));
		assert.ok(!cli.invocations().some(line => line.startsWith('search')));
	});

	test('searches listing only, and says so, when the CLI has no code search', async () => {
		const cli = fakeCli({ help: 'Flags:\n      --json   Output as JSON\n' });
		const outcome = await serviceFor(cli).search('retry');
		assert.ok(outcome.kind === 'results');
		assert.ok(outcome.report.notes.some(note => note.includes('no code search')));
	});

	test('takes its flags from the help', async () => {
		const cli = fakeCli({ help: RENAMED_HELP });
		await serviceFor(cli, 'all').search('retry');
		assert.ok(cli.invocations().includes('search --as-json --terse --everywhere --max-results 50 -- retry'));
		assert.ok(cli.invocations().includes('search --as-json --grep --everywhere --max-results 50 -- retry'));
	});

	test('keeps the query and the results out of the recorded invocations', async () => {
		const cli = fakeCli();
		await serviceFor(cli).search('secret words');
		const searches = cli.recorded.filter(entry => entry.invocation.args[0] === 'search');
		assert.strictEqual(searches.length, 2);
		for (const entry of searches) {
			assert.ok(!entry.invocation.args.join(' ').includes('secret'));
			assert.strictEqual(entry.bodies.stdout, undefined);
		}
	});
});

suite('Search view', () => {
	test('lays results out under the scope line, grouped by kind', () => {
		const nodes = buildSearchNodes(report({ notes: ['Showing 4 of 90 results.'] }));
		assert.strictEqual(nodes[0].kind, 'scope');
		assert.ok(nodes[0].kind === 'scope' && nodes[0].text.includes('this repository (gh/acme/widgets) as ann@host'));
		assert.ok(nodes[1].kind === 'scope' && nodes[1].text === 'Showing 4 of 90 results.');
		const groups = nodes.filter(node => node.kind === 'group').map(node => (node.kind === 'group' ? node.label : ''));
		assert.deepStrictEqual(groups, ['Sessions (1)', 'Commits (1)', 'Checkpoints (1)', 'Other results (1)', 'Files (2)']);
	});

	test('marks a result from another repository as not local when the search was wide', () => {
		const nodes = buildSearchNodes(report({ scope: { reach: 'all', repo: 'gh/acme/widgets' } }));
		const files = nodes.find(node => node.kind === 'group' && node.label.startsWith('Files'));
		assert.ok(files && files.kind === 'group');
		const locals = files.items.map(item => (item.kind === 'result' ? item.target.local : undefined));
		assert.deepStrictEqual(locals, [true, false]);
	});

	test('renders the search through the provider and says when nothing matched', async () => {
		const outcomes: WorkSearchOutcome[] = [outcomeOfReport(report()), outcomeOfReport(report({ hits: [], files: [] }))];
		const provider = new SearchProvider({ search: async () => outcomes.shift() ?? outcomes[0] });

		await provider.run('retry');
		assert.strictEqual(provider.isIdle, false);
		assert.strictEqual(provider.viewMessage, undefined);
		assert.ok(provider.getChildren().length > 1);
		const first = provider.getChildren().find(node => node.kind === 'group');
		assert.ok(first && first.kind === 'group');
		const item = provider.getTreeItem(first.items[0]);
		assert.strictEqual(item.label, 'fix the retry loop');
		assert.strictEqual(item.command?.command, 'entirely.openSearchResult');

		await provider.run('nothing');
		assert.deepStrictEqual(provider.getChildren(), []);
		const message = String(provider.viewMessage);
		assert.ok(message.includes('found nothing'));
		assert.ok(message.includes('gh/acme/widgets'));

		provider.clear();
		assert.ok(provider.isIdle);
		provider.dispose();
	});

	test('drops the answer to a search that was replaced', async () => {
		const resolvers: ((outcome: WorkSearchOutcome) => void)[] = [];
		const provider = new SearchProvider({ search: () => new Promise(resolve => resolvers.push(resolve)) });
		const old = provider.run('old');
		const current = provider.run('new');
		resolvers[0](outcomeOfReport(report({ query: 'old' })));
		resolvers[1](outcomeOfReport(report({ hits: [], files: [], query: 'new' })));
		assert.strictEqual(await old, undefined);
		assert.ok((await current)?.kind === 'none');
		assert.ok(provider.viewMessage?.includes('"new"'));
		provider.dispose();
	});
});

suite('Opening a search result', () => {
	function deps(root: string, calls: string[]): OpenResultDependencies {
		return {
			roots: () => [root],
			findSession: async id => {
				calls.push(`find ${id}`);
				return id === 'sess-1234567890'
					? { kind: 'session', session: { id, agent: 'a', status: 'ended' } }
					: undefined;
			},
			showSession: async node => void calls.push(`show ${node.session.id}`),
			explainCheckpoint: async id => void calls.push(`explain ${id}`),
		};
	}

	test('opens a file result in the editor at its line (open-result)', async () => {
		const root = makeTempDir('entire-open-');
		fs.mkdirSync(path.join(root, 'src'));
		const file = path.join(root, 'src', 'retry.ts');
		fs.writeFileSync(file, 'one\ntwo\nthree\n', 'utf8');

		const target: SearchTarget = { kind: 'file', file: { path: 'src/retry.ts', line: 3, column: 2 }, local: true };
		const result = await openSearchResult(deps(root, []), target);

		assert.deepStrictEqual(result, { kind: 'opened-file', path: file });
		const editor = vscode.window.activeTextEditor;
		assert.strictEqual(editor?.document.uri.fsPath, file);
		assert.strictEqual(editor?.selection.active.line, 2);
		assert.strictEqual(editor?.selection.active.character, 1);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('says so when the file is not in the workspace', async () => {
		const root = makeTempDir('entire-open-');
		const result = await openSearchResult(deps(root, []), {
			kind: 'file', file: { path: 'gone.ts' }, local: true,
		});
		assert.strictEqual(result.kind, 'not-here');
	});

	test('does not open a path that climbs out of the workspace', async () => {
		const root = makeTempDir('entire-open-');
		fs.writeFileSync(path.join(path.dirname(root), 'outside-entire.txt'), 'x', 'utf8');
		const result = await openSearchResult(deps(root, []), {
			kind: 'file', file: { path: '../outside-entire.txt' }, local: true,
		});
		fs.rmSync(path.join(path.dirname(root), 'outside-entire.txt'), { force: true });
		assert.strictEqual(result.kind, 'not-here');
	});

	test('does not open a file of another repository as if it were here', async () => {
		const root = makeTempDir('entire-open-');
		fs.writeFileSync(path.join(root, 'retry.go'), 'x', 'utf8');
		const result = await openSearchResult(deps(root, []), {
			kind: 'file', file: { repo: 'gh/acme/other', path: 'retry.go' }, local: false,
		});
		assert.strictEqual(result.kind, 'not-here');
	});

	test('opens a tracked session and a checkpoint in their own views', async () => {
		const calls: string[] = [];
		const root = makeTempDir('entire-open-');
		const decoded = decodeWorkHits(LISTING);
		assert.ok(decoded.ok);
		const [session, , checkpoint] = decoded.value.hits;

		assert.deepStrictEqual(await openSearchResult(deps(root, calls), { kind: 'hit', hit: session, local: true }), { kind: 'opened-session' });
		assert.deepStrictEqual(await openSearchResult(deps(root, calls), { kind: 'hit', hit: checkpoint, local: true }), { kind: 'opened-checkpoint' });
		assert.deepStrictEqual(calls, ['find sess-1234567890', 'show sess-1234567890', 'explain abc123def456']);
	});

	test('says a session is not tracked here when it is not', async () => {
		const result = await openSearchResult(deps(makeTempDir('entire-open-'), []), {
			kind: 'hit', hit: { kind: 'session', typeName: 'session', id: 'sess-other' }, local: true,
		});
		assert.strictEqual(result.kind, 'not-here');
	});
});
