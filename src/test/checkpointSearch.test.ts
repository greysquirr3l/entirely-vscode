import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	decodeSearchResults,
	describeSearchOutcome,
	normaliseQuery,
	outcomeOf,
	planSearchFlags,
	readFlagTable,
	searchArguments,
	type Checkpoint,
	type SearchOutcome,
} from '../lib/entire';
import { CheckpointsProvider } from '../providers/checkpointsProvider';
import { makeTempDir } from './support/tempDir';
import { CheckpointFilter, type FilterState } from '../services/checkpointFilter';
import { CheckpointSearchService, type CheckpointSearchSource } from '../services/checkpointSearch';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import type { CliInvocation, CliInvocationBodies } from '../services/cli/invocation';
import { clampSearchDebounce } from '../services/configuration';

const HEX_A = 'abc123def456';
const HEX_B = '0123456789ab';

/** The help text as the installed CLI prints it, prose included. */
const REAL_HELP = `entire checkpoint search — Search checkpoints
Run without arguments to open an interactive search. Results are
displayed in an interactive table. Use --json for machine-readable output,
and add --compact for a trimmed per-result shape suited to agents (implies
--json): id, type, repo.

Flags:
      --all-repos        Search all accessible repos instead of just the current one
      --author string    Filter by author name
      --compact          Trimmed JSON output for agents: id, repo, score (implies --json)
      --json             Output as JSON
      --limit int        Maximum number of results (per page for checkpoint search) (default 10)
`;

/** A CLI whose help names different flags for the same jobs. */
const RENAMED_HELP = `Flags:
      --as-json          Print the results as JSON
      --max-results int  Maximum number of results to return
      --terse            Compact output with a truncated title
`;

const PAYLOAD = {
	results: [
		{ id: HEX_A, type: 'checkpoint', title: 'fix the login retry', date: '2026-10-29T01:47:56.000Z', score: 3 },
		{ id: '8318c10e83ca7fc56009cc74b4f806a0a084a419', type: 'commit', title: 'a commit' },
		{ id: HEX_B, type: 'checkpoint', title: 'add backoff' },
	],
	total: 3,
};

function checkpoint(id: string, message: string): Checkpoint {
	return { id, message, sessionIds: [], sessionCount: 0, isTaskCheckpoint: false, isLogsOnly: false };
}

suite('Checkpoint search flags', () => {
	test('reads table rows and ignores prose that names a flag', () => {
		const table = readFlagTable(REAL_HELP);
		const json = table.find(flag => flag.name === '--json');
		assert.strictEqual(json?.description, 'Output as JSON');
		assert.strictEqual(table.filter(flag => flag.name === '--json').length, 1);
	});

	test('chooses the flags the help describes', () => {
		const plan = planSearchFlags(REAL_HELP);
		assert.ok(plan.ok);
		assert.deepStrictEqual(plan.flags, ['--json', '--compact']);
		assert.strictEqual(plan.limitFlag, '--limit');
	});

	test('follows a CLI whose help names different flags', () => {
		const plan = planSearchFlags(RENAMED_HELP);
		assert.ok(plan.ok);
		assert.deepStrictEqual(plan.flags, ['--as-json', '--terse']);
		assert.strictEqual(plan.limitFlag, '--max-results');
	});

	test('fails when the help offers no JSON output', () => {
		const plan = planSearchFlags('Flags:\n      --limit int   Maximum number of results\n');
		assert.strictEqual(plan.ok, false);
	});

	test('puts the query after the end of options', () => {
		const plan = planSearchFlags(REAL_HELP);
		assert.ok(plan.ok);
		const args = searchArguments(plan, '--limit 9999', 7);
		assert.deepStrictEqual(args, [
			'checkpoint', 'search', '--json', '--compact', '--limit', '7', '--', '--limit 9999',
		]);
	});

	test('trims and bounds the query', () => {
		assert.strictEqual(normaliseQuery('   '), undefined);
		assert.strictEqual(normaliseQuery('  retry  '), 'retry');
		assert.strictEqual(normaliseQuery('x'.repeat(2000))?.length, 500);
	});

	test('clamps the debounce delay', () => {
		assert.strictEqual(clampSearchDebounce(1), 100);
		assert.strictEqual(clampSearchDebounce(999999), 3000);
		assert.strictEqual(clampSearchDebounce(Number.NaN), 400);
		assert.strictEqual(clampSearchDebounce(250.9), 250);
	});
});

