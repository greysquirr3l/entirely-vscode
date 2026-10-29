import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	NO_OWN_SESSION,
	countToolCalls,
	decodeSessionInfo,
	isSessionId,
	ownSessionOnly,
	parseTranscript,
	renderTranscript,
	type Session,
	type SessionInfo,
} from '../lib/entire';
import { MAX_DOCUMENT_CHARACTERS, MAX_MESSAGE_CHARACTERS } from '../lib/entire/transcriptView';
import { openTranscript, selectSession } from '../commands/sessionDetail';
import { SessionDetailProvider } from '../providers/sessionDetailProvider';
import { SessionsProvider } from '../providers/sessionsProvider';
import { TRANSCRIPT_SCHEME, TranscriptContentProvider } from '../providers/transcriptDocument';
import { CliInvocationRecorder } from '../services/cli';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { CliInvocationLogger } from '../services/cliLogging';
import { clampTranscriptTimeout } from '../services/configuration';
import { createLogger } from '../services/logger';
import { SessionDetailService } from '../services/sessionDetail';
import { createSessionSource } from '../services/sessionSource';

/** A marker that appears only inside transcripts and prompts, to catch leaks. */
const SECRET = 'xyzzy-transcript-secret-7731';

const ENDED_INFO = {
	session_id: 'sess-ended',
	agent: 'Copilot CLI',
	model: 'some-vendor/some-model',
	status: 'ended',
	branch: 'main',
	worktree_path: '/work/repo',
	started_at: '2026-10-28T18:13:41.007408-04:00',
	ended_at: '2026-10-29T16:36:15.811262-04:00',
	last_active: '2026-10-29T16:36:15.811264-04:00',
	turns: 2,
	pending_turns: 0,
	checkpoints: 1,
	last_checkpoint_id: '01M64PTWZ4VHQ5XATX937R1E4A',
	tokens: { total: 1200, input: 1000, cache_read: 0, cache_write: 0, output: 200 },
	files_touched: ['src/a.ts', 'src/b.ts'],
	last_prompt: 'hello',
};

/** The list entry for a session: the fields `session list` carries, and no more. */
function listEntry(id: string, status = 'ended'): Record<string, unknown> {
	return {
		session_id: id,
		agent: 'Copilot CLI',
		status,
		worktree_path: '/work/repo',
		branch: 'main',
		turns: 2,
		checkpoints: 1,
		last_prompt: 'hello',
	};
}

/** A Copilot-format transcript with two tool calls and a marker in the prompt. */
const COPILOT_TRANSCRIPT = [
	{ type: 'session.start', data: {} },
	{ type: 'user.message', data: { content: `please look at ${SECRET}` } },
	{
		type: 'assistant.message',
		data: {
			content: 'Looking.',
			toolRequests: [
				{ name: 'view', arguments: { path: '/work/repo/src/a.ts' } },
				{ name: 'bash', arguments: { command: 'npm test' } },
			],
		},
	},
	{ type: 'assistant.message', data: { content: 'Done.', toolRequests: [{ name: 'view', arguments: { path: 'x' } }] } },
]
	.map(event => JSON.stringify(event))
	.join('\n');

interface FakeCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** Every invocation, one line each. */
	invocations(): string[];
}

/** Everything the fake CLI answers with. */
interface FakeAnswers {
	readonly list?: unknown;
	readonly info?: unknown;
	readonly transcript?: string;
	/** Exit status of `session current`; its output is `current`. */
	readonly current?: unknown;
	readonly currentExit?: number;
}

