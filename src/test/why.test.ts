import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { decodeWhyAnswer, unwrap } from '../lib/entire';
import { renderWhyBody } from '../providers/whyView';
import { WhyService } from '../services/whyService';
import type { CliRunner } from '../services/cli';

/** A runner that records what it was asked to run. */
class RecordingRunner {
	readonly calls: { args: readonly string[]; cwd?: string }[] = [];
	/** What the runner answers with. */
	answer: unknown = {};
	/** What the runner reports when it fails. */
	failure: string | undefined;

	async runJson(
		args: readonly string[],
		_decode: (value: unknown) => unknown,
		options: { cwd?: string } = {},
	): Promise<{ ok: boolean; value?: unknown; detail: string }> {
		this.calls.push({ args, cwd: options.cwd });

		if (this.failure) {
			return { ok: false, detail: this.failure };
		}

		return { ok: true, value: this.answer, detail: '' };
	}

	/** The runner, as the service takes it. */
	asRunner(): CliRunner {
		return this as unknown as CliRunner;
	}
}

const ROOT = path.resolve(__dirname, '..', '..');

suite('Entire why decoding', () => {
	test('decodes the answer about a single line', () => {
		const answer = unwrap(
			decodeWhyAnswer({
				file: 'src/auth.ts',
				line: {
					line_number: 42,
					status: 'commit',
					commit_sha: 'a'.repeat(40),
					short_commit_sha: 'aaaaaaaa',
					author: 'A Developer',
					author_time: '2026-10-27T00:00:00Z',
					content: 'const token = read();',
				},
			}),
		);

		assert.strictEqual(answer.kind, 'line');
		if (answer.kind !== 'line') {
			return;
		}
		assert.strictEqual(answer.file, 'src/auth.ts');
		assert.strictEqual(answer.line.lineNumber, 42);
		assert.strictEqual(answer.line.attribution, 'commit');
		assert.strictEqual(answer.line.author, 'A Developer');
		assert.strictEqual(answer.line.content, 'const token = read();');
	});

	test('decodes the answer about a whole file', () => {
		const answer = unwrap(
			decodeWhyAnswer({
				file: 'src/auth.ts',
				lines: [
					{ line_number: 1, status: 'commit' },
					{ line_number: 2, status: 'checkpoint', checkpoint_id: 'cp-1' },
					{ line_number: 3, status: 'uncommitted' },
				],
				summary: {
					total_lines: 3,
					checkpoint_lines: 1,
					commit_lines: 1,
					uncommitted_lines: 1,
					checkpoint_percentage: 33,
					commit_percentage: 33,
				},
			}),
		);

		assert.strictEqual(answer.kind, 'file');
		if (answer.kind !== 'file') {
			return;
		}
		assert.strictEqual(answer.lines.length, 3);
		assert.strictEqual(answer.summary.totalLines, 3);
		assert.strictEqual(answer.summary.checkpointLines, 1);
	});

	test('decodes a checkpoint line with its session, agent and prompt', () => {
		const answer = unwrap(
			decodeWhyAnswer({
				file: 'src/auth.ts',
				line: {
					line_number: 42,
					status: 'checkpoint',
					checkpoint_id: 'cp-1',
					session_id: 'sess-1',
					agent: 'Copilot CLI',
					prompt: 'fix the token handling',
					metadata_missing: true,
					metadata_missing_reason: 'the checkpoint body is not available locally',
					candidates: [
						{
							checkpoint_id: 'cp-1',
							session_id: 'sess-1',
							agent: 'Copilot CLI',
							prompt: 'fix the token handling',
							files_touched: ['src/auth.ts'],
						},
					],
				},
			}),
		);

		if (answer.kind !== 'line') {
			assert.fail('the answer is not about a line');
			return;
		}

		assert.strictEqual(answer.line.attribution, 'checkpoint');
		assert.strictEqual(answer.line.checkpointId, 'cp-1');
		assert.strictEqual(answer.line.sessionId, 'sess-1');
		assert.strictEqual(answer.line.agent, 'Copilot CLI');
		assert.strictEqual(answer.line.prompt, 'fix the token handling');
		assert.strictEqual(answer.line.metadataMissing, true);
		assert.strictEqual(answer.line.candidates.length, 1);
		assert.strictEqual(answer.line.candidates[0].checkpointId, 'cp-1');
	});

	test('reports a payload that is neither shape as a failure', () => {
		const result = decodeWhyAnswer({ nothing: true });
		assert.strictEqual(result.ok, false);
	});
});

