import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	NOT_RECOGNISED,
	NOT_REPORTED,
	buildSessionDetail,
	decodeCheckpoint,
	decodeTokenReport,
	describeTokenReport,
	type Selection,
	type TokenReport,
} from '../lib/entire';
import { selectSessionInto as selectSession } from './support/legacySelect';
import { makeTempDir } from './support/tempDir';
import { CheckpointsProvider, describeCheckpointUsage } from '../providers/checkpointsProvider';
import { SessionDetailProvider } from '../providers/sessionDetailProvider';
import { SessionsProvider } from '../providers/sessionsProvider';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { SessionDetailService } from '../services/sessionDetail';
import { TokenUsageService, type TokenUsageSource } from '../services/tokenUsage';

const CHECKPOINT_ID = '01M64PTWZ4VHQ5XATX937R1E4A';

/** Counts as `entire session tokens --json` sends them. */
const SESSION_WITH_USAGE = {
	session_id: 'sess-1',
	agent: 'Copilot CLI',
	model: 'acme-labs/Unheard-Of-Model-7b',
	status: 'ended',
	source: 'session_state',
	tokens: { total: 44342, input: 22133, cache_read: 8163, cache_write: 13967, output: 79, api_calls: 1574 },
	recommendations: [],
};

/** What the CLI sends when it recorded nothing: there is no `tokens` block. */
const SESSION_WITHOUT_USAGE = {
	session_id: 'sess-2',
	agent: 'Copilot CLI',
	model: 'acme-labs/Unheard-Of-Model-7b',
	status: 'ended',
	source: 'session_state',
	recommendations: [{ id: 'no-token-data', severity: 'low', message: 'x', signals: ['missing_token_usage'] }],
	limitations: ['No token usage recorded for this session.'],
};

const CHECKPOINT_WITH_USAGE = {
	checkpoint_id: CHECKPOINT_ID,
	session_count: 2,
	agent: 'Copilot CLI',
	model: 'first/Model-A',
	models: ['first/Model-A', 'second/model-b:latest'],
	source: 'committed_checkpoint',
	tokens: {
		total: 1000,
		input: 600,
		output: 100,
		cache_read: 0,
		api_call_count: 12,
		subagent_tokens: 300,
		subagent_tokens_complete: false,
	},
};

function reportOf(value: unknown, key: 'session_id' | 'checkpoint_id' = 'session_id'): TokenReport {
	const decoded = decodeTokenReport(value, key);
	if (!decoded.ok) {
		throw new Error(decoded.issue.detail);
	}
	return decoded.value;
}

function valueOf(report: TokenReport, label: string): string | undefined {
	return describeTokenReport(report).lines.find(line => line.label === label)?.value;
}

interface FakeCli {
	readonly runner: CliRunner;
	readonly dir: string;
	invocations(): string[];
}

/** A runner bound to a fake CLI that answers the two tokens commands. */
function fakeCli(answers: { session?: unknown; checkpoint?: unknown }): FakeCli {
	const dir = makeTempDir('entire-tokens-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });

	const log = path.join(dir, 'invocations.log');
	const write = (name: string, value: unknown): string => {
		const target = path.join(dir, name);
		fs.writeFileSync(target, JSON.stringify(value ?? {}), 'utf8');
		return target;
	};
	const session = write('session.json', answers.session);
	const checkpoint = write('checkpoint.json', answers.checkpoint);
	const info = write('info.json', {
		session_id: 'sess-1',
		agent: 'Copilot CLI',
		status: 'ended',
		worktree_path: '/w',
	});

	const script = [
		'#!/bin/sh',
		`echo "$@" >> '${log}'`,
		'case "$1 $2" in',
		'\t"version "*) echo "entire 0.12.2" ;;',
		`\t"session tokens") cat '${session}' ;;`,
		`\t"checkpoint tokens") cat '${checkpoint}' ;;`,
		`\t"session info") case "$4" in --json) cat '${info}' ;; *) exit 0 ;; esac ;;`,
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');

	const binary = path.join(bin, 'entire');
	fs.writeFileSync(binary, `${script}\n`, 'utf8');
	fs.chmodSync(binary, 0o755);

	return {
		runner: new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } })),
		dir,
		invocations: () =>
			fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
	};
}