suite('Checkpoint search results', () => {
	test('keeps checkpoint hits and counts the others', () => {
		const decoded = decodeSearchResults(PAYLOAD);
		assert.ok(decoded.ok);
		assert.deepStrictEqual(decoded.value.checkpoints.map(c => c.id), [HEX_A, HEX_B]);
		assert.strictEqual(decoded.value.checkpoints[0].message, 'fix the login retry');
		assert.strictEqual(decoded.value.otherHits, 1);
	});

	test('reads an empty result as no match, not as an error', () => {
		const decoded = decodeSearchResults({ results: [], total: 0 });
		assert.ok(decoded.ok);
		assert.deepStrictEqual(outcomeOf(decoded.value), { kind: 'none', otherHits: 0 });
	});

	test('rejects a payload that is not the search shape', () => {
		assert.strictEqual(decodeSearchResults([]).ok, false);
		assert.strictEqual(decodeSearchResults({ results: [{ type: 'checkpoint' }] }).ok, false);
	});

	test('says different things for no match and a failed search', () => {
		const none = describeSearchOutcome({ kind: 'none', otherHits: 0 });
		const failed = describeSearchOutcome({ kind: 'failed', detail: 'the Entire CLI is not installed' });
		assert.ok(none?.startsWith('No checkpoint matched'));
		assert.ok(failed?.startsWith('The search failed'));
		assert.ok(!failed?.includes('No checkpoint matched'));
		assert.ok(!none?.includes('failed'));
		assert.strictEqual(describeSearchOutcome({ kind: 'matches', checkpoints: [], otherHits: 0 }), undefined);
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
	payload?: unknown;
	/** Exit status of the search command. */
	searchExit?: number;
	/** Whether `agent-help` is known to this CLI. */
	knowsHelp?: boolean;
	/** Whether there is a binary at all. */
	installed?: boolean;
}

function fakeCli(options: FakeOptions = {}): FakeCli {
	const dir = makeTempDir('entire-search-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');
	const help = path.join(dir, 'help.txt');
	const payload = path.join(dir, 'payload.json');
	fs.writeFileSync(help, options.help ?? REAL_HELP, 'utf8');
	fs.writeFileSync(payload, JSON.stringify(options.payload ?? PAYLOAD), 'utf8');

	const script = [
		'#!/bin/sh',
		`echo "$@" >> '${log}'`,
		'case "$1 $2" in',
		'\t"version "*) echo "entire 0.12.2" ;;',
		options.knowsHelp === false
			? '\t"agent-help "*) echo "unknown command agent-help" >&2; exit 2 ;;'
			: `\t"agent-help checkpoint") cat '${help}' ;;`,
		`\t"checkpoint search") if [ ${options.searchExit ?? 0} -ne 0 ]; then echo "not signed in" >&2; exit ${options.searchExit ?? 0}; fi; cat '${payload}' ;;`,
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

function serviceFor(cli: FakeCli): CheckpointSearchService {
	return new CheckpointSearchService({ runner: cli.runner, workspaceRoot: () => cli.dir });
}

suite('Checkpoint search service', () => {
	test('lists the checkpoints the CLI matched (filter-checkpoints)', async () => {
		const cli = fakeCli();
		const outcome = await serviceFor(cli).search('login retry');

		assert.strictEqual(outcome.kind, 'matches');
		assert.ok(outcome.kind === 'matches');
		assert.deepStrictEqual(outcome.checkpoints.map(c => c.id), [HEX_A, HEX_B]);
		assert.ok(cli.invocations().includes('checkpoint search --json --compact --limit 50 -- login retry'));
	});

	test('reports no match when the CLI found nothing (no-match)', async () => {
		const cli = fakeCli({ payload: { results: [], total: 0 } });
		const outcome = await serviceFor(cli).search('nothing like this');
		assert.deepStrictEqual(outcome, { kind: 'none', otherHits: 0 });
	});

	test('reports a failed search when the CLI exits non-zero (search-failed)', async () => {
		const cli = fakeCli({ searchExit: 1 });
		const outcome = await serviceFor(cli).search('anything');
		assert.strictEqual(outcome.kind, 'failed');
	});

	test('reports a failed search when the CLI is missing', async () => {
		const cli = fakeCli({ installed: false });
		const outcome = await serviceFor(cli).search('anything');
		assert.ok(outcome.kind === 'failed');
		assert.ok(/not installed/.test(outcome.detail));
	});

	test('reports a failed search, with a way out, when the CLI is too old', async () => {
		const cli = fakeCli({ knowsHelp: false });
		const outcome = await serviceFor(cli).search('anything');
		assert.ok(outcome.kind === 'failed');
		assert.ok(/update/.test(outcome.detail));
		assert.ok(!cli.invocations().some(line => line.startsWith('checkpoint search')));
	});

	test('reports a failed search when the output is not the search payload', async () => {
		const cli = fakeCli({ payload: ['not', 'a', 'record'] });
		const outcome = await serviceFor(cli).search('anything');
		assert.strictEqual(outcome.kind, 'failed');
	});

	test('takes its flags from the CLI help, not from a list in the extension', async () => {
		const cli = fakeCli({ help: RENAMED_HELP });
		await serviceFor(cli).search('login');
		assert.ok(cli.invocations().includes('checkpoint search --as-json --terse --max-results 50 -- login'));
		assert.ok(!cli.invocations().some(line => line.includes('--limit') || line.includes('--compact')));
	});

	test('cannot read a query as a flag', async () => {
		const cli = fakeCli();
		await serviceFor(cli).search('--limit 1');
		assert.ok(cli.invocations().some(line => line.endsWith('-- --limit 1')));
	});

	test('keeps the query and the results out of the recorded invocation', async () => {
		const cli = fakeCli();
		await serviceFor(cli).search('secret prompt words');

		const search = cli.recorded.find(entry => entry.invocation.args[0] === 'checkpoint');
		assert.ok(search);
		assert.ok(!search.invocation.args.join(' ').includes('secret'));
		assert.strictEqual(search.bodies.stdout, undefined);
	});

	test('reads the help again after a failure', async () => {
		const cli = fakeCli({ knowsHelp: false });
		const service = serviceFor(cli);
		await service.search('a');
		await service.search('b');
		assert.strictEqual(cli.invocations().filter(line => line.startsWith('agent-help')).length, 2);
	});
});

function stubSource(): { source: CheckpointSearchSource; calls: string[]; resolvers: ((outcome: SearchOutcome) => void)[] } {
	const calls: string[] = [];
	const resolvers: ((outcome: SearchOutcome) => void)[] = [];
	return {
		calls,
		resolvers,
		source: {
			search: query => {
				calls.push(query);
				return new Promise(resolve => resolvers.push(resolve));
			},
		},
	};
}

async function until(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error('timed out');
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

suite('Checkpoint filter', () => {
	test('searches once after typing stops', async () => {
		const stub = stubSource();
		const filter = new CheckpointFilter(stub.source, () => 100);
		filter.setQuery('l');
		filter.setQuery('lo');
		filter.setQuery('log');
		assert.strictEqual(filter.state.kind, 'searching');
		await until(() => stub.calls.length > 0);
		await new Promise(resolve => setTimeout(resolve, 150));
		assert.deepStrictEqual(stub.calls, ['log']);
		filter.dispose();
	});

	test('ignores the answer to a search the user has typed past', async () => {
		const stub = stubSource();
		const filter = new CheckpointFilter(stub.source, () => 100);
		filter.setQuery('old');
		await until(() => stub.calls.length === 1);
		filter.setQuery('new');
		await until(() => stub.calls.length === 2);

		stub.resolvers[1]({ kind: 'none', otherHits: 0 });
		await until(() => filter.state.kind === 'done');
		stub.resolvers[0]({ kind: 'matches', checkpoints: [checkpoint(HEX_A, 'stale')], otherHits: 0 });
		await new Promise(resolve => setTimeout(resolve, 20));

		assert.ok(filter.state.kind === 'done');
		assert.strictEqual(filter.state.outcome.kind, 'none');
		filter.dispose();
	});

	test('does not search for empty text, and clearing returns to idle', async () => {
		const stub = stubSource();
		const filter = new CheckpointFilter(stub.source, () => 100);
		filter.setQuery('   ');
		assert.strictEqual(filter.state.kind, 'idle');
		filter.setQuery('abc');
		filter.clear();
		await new Promise(resolve => setTimeout(resolve, 150));
		assert.strictEqual(filter.state.kind, 'idle');
		assert.strictEqual(filter.text, undefined);
		assert.deepStrictEqual(stub.calls, []);
		filter.dispose();
	});

	test('turns a source that throws into a failed search', async () => {
		const filter = new CheckpointFilter({ search: () => Promise.reject(new Error('boom')) }, () => 100);
		filter.setQuery('abc');
		await until(() => filter.state.kind === 'done');
		assert.ok(filter.state.kind === 'done');
		assert.strictEqual(filter.state.outcome.kind, 'failed');
		filter.dispose();
	});
});

suite('Checkpoints tree under a filter', () => {
	function provider(): CheckpointsProvider {
		return new CheckpointsProvider(
			async () => ({ checkpoints: [checkpoint('111111111111', 'one'), checkpoint('222222222222', 'two'), checkpoint(HEX_A, 'three')] }),
			async () => undefined,
			() => 0,
		);
	}

	function titles(tree: CheckpointsProvider): string[] {
		return tree.getChildren().map(node => (node.kind === 'checkpoint' ? node.checkpoint.id : node.kind));
	}

	test('narrows the list to what the search matched', async () => {
		const tree = provider();
		await tree.refresh();
		assert.strictEqual(titles(tree).length, 3);

		const state: FilterState = {
			kind: 'done',
			outcome: { kind: 'matches', checkpoints: [checkpoint(HEX_A, 'three')], otherHits: 0 },
		};
		tree.applyFilter(state);
		assert.deepStrictEqual(titles(tree), [HEX_A]);
		assert.strictEqual(tree.viewMessage, '1 checkpoint matched.');

		tree.applyFilter({ kind: 'idle' });
		assert.strictEqual(titles(tree).length, 3);
		tree.dispose();
	});

	test('shows no checkpoint matched, and a failed search, as different messages', async () => {
		const tree = provider();
		await tree.refresh();

		tree.applyFilter({ kind: 'done', outcome: { kind: 'none', otherHits: 0 } });
		assert.deepStrictEqual(titles(tree), []);
		const none = tree.viewMessage;

		tree.applyFilter({ kind: 'done', outcome: { kind: 'failed', detail: 'the Entire CLI is not installed' } });
		assert.deepStrictEqual(titles(tree), []);
		const failed = tree.viewMessage;

		assert.ok(none?.startsWith('No checkpoint matched'));
		assert.ok(failed?.startsWith('The search failed'));
		assert.ok(!failed?.includes('No checkpoint matched'));
		tree.dispose();
	});

	test('keeps the filtered list when the poll refreshes the full one', async () => {
		const tree = provider();
		await tree.refresh();
		tree.applyFilter({ kind: 'done', outcome: { kind: 'matches', checkpoints: [checkpoint(HEX_A, 'three')], otherHits: 0 } });
		await tree.refresh();
		assert.deepStrictEqual(titles(tree), [HEX_A]);
		tree.dispose();
	});
});