suite('Entire why rendering', () => {
	test('shows the session, the checkpoint and the agent', () => {
		const body = renderWhyBody({
			kind: 'line',
			file: 'src/auth.ts',
			line: {
				lineNumber: 42,
				attribution: 'checkpoint',
				checkpointId: 'cp-1',
				sessionId: 'sess-1',
				agent: 'Copilot CLI',
				prompt: 'fix the token handling',
				content: 'const token = read();',
				candidates: [],
			},
		});

		assert.match(body, /cp-1/);
		assert.match(body, /sess-1/);
		assert.match(body, /Copilot CLI/);
		assert.match(body, /fix the token handling/);
	});

	test('says plainly that a line is not attributed', () => {
		const body = renderWhyBody({
			kind: 'line',
			file: 'src/auth.ts',
			line: {
				lineNumber: 42,
				attribution: 'uncommitted',
				content: 'const token = read();',
				candidates: [],
			},
		});

		assert.match(body, /Not attributed/);
		assert.doesNotMatch(body, /A checkpoint/);
	});

	test('does not guess at a line nothing accounts for', () => {
		const body = renderWhyBody({
			kind: 'line',
			file: 'src/auth.ts',
			line: {
				lineNumber: 42,
				attribution: 'uncommitted',
				candidates: [],
			},
		});

		assert.doesNotMatch(body, /<strong>A commit/);
	});

	test('shows the distribution of a whole file', () => {
		const body = renderWhyBody({
			kind: 'file',
			file: 'src/auth.ts',
			lines: [
				{ lineNumber: 1, attribution: 'commit', candidates: [] },
				{ lineNumber: 2, attribution: 'checkpoint', candidates: [] },
			],
			summary: {
				totalLines: 2,
				checkpointLines: 1,
				commitLines: 1,
				uncommittedLines: 0,
				checkpointPercentage: 50,
				commitPercentage: 50,
			},
		});

		assert.match(body, /Distribution/);
		assert.match(body, /1 checkpoint \(50%\)/);
	});

	test('escapes text that came from a repository', () => {
		const body = renderWhyBody({
			kind: 'line',
			file: 'src/<script>.ts',
			line: {
				lineNumber: 1,
				attribution: 'commit',
				content: 'const a = "<img src=x onerror=alert(1)>";',
				candidates: [],
			},
		});

		// The tags are matched without regard to case, because a tag in
		// any case is a tag, and an assertion that only matched the
		// lower case would pass for an escape that left the rest alone.
		assert.doesNotMatch(body, /<script>/i);
		assert.doesNotMatch(body, /<img src=x/i);
		assert.match(body, /&lt;script&gt;/);
	});

	test('escapes a tag whatever case it is written in', () => {
		const body = renderWhyBody({
			kind: 'line',
			file: 'src/<SCRIPT>.ts',
			line: {
				lineNumber: 1,
				attribution: 'commit',
				content: 'const a = "<IMG SRC=x ONERROR=alert(1)>";',
				candidates: [],
			},
		});

		assert.doesNotMatch(body, /<script>/i);
		assert.doesNotMatch(body, /<img src=x/i);
		assert.match(body, /&lt;SCRIPT&gt;/);
		assert.match(body, /&lt;IMG SRC=x/);
	});
});

suite('Entire why command', () => {
	test('asks the CLI about the cursor line', async () => {
		const runner = new RecordingRunner();
		runner.answer = {
			file: 'src/auth.ts',
			line: { line_number: 42, status: 'commit' },
		};

		const service = new WhyService({
			runner: runner.asRunner(),
			workspaceRoot: () => '/work/sandbox',
		});

		const result = await service.explainLine('/work/sandbox/src/auth.ts', 42);

		assert.strictEqual(result.kind, 'answered');
		assert.deepStrictEqual(runner.calls[0].args, [
			'why',
			'--json',
			'--line',
			'42',
			'--',
			path.join('src', 'auth.ts'),
		]);
		assert.strictEqual(runner.calls[0].cwd, '/work/sandbox');
	});

	test('asks about a whole file without a line', async () => {
		const runner = new RecordingRunner();
		runner.answer = { file: 'src/auth.ts', lines: [], summary: {} };

		const service = new WhyService({
			runner: runner.asRunner(),
			workspaceRoot: () => '/work/sandbox',
		});

		await service.explainFile('/work/sandbox/src/auth.ts');

		assert.deepStrictEqual(runner.calls[0].args, [
			'why',
			'--json',
			'--',
			path.join('src', 'auth.ts'),
		]);
	});

	test('does not ask about a file outside the workspace', async () => {
		const runner = new RecordingRunner();

		const service = new WhyService({
			runner: runner.asRunner(),
			workspaceRoot: () => '/work/sandbox',
		});

		const result = await service.explainLine('/elsewhere/auth.ts', 1);

		assert.strictEqual(result.kind, 'outside-workspace');
		assert.strictEqual(runner.calls.length, 0);
	});

	test('reports a failure rather than guessing', async () => {
		const runner = new RecordingRunner();
		runner.failure = 'the command exited with code 1';

		const service = new WhyService({
			runner: runner.asRunner(),
			workspaceRoot: () => '/work/sandbox',
		});

		const result = await service.explainLine('/work/sandbox/src/auth.ts', 42);

		assert.strictEqual(result.kind, 'failed');
		if (result.kind !== 'failed') {
			return;
		}
		assert.match(result.detail, /exited with code 1/);
	});
});

suite('Entire why command registration', () => {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
	) as {
		contributes: {
			commands: { command: string }[];
			menus: {
				commandPalette: { command: string; when: string }[];
				'editor/context'?: { command: string; when?: string }[];
			};
		};
	};

	test('is in the command palette', () => {
		const contributed = manifest.contributes.commands.some(
			command => command.command === 'entirely.whyThisLine',
		);
		assert.ok(contributed, 'the command is not contributed');

		const hidden = manifest.contributes.menus.commandPalette.some(
			entry => entry.command === 'entirely.whyThisLine' && entry.when === 'false',
		);
		assert.ok(!hidden, 'the command is hidden from the palette');
	});

	test('is in the editor context menu', () => {
		const entries = manifest.contributes.menus['editor/context'] ?? [];
		const entry = entries.find(candidate => candidate.command === 'entirely.whyThisLine');
		assert.ok(entry, 'the command is not in the editor context menu');
	});
});