function serviceFor(cli: FakeCli): TokenUsageService {
	return new TokenUsageService({ runner: cli.runner, workspaceRoot: () => cli.dir });
}

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error('timed out waiting for the view');
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

suite('Entire token usage decoding', () => {
	test('reads every count the CLI sends', () => {
		const report = reportOf(SESSION_WITH_USAGE);
		assert.deepStrictEqual(report.usage, {
			total: 44342,
			input: 22133,
			output: 79,
			cacheRead: 8163,
			cacheWrite: 13967,
			apiCalls: 1574,
			subagentTokens: undefined,
			subagentTokensComplete: undefined,
		});
		assert.strictEqual(describeTokenReport(report).summary, '44,342 tokens');
	});

	test('a report with no tokens block is not reported, never zero', () => {
		const report = reportOf(SESSION_WITHOUT_USAGE);
		assert.strictEqual(report.usage, undefined);

		const view = describeTokenReport(report);
		assert.strictEqual(view.reported, false);
		assert.strictEqual(view.summary, NOT_REPORTED);
		assert.ok(!/\b0\b/.test(view.summary));
		assert.deepStrictEqual(view.lines, [
			{ label: 'Note', value: 'No token usage recorded for this session.' },
		]);
	});

	test('an empty or unreadable tokens block is also not reported', () => {
		assert.strictEqual(reportOf({ ...SESSION_WITHOUT_USAGE, tokens: {} }).usage, undefined);
		assert.strictEqual(
			reportOf({ ...SESSION_WITHOUT_USAGE, tokens: { total: 'many' } }).usage,
			undefined,
		);
		assert.strictEqual(reportOf({ ...SESSION_WITHOUT_USAGE, tokens: null }).usage, undefined);
	});

	test('a tokens block with content but no recognised field is not recognised, not absent', () => {
		const report = reportOf({ ...SESSION_WITHOUT_USAGE, tokens: { prompt_tokens: 5, window: 'big' } });
		assert.strictEqual(report.usage, undefined);
		assert.strictEqual(report.usageUnrecognised, true);

		const view = describeTokenReport(report);
		assert.strictEqual(view.summary, NOT_RECOGNISED);
		assert.strictEqual(view.reported, false);
		assert.notStrictEqual(NOT_RECOGNISED, NOT_REPORTED);

		for (const absent of [undefined, null, {}]) {
			const none = reportOf({ ...SESSION_WITHOUT_USAGE, tokens: absent });
			assert.strictEqual(none.usageUnrecognised, false);
			assert.strictEqual(describeTokenReport(none).summary, NOT_REPORTED);
		}
	});

	test('a missing field says so, and a real zero stays a zero', () => {
		const report = reportOf({
			session_id: 's',
			tokens: { total: 50, input: 50, cache_read: 0 },
		});
		assert.strictEqual(valueOf(report, 'Input'), '50');
		assert.strictEqual(valueOf(report, 'Cache read'), '0');
		assert.strictEqual(valueOf(report, 'Output'), NOT_REPORTED);
		assert.strictEqual(valueOf(report, 'Cache write'), NOT_REPORTED);
		assert.strictEqual(valueOf(report, 'API calls'), NOT_REPORTED);
	});

	test('a block without a total says the total is not reported', () => {
		const report = reportOf({ session_id: 's', tokens: { input: 5 } });
		assert.strictEqual(valueOf(report, 'Total'), NOT_REPORTED);
		assert.ok(!describeTokenReport(report).summary.startsWith('0'));
	});

	test('reads a checkpoint report and flags incomplete subagent counts', () => {
		const report = reportOf(CHECKPOINT_WITH_USAGE, 'checkpoint_id');
		assert.strictEqual(report.id, CHECKPOINT_ID);
		assert.strictEqual(report.usage?.apiCalls, 12);
		assert.strictEqual(valueOf(report, 'Subagents'), '300 (incomplete)');
	});

	test('keeps a model it has never heard of as the string the CLI sent', () => {
		const report = reportOf(CHECKPOINT_WITH_USAGE, 'checkpoint_id');
		assert.deepStrictEqual(report.models, ['first/Model-A', 'second/model-b:latest']);
		assert.strictEqual(valueOf(report, 'Models'), 'first/Model-A, second/model-b:latest');

		const single = reportOf(SESSION_WITH_USAGE);
		assert.deepStrictEqual(single.models, ['acme-labs/Unheard-Of-Model-7b']);
	});

	test('rejects a payload that is not a report', () => {
		assert.strictEqual(decodeTokenReport('nope', 'session_id').ok, false);
		assert.strictEqual(decodeTokenReport({ tokens: {} }, 'session_id').ok, false);
		assert.strictEqual(decodeTokenReport({ session_id: 's' }, 'checkpoint_id').ok, false);
	});

	test('no source file names a model, a provider or a context window', () => {
		// A tripwire, not proof. The Claude Code transcript parser names the
		// format it reads, so that one file is exempt from the `claude` word only.
		const transcriptFormats = path.join('lib', 'entire', 'transcript.ts');
		const root = path.resolve(__dirname, '..', '..', 'src');
		const found: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== 'test') {
						walk(full);
					}
				} else if (entry.name.endsWith('.ts')) {
					const text = fs.readFileSync(full, 'utf8');
					const names =
						/\b(gpt-?\d|gemini|llama|mistral|sonnet|opus|haiku|anthropic|openai|context[ _-]?window)\b/i;
					const claude = full.endsWith(transcriptFormats) ? false : /\bclaude\b/i.test(text);
					if (names.test(text) || claude) {
						found.push(full);
					}
				}
			}
		};
		walk(root);
		assert.deepStrictEqual(found, []);
	});
});