/** A runner bound to a fake CLI that records what it was asked. */
function fakeCli(answers: FakeAnswers): FakeCli {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-detail-'));
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });

	const file = (name: string, content: string): string => {
		const target = path.join(dir, name);
		fs.writeFileSync(target, content, 'utf8');
		return target;
	};

	const log = path.join(dir, 'invocations.log');
	const list = file('list.json', JSON.stringify(answers.list ?? []));
	const info = file('info.json', JSON.stringify(answers.info ?? {}));
	const transcript = file('transcript.jsonl', answers.transcript ?? '');
	const current = file('current.json', JSON.stringify(answers.current ?? null));

	const script = [
		'#!/bin/sh',
		`echo "$@" >> '${log}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2" ;;',
		'\tsession)',
		'\t\tcase "$2" in',
		`\t\t\tlist) cat '${list}' ;;`,
		`\t\t\tcurrent) if [ ${answers.currentExit ?? 0} -ne 0 ]; then echo "no state for this session" >&2; exit ${answers.currentExit ?? 0}; fi; cat '${current}' ;;`,
		'\t\t\tinfo)',
		'\t\t\t\tcase "$4" in',
		`\t\t\t\t\t--json) cat '${info}' ;;`,
		`\t\t\t\t\t--transcript) cat '${transcript}' ;;`,
		'\t\t\t\tesac ;;',
		'\t\t\t*) exit 2 ;;',
		'\t\tesac ;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');

	const binary = path.join(bin, 'entire');
	fs.writeFileSync(binary, `${script}\n`, 'utf8');
	fs.chmodSync(binary, 0o755);

	const locator = new CliLocator({ homeDir: dir, env: { PATH: '' } });
	return {
		runner: new CliRunner(locator),
		dir,
		invocations: () =>
			fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
	};
}

function serviceFor(cli: FakeCli): SessionDetailService {
	return new SessionDetailService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		transcriptTimeoutSeconds: () => 30,
	});
}

function infoOf(overrides: Record<string, unknown> = {}): SessionInfo {
	const decoded = decodeSessionInfo({ ...ENDED_INFO, ...overrides });
	if (!decoded.ok) {
		throw new Error(decoded.issue.detail);
	}
	return decoded.value;
}

suite('Entire session info', () => {
	test('decodes the parts only session info reports', () => {
		const info = infoOf();
		assert.strictEqual(info.id, 'sess-ended');
		assert.strictEqual(info.endedAt?.raw, ENDED_INFO.ended_at);
		assert.strictEqual(info.lastCheckpointId, ENDED_INFO.last_checkpoint_id);
		assert.strictEqual(info.tokens?.total, 1200);
		assert.strictEqual(info.tokens?.cacheRead, 0);
		assert.deepStrictEqual(info.filesTouched, ['src/a.ts', 'src/b.ts']);
		assert.strictEqual(info.model, 'some-vendor/some-model');
	});

	test('decodes a session with none of the optional parts', () => {
		const result = decodeSessionInfo(listEntry('plain'));
		assert.ok(result.ok);
		assert.strictEqual(result.value.endedAt, undefined);
		assert.strictEqual(result.value.tokens, undefined);
		assert.strictEqual(result.value.filesTouched, undefined);
	});

	test('rejects a payload that is not a session', () => {
		assert.strictEqual(decodeSessionInfo('nope').ok, false);
		assert.strictEqual(decodeSessionInfo({ ...ENDED_INFO, files_touched: 4 }).ok, false);
	});

	test('accepts only ids the CLI could have issued', () => {
		assert.ok(isSessionId('9c72fdee-1996-4cd7-8f36-28ac56ad4dd0'));
		assert.ok(!isSessionId('--json'));
		assert.ok(!isSessionId(''));
		assert.ok(!isSessionId('a b'));
	});

	test('clamps the transcript timeout', () => {
		assert.strictEqual(clampTranscriptTimeout(60), 60);
		assert.strictEqual(clampTranscriptTimeout(0), 5);
		assert.strictEqual(clampTranscriptTimeout(99999), 600);
		assert.strictEqual(clampTranscriptTimeout(Number.NaN), 60);
	});
});

suite('Entire transcript reading', () => {
	test('reads messages and tool calls from a Copilot transcript', async () => {
		const transcript = await parseTranscript(COPILOT_TRANSCRIPT);
		const messages = transcript.items.filter(item => item.kind === 'message');
		const tools = transcript.items.filter(item => item.kind === 'tool');
		assert.strictEqual(messages.length, 3);
		assert.strictEqual(tools.length, 3);
		assert.strictEqual(transcript.skippedLines, 1);
		assert.deepStrictEqual(countToolCalls(transcript.items), [
			{ name: 'view', count: 2 },
			{ name: 'bash', count: 1 },
		]);
	});

	test('reads a Claude Code transcript', async () => {
		const lines = [
			{ type: 'user', message: { role: 'user', content: 'fix it' } },
			{
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'On it.' },
						{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } },
					],
				},
			},
			{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
		].map(line => JSON.stringify(line));

		const transcript = await parseTranscript(lines.join('\n'));
		assert.strictEqual(transcript.items.length, 3);
		assert.deepStrictEqual(transcript.items[2], { kind: 'tool', name: 'Read', hint: '/a/b.ts' });
	});

	test('reads a Codex transcript, whose arguments arrive as a JSON string', async () => {
		const lines = [
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
			{ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"ls"}' } },
		].map(line => JSON.stringify(line));

		const transcript = await parseTranscript(lines.join('\n'));
		assert.deepStrictEqual(transcript.items[1], { kind: 'tool', name: 'shell', hint: 'ls' });
	});

	test('keeps a hint to one short line', async () => {
		const long = `${'x'.repeat(500)}\nsecond line`;
		const transcript = await parseTranscript(
			JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: long } }] } }),
		);
		const tool = transcript.items[0];
		assert.ok(tool.kind === 'tool' && tool.hint !== undefined && tool.hint.length <= 120);
		assert.ok(tool.kind === 'tool' && !tool.hint?.includes('second'));
	});

	test('yields to the event loop while reading a long transcript', async () => {
		const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } });
		const text = Array.from({ length: 50 }, () => line).join('\n');

		let ticks = 0;
		const timer = setInterval(() => ticks++, 0);
		try {
			const transcript = await parseTranscript(text, { yieldEvery: 5 });
			assert.strictEqual(transcript.items.length, 50);
			await new Promise(resolve => setTimeout(resolve, 5));
			assert.ok(ticks > 0, 'the timer never ran while the transcript was being read');
		} finally {
			clearInterval(timer);
		}
	});

	test('renders the attribution, the tool calls and the conversation', async () => {
		const transcript = await parseTranscript(COPILOT_TRANSCRIPT);
		const text = renderTranscript(infoOf(), { transcript, raw: '', receivedBytes: 10, truncated: false });

		assert.match(text, /- Agent: Copilot CLI/);
		assert.match(text, /- Model: some-vendor\/some-model/);
		assert.match(text, /- Ended: 2026-10-29/);
		assert.match(text, /- view: 2/);
		assert.match(text, /### User/);
		assert.match(text, /- Tool: bash — npm test/);
		assert.ok(!text.includes('only the first'), 'a whole transcript was called partial');
	});

	test('says so when the transcript was cut short', async () => {
		const transcript = await parseTranscript(COPILOT_TRANSCRIPT);
		const text = renderTranscript(infoOf(), {
			transcript,
			raw: '',
			receivedBytes: 40 * 1024 * 1024,
			truncated: true,
		});
		assert.match(text, /first 40\.0 MB/);
	});

	test('falls back to the raw text for a format it does not know', async () => {
		const raw = '{"weird":true}\nplain words';
		const transcript = await parseTranscript(raw);
		const text = renderTranscript(infoOf(), { transcript, raw, receivedBytes: raw.length, truncated: false });
		assert.match(text, /does not recognise/);
		assert.ok(text.includes('plain words'));
	});

	test('cuts a very long message', async () => {
		const body = 'a'.repeat(MAX_MESSAGE_CHARACTERS + 50);
		const transcript = await parseTranscript(
			JSON.stringify({ type: 'user', message: { role: 'user', content: body } }),
		);
		const text = renderTranscript(infoOf(), { transcript, raw: '', receivedBytes: 1, truncated: false });
		assert.match(text, /50 more characters not shown/);
	});
});

suite('Entire session detail', () => {
	function select(cli: FakeCli): {
		deps: Parameters<typeof selectSession>[0];
		detail: SessionDetailProvider;
		sessions: SessionsProvider;
		dispose: () => void;
	} {
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		const detail = new SessionDetailProvider();
		return {
			deps: { sessions, sessionDetail: detail, detail: serviceFor(cli) },
			detail,
			sessions,
			dispose: () => {
				sessions.dispose();
				detail.dispose();
			},
		};
	}

	function rowsOf(detail: SessionDetailProvider): Record<string, string> {
		const rows: Record<string, string> = {};
		for (const row of detail.getChildren()) {
			if (row.kind === 'field') {
				rows[row.label] = row.value;
			} else if (row.kind === 'text') {
				rows[row.label] = row.summary ?? '';
			}
		}
		return rows;
	}

	test('fetches the selected session through session info, not the list payload', async () => {
		const cli = fakeCli({ info: ENDED_INFO, transcript: COPILOT_TRANSCRIPT });
		const view = select(cli);
		try {
			const listed: Session = {
				id: 'sess-ended',
				agent: 'Copilot CLI',
				status: 'ended',
				worktreePath: '/work/repo',
			};
			await selectSession(view.deps, { kind: 'session', session: listed });

			assert.ok(
				cli.invocations().includes('session info sess-ended --json'),
				`session info was not called: ${cli.invocations().join(' | ')}`,
			);

			// The list payload has no end time, checkpoint or token count.
			const rows = rowsOf(view.detail);
			assert.strictEqual(rows['Ended'], ENDED_INFO.ended_at);
			assert.strictEqual(rows['Last checkpoint'], ENDED_INFO.last_checkpoint_id);
			assert.strictEqual(rows['Tokens'], '1200');
			assert.strictEqual(rows['Files touched'], '2 files');
		} finally {
			view.dispose();
		}
	});

	test('shows the attribution, the tool calls and a link to the transcript', async () => {
		const cli = fakeCli({ info: ENDED_INFO, transcript: COPILOT_TRANSCRIPT });
		const view = select(cli);
		try {
			await selectSession(view.deps, {
				kind: 'session',
				session: { id: 'sess-ended', agent: 'Copilot CLI', status: 'ended', worktreePath: '/w' },
			});

			const rows = rowsOf(view.detail);
			assert.strictEqual(rows['Agent'], 'Copilot CLI');
			assert.strictEqual(rows['Model'], 'some-vendor/some-model');
			assert.strictEqual(rows['Status'], 'Ended');
			assert.strictEqual(rows['Tool calls'], '3');
			assert.strictEqual(rows['Transcript'], 'Open in editor');

			const calls = view.detail.getChildren().find(row => row.kind === 'text' && row.label === 'Tool calls');
			assert.ok(calls);
			const lines = view.detail.getChildren(calls).map(row => (row.kind === 'line' ? row.text : ''));
			assert.deepStrictEqual(lines, ['view × 2', 'bash × 1']);

			const link = view.detail.getChildren().find(row => row.kind === 'field' && row.label === 'Transcript');
			assert.ok(link && link.kind === 'field');
			assert.strictEqual(view.detail.getTreeItem(link).command?.command, 'entirely.openTranscript');
		} finally {
			view.dispose();
		}
	});

	test('can inspect a session that has ended', async () => {
		const cli = fakeCli({ info: ENDED_INFO, transcript: COPILOT_TRANSCRIPT });
		const service = serviceFor(cli);
		const found = await service.info('sess-ended');
		assert.strictEqual(found.kind, 'found');
		assert.strictEqual(found.kind === 'found' && found.info.status, 'ended');

		const transcript = await service.transcript(infoOf());
		assert.strictEqual(transcript.kind, 'loaded');
	});

	test('never passes an id that could be read as a flag', async () => {
		const cli = fakeCli({ info: ENDED_INFO });
		const found = await serviceFor(cli).info('--transcript');
		assert.strictEqual(found.kind, 'failed');
		assert.deepStrictEqual(cli.invocations(), []);
	});

	test('says so in the view when the CLI is missing', async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-detail-none-'));
		const runner = new CliRunner(new CliLocator({ homeDir: empty, env: { PATH: '' } }));
		const detail = new SessionDetailProvider();
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		try {
			await selectSession(
				{
					sessions,
					sessionDetail: detail,
					detail: new SessionDetailService({
						runner,
						workspaceRoot: () => empty,
						transcriptTimeoutSeconds: () => 5,
					}),
				},
				{ kind: 'session', session: { id: 'abc', agent: 'A', status: 'ended', worktreePath: '/w' } },
			);

			const row = detail.getChildren().find(node => node.kind === 'field' && node.label === 'Detail');
			assert.ok(row && row.kind === 'field');
			assert.match(row.tooltip ?? '', /not installed/);
			assert.strictEqual(detail.getChildren().find(node => node.kind === 'field' && node.label === 'Agent') !== undefined, true);
		} finally {
			detail.dispose();
			sessions.dispose();
		}
	});
});

suite('Entire long transcripts', () => {
	/** Eighteen megabytes of transcript, which is more than the extension reads. */
	function hugeTranscript(): string {
		const line = JSON.stringify({ type: 'user', message: { role: 'user', content: `${SECRET} ${'p'.repeat(40)}` } });
		return Array.from({ length: Math.ceil((18 * 1024 * 1024) / (line.length + 1)) }, () => line).join('\n');
	}

	test('opens in a read-only editor and keeps the tree small', async () => {
		const cli = fakeCli({ info: ENDED_INFO, transcript: hugeTranscript() });
		const documents = new TranscriptContentProvider();
		const detail = new SessionDetailProvider();
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		const registration = vscode.workspace.registerTextDocumentContentProvider(TRANSCRIPT_SCHEME, documents);
		const source = serviceFor(cli);
		let opened: vscode.Uri | undefined;

		try {
			await selectSession(
				{ sessions, sessionDetail: detail, detail: source },
				{ kind: 'session', session: { id: 'sess-ended', agent: 'A', status: 'ended', worktreePath: '/w' } },
			);

			const nodes = detail.getChildren();
			assert.ok(nodes.length < 30, `the tree grew to ${nodes.length} rows`);
			for (const node of nodes) {
				const children = detail.getChildren(node);
				for (const child of children) {
					assert.ok(!(child.kind === 'line' && child.text.includes(SECRET)), 'transcript text reached the tree');
				}
				assert.ok(children.length < 30);
			}

			await openTranscript(
				{ sessionDetail: detail, detail: source, documents, show: async uri => { opened = uri; } },
				'sess-ended',
			);

			assert.ok(opened);
			assert.strictEqual(opened.scheme, TRANSCRIPT_SCHEME);

			const document = await vscode.workspace.openTextDocument(opened);
			assert.ok(document.getText().includes(SECRET));
			assert.match(document.getText(), /Only the first/);
			assert.match(document.getText(), /more entries not shown/);
			assert.ok(document.getText().length < MAX_DOCUMENT_CHARACTERS + 200_000);
		} finally {
			registration.dispose();
			documents.dispose();
			detail.dispose();
			sessions.dispose();
		}
	}).timeout(60_000);

	test('reports a transcript the CLI cannot produce', async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-detail-none-'));
		const runner = new CliRunner(new CliLocator({ homeDir: empty, env: { PATH: '' } }));
		const warnings: string[] = [];
		const detail = new SessionDetailProvider();
		const documents = new TranscriptContentProvider();
		try {
			await openTranscript(
				{
					sessionDetail: detail,
					detail: new SessionDetailService({ runner, workspaceRoot: () => empty, transcriptTimeoutSeconds: () => 5 }),
					documents,
					show: async () => assert.fail('nothing should have opened'),
					warn: async message => { warnings.push(message); },
				},
				'abc',
			);
			assert.strictEqual(warnings.length, 1);
			assert.match(warnings[0], /not installed/);
		} finally {
			detail.dispose();
			documents.dispose();
		}
	});

	test('keeps only a few transcripts in memory', () => {
		const documents = new TranscriptContentProvider();
		try {
			const first = documents.set('one', 'first');
			for (const id of ['two', 'three', 'four']) {
				documents.set(id, id);
			}
			assert.strictEqual(documents.provideTextDocumentContent(first), '');
			assert.strictEqual(documents.provideTextDocumentContent(TranscriptContentProvider.uriFor('four')), 'four');
		} finally {
			documents.dispose();
		}
	});
});

suite('Entire transcript privacy', () => {
	test('does not write the transcript or a prompt to the output channel', async () => {
		const cli = fakeCli({ info: ENDED_INFO, transcript: COPILOT_TRANSCRIPT, list: [listEntry('sess-ended')] });
		const lines: string[] = [];
		const channel = { appendLine: (line: string) => void lines.push(line) } as unknown as vscode.OutputChannel;
		const recorder = new CliInvocationRecorder();
		// The loudest level, because the debug level quotes payloads.
		cli.runner.setSink(new CliInvocationLogger(createLogger(channel, () => 'trace'), recorder));

		const documents = new TranscriptContentProvider();
		const detail = new SessionDetailProvider();
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		const source = serviceFor(cli);
		try {
			await selectSession(
				{ sessions, sessionDetail: detail, detail: source },
				{ kind: 'session', session: { id: 'sess-ended', agent: 'A', status: 'ended', worktreePath: '/w' } },
			);
			await openTranscript(
				{ sessionDetail: detail, detail: source, documents, show: async () => undefined },
				'sess-ended',
			);

			const transcriptCall = lines.filter(line => line.includes('--transcript'));
			assert.ok(transcriptCall.length > 0, 'the transcript call was not logged at all');
			assert.ok(!lines.join('\n').includes(SECRET), 'transcript text reached the output channel');
			assert.ok(!(recorder.latestBodies()?.stdout ?? '').includes(SECRET), 'transcript text was kept for the dump command');
			assert.ok(lines.some(line => /stdout \d/.test(line)), 'the size of the payload was not logged');
		} finally {
			documents.dispose();
			detail.dispose();
			sessions.dispose();
		}
	});
});

suite('Entire current-session filter', () => {
	const LIST = [listEntry('mine', 'active'), listEntry('theirs')];

	async function idsWith(
		answers: FakeAnswers,
		ownOnly: boolean,
	): Promise<{ ids: string[]; reason: string | undefined }> {
		const cli = fakeCli({ list: LIST, ...answers });
		const provider = new SessionsProvider(
			createSessionSource(cli.runner, () => cli.dir),
			() => 0,
		);
		try {
			await provider.setOwnSessionOnly(ownOnly);
			const ids = provider
				.getChildren()
				.flatMap(group => provider.getChildren(group))
				.map(node => (node.kind === 'session' ? node.session.id : ''));
			return { ids, reason: provider.emptyReason };
		} finally {
			provider.dispose();
		}
	}

	test('lists only the workspace\'s own session', async () => {
		const own = await idsWith({ current: { ...listEntry('mine', 'active'), resolution: 'worktree' } }, true);
		assert.deepStrictEqual(own.ids, ['mine']);
	});

	test('lists every session when the filter is off', async () => {
		const all = await idsWith({ current: { ...listEntry('mine'), resolution: 'worktree' } }, false);
		assert.deepStrictEqual(all.ids.sort(), ['mine', 'theirs']);
	});

	test('does not offer another worktree\'s session as the workspace\'s own', async () => {
		const result = await idsWith({ current: { ...listEntry('theirs'), resolution: 'other-worktree' } }, true);
		assert.deepStrictEqual(result.ids, []);
		assert.strictEqual(result.reason, NO_OWN_SESSION);
	});

	test('says the workspace has no session when the CLI has no state for one', async () => {
		const result = await idsWith({ currentExit: 1 }, true);
		assert.deepStrictEqual(result.ids, []);
		assert.strictEqual(result.reason, NO_OWN_SESSION);
	});

	test('narrows a list in the domain layer', () => {
		const sessions: Session[] = [
			{ id: 'a', agent: 'x', status: 'active', worktreePath: '/w' },
			{ id: 'b', agent: 'x', status: 'ended', worktreePath: '/w' },
		];
		assert.deepStrictEqual(ownSessionOnly(sessions, sessions[1]).sessions, [sessions[1]]);
		assert.strictEqual(ownSessionOnly(sessions, undefined).emptyReason, NO_OWN_SESSION);
		assert.strictEqual(ownSessionOnly(sessions, { ...sessions[0], id: 'zzz' }).sessions.length, 0);
	});
});