suite('Entire token usage service', () => {
	test('asks the CLI for a session by id, after the end-of-options marker', async () => {
		const cli = fakeCli({ session: SESSION_WITH_USAGE });
		const result = await serviceFor(cli).session('sess-1');

		assert.strictEqual(result.kind, 'found');
		assert.ok(
			cli.invocations().includes('session tokens --json -- sess-1'),
			cli.invocations().join(' | '),
		);
		assert.strictEqual(result.kind === 'found' ? result.report.usage?.total : -1, 44342);
	});

	test('asks the CLI for a checkpoint by id', async () => {
		const cli = fakeCli({ checkpoint: CHECKPOINT_WITH_USAGE });
		const result = await serviceFor(cli).checkpoint(CHECKPOINT_ID);

		assert.strictEqual(result.kind, 'found');
		assert.ok(cli.invocations().includes(`checkpoint tokens --json -- ${CHECKPOINT_ID}`));
	});

	test('does not hand the CLI an id it could not have issued', async () => {
		const cli = fakeCli({});
		const service = serviceFor(cli);
		assert.strictEqual((await service.session('--json')).kind, 'failed');
		assert.strictEqual((await service.checkpoint('--json')).kind, 'failed');
		assert.strictEqual((await service.checkpoint('not-an-id')).kind, 'failed');
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('fails with an explanation when the CLI is missing', async () => {
		const empty = makeTempDir('entire-tokens-none-');
		const runner = new CliRunner(new CliLocator({ homeDir: empty, env: { PATH: '' } }));
		const service = new TokenUsageService({ runner, workspaceRoot: () => empty });

		const session = await service.session('sess-1');
		const checkpoint = await service.checkpoint(CHECKPOINT_ID);
		assert.strictEqual(session.kind, 'failed');
		assert.strictEqual(checkpoint.kind, 'failed');
		assert.ok(session.kind === 'failed' && session.detail.length > 0);
	});
});

suite('Entire session usage view', () => {
	function select(cli: FakeCli): {
		run: (id: string) => Promise<void>;
		detail: SessionDetailProvider;
		dispose: () => void;
	} {
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		const detail = new SessionDetailProvider();
		return {
			run: id =>
				selectSession(
					{
						sessions,
						sessionDetail: detail,
						detail: new SessionDetailService({
							runner: cli.runner,
							workspaceRoot: () => cli.dir,
							transcriptTimeoutSeconds: () => 5,
						}),
						usage: serviceFor(cli),
					},
					{ kind: 'session', session: { id, agent: 'Copilot CLI', status: 'ended', worktreePath: '/w' } },
				),
			detail,
			dispose: () => {
				sessions.dispose();
				detail.dispose();
			},
		};
	}

	test('shows the session usage when a session is selected', async () => {
		const cli = fakeCli({ session: SESSION_WITH_USAGE });
		const view = select(cli);
		try {
			await view.run('sess-1');

			assert.ok(cli.invocations().includes('session tokens --json -- sess-1'));
			const row = view.detail.getChildren().find(node => node.kind === 'text' && node.label === 'Tokens');
			assert.ok(row && row.kind === 'text');
			assert.strictEqual(row.summary, '44,342 tokens');

			const lines = view.detail.getChildren(row).map(node => (node.kind === 'line' ? node.text : ''));
			assert.ok(lines.includes('Input: 22,133'));
			assert.ok(lines.includes('Cache read: 8,163'));
			assert.ok(lines.includes('Output: 79'));
		} finally {
			view.dispose();
		}
	});

	test('says the usage is not reported when the CLI sends none', async () => {
		const cli = fakeCli({ session: SESSION_WITHOUT_USAGE });
		const view = select(cli);
		try {
			await view.run('sess-2');

			const row = view.detail.getChildren().find(node => node.kind === 'field' && node.label === 'Tokens');
			assert.ok(row && row.kind === 'field');
			assert.strictEqual(row.value, NOT_REPORTED);
			assert.notStrictEqual(row.value, '0');
			assert.strictEqual(row.tooltip, 'No token usage recorded for this session.');
		} finally {
			view.dispose();
		}
	});

	test('says the usage is not available when selecting a session whose tokens command fails', async () => {
		// The fake CLI has no answer for `session tokens` once the case is removed.
		const cli = fakeCli({ session: SESSION_WITH_USAGE });
		fs.writeFileSync(
			path.join(cli.dir, '.local', 'bin', 'entire'),
			[
				'#!/bin/sh',
				'case "$1 $2" in',
				'\t"version "*) echo "entire 0.12.2" ;;',
				`\t"session info") echo '{"session_id":"sess-1","agent":"A","status":"ended","worktree_path":"/w"}' ;;`,
				'\t*) echo "boom" >&2; exit 1 ;;',
				'esac',
			].join('\n') + '\n',
			'utf8',
		);
		const view = select(cli);
		try {
			await view.run('sess-1');
			const row = view.detail.getChildren().find(node => node.kind === 'field' && node.label === 'Tokens');
			assert.ok(row && row.kind === 'field');
			assert.strictEqual(row.value, 'Not available');
			assert.notStrictEqual(row.value, '0');
		} finally {
			view.dispose();
		}
	});

	test('says the usage is unavailable when the tokens command fails', async () => {
		const cli = fakeCli({});
		const view = select(cli);
		try {
			const broken = new SessionDetailProvider();
			const listed = { id: 'sess-1', agent: 'A', status: 'ended', worktreePath: '/w' };
			const selection: Selection = { kind: 'session', session: listed };
			broken.render({
				kind: 'ready',
				selection,
				model: buildSessionDetail(selection, { session: listed, usage: { kind: 'failed', detail: 'boom' } }),
			});
			const row = broken.getChildren().find(node => node.kind === 'field' && node.label === 'Tokens');
			assert.ok(row && row.kind === 'field');
			assert.strictEqual(row.value, 'Not available');
			assert.strictEqual(row.tooltip, 'boom');
			broken.dispose();
		} finally {
			view.dispose();
		}
	});
});

suite('Entire checkpoint usage view', () => {
	const LISTED = {
		checkpoint_id: CHECKPOINT_ID,
		date: '2026-10-26T23:34:45Z',
		session_count: 1,
	};

	async function usageRow(source: TokenUsageSource) {
		const decoded = decodeCheckpoint(LISTED);
		if (!decoded.ok) {
			throw new Error('bad fixture');
		}
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decoded.value] }),
			async id => ({ id, filesTouched: ['a.ts'], sessionCount: 1, sessions: [], partial: false }),
			() => 0,
			source,
		);
		try {
			await provider.refresh();
			const checkpoint = provider.getChildren()[0];
			provider.getChildren(checkpoint);
			await waitFor(() => provider.getChildren(checkpoint).some(node => node.kind === 'file'));
			const children = provider.getChildren(checkpoint);
			const node = children.find(child => child.kind === 'usage');
			assert.ok(node, 'no usage row under the checkpoint');
			return { item: provider.getTreeItem(node), children };
		} finally {
			provider.dispose();
		}
	}

	test('shows the usage under an opened checkpoint, ahead of its files', async () => {
		const cli = fakeCli({ checkpoint: CHECKPOINT_WITH_USAGE });
		const { item, children } = await usageRow(serviceFor(cli));

		assert.strictEqual(item.label, 'Tokens');
		assert.strictEqual(item.description, '1,000 tokens');
		assert.strictEqual(children[0].kind, 'usage');
		const tooltip = String(item.tooltip);
		assert.ok(tooltip.includes('Input: 600'));
		assert.ok(tooltip.includes('Cache read: 0'));
		assert.ok(tooltip.includes('Cache write: Not reported'));
		assert.ok(tooltip.includes('second/model-b:latest'));
	});

	test('says the usage is not reported when the checkpoint has none', async () => {
		const cli = fakeCli({
			checkpoint: {
				checkpoint_id: CHECKPOINT_ID,
				models: ['some/model'],
				limitations: ['No token usage recorded for this checkpoint.'],
			},
		});
		const { item } = await usageRow(serviceFor(cli));

		assert.strictEqual(item.description, NOT_REPORTED);
		assert.ok(String(item.tooltip).includes('No token usage recorded for this checkpoint.'));
	});

	test('reads checkpoint usage only when a checkpoint is expanded, and once', async () => {
		const decoded = decodeCheckpoint(LISTED);
		if (!decoded.ok) {
			throw new Error('bad fixture');
		}
		const cli = fakeCli({ checkpoint: CHECKPOINT_WITH_USAGE });
		const provider = new CheckpointsProvider(
			async () => ({ checkpoints: [decoded.value] }),
			async id => ({ id, filesTouched: ['a.ts'], sessionCount: 1, sessions: [], partial: false }),
			() => 0,
			serviceFor(cli),
		);
		const tokenRuns = (): number =>
			cli.invocations().filter(line => line.startsWith('checkpoint tokens')).length;
		try {
			await provider.refresh();
			const checkpoint = provider.getChildren()[0];
			assert.strictEqual(tokenRuns(), 0);

			provider.getChildren(checkpoint);
			await waitFor(() => provider.getChildren(checkpoint).some(node => node.kind === 'usage'));
			await waitFor(() => provider.getChildren(checkpoint).some(node => node.kind === 'file'));
			assert.strictEqual(tokenRuns(), 1);

			provider.getChildren(checkpoint);
			provider.getChildren(checkpoint);
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.strictEqual(tokenRuns(), 1);
		} finally {
			provider.dispose();
		}
	});

	test('says the usage is not available when the CLI fails', () => {
		const view = describeCheckpointUsage({ kind: 'failed', detail: 'the CLI is not installed' });
		assert.strictEqual(view.description, 'Not available');
		assert.strictEqual(view.tooltip, 'the CLI is not installed');
		assert.strictEqual(describeCheckpointUsage({ kind: 'loading' }).description, 'Reading…');
	});
});
