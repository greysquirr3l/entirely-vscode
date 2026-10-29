import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	answerNamesFile,
	blameArguments,
	decodeBlameAnswer,
	lineAnswerFrom,
	lineState,
	parseRequestedLine,
	planBlameMarks,
	unwrap,
	workspaceRelative,
	type BlameAnswer,
} from '../lib/entire';
import { blameFile, clearBlame } from '../commands/blameFile';
import { makeTempDir } from './support/tempDir';
import { BlameDecorations } from '../providers/blameDecorations';
import { renderWhyBody } from '../providers/whyView';
import { BlameService } from '../services/blameService';
import { CliRunner } from '../services/cli';
import { CliLocator } from '../services/cli/locator';
import { clampBlameMaxLines } from '../services/configuration';
import { WhyService } from '../services/whyService';
import type { CliRunner as CliRunnerType } from '../services/cli';

const ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE = '/work/sandbox';

type Reply = { ok: true; value: unknown } | { ok: false; reason: string; detail: string };

/** A stand-in for the CLI that answers each command from a table. */
class FakeCli {
	readonly calls: { args: readonly string[]; cwd?: string }[] = [];
	readonly replies = new Map<string, Reply>();

	async runJson(
		args: readonly string[],
		decode: (value: unknown) => unknown,
		options: { cwd?: string } = {},
	): Promise<unknown> {
		this.calls.push({ args, cwd: options.cwd });
		const reply = this.replies.get(args[0]);
		if (!reply) {
			return { ok: false, reason: 'failed', detail: `no reply for ${args[0]}` };
		}
		if (!reply.ok) {
			return reply;
		}
		try {
			return { ok: true, value: decode(reply.value), detail: '' };
		} catch (error) {
			return { ok: false, reason: 'invalid-output', detail: String(error) };
		}
	}

	asRunner(): CliRunnerType {
		return this as unknown as CliRunnerType;
	}
}

const CHECKPOINT_LINE = {
	line_number: 1,
	status: 'checkpoint',
	commit_sha: 'a'.repeat(40),
	short_commit_sha: 'aaaaaaaa',
	author: 'A Developer',
	checkpoint_id: 'cp-1',
	session_id: 'sess-1',
	agent: 'Copilot CLI',
	prompt: 'add a token reader',
	content: 'const a = 1;',
};
const UNSYNCED_LINE = {
	line_number: 2,
	status: 'checkpoint',
	short_commit_sha: 'bbbbbbbb',
	checkpoint_id: 'cp-2',
	metadata_missing: true,
	content: 'const b = 2;',
};
const UNRECORDED_LINE = { line_number: 3, status: 'uncommitted', content: 'const c = 3;' };
const COMMIT_LINE = { line_number: 4, status: 'commit', short_commit_sha: 'cccccccc', content: 'x' };

const BLAME_PAYLOAD = {
	file: 'src/auth.ts',
	lines: [CHECKPOINT_LINE, UNSYNCED_LINE, UNRECORDED_LINE, COMMIT_LINE],
	summary: {
		total_lines: 4,
		checkpoint_lines: 2,
		commit_lines: 1,
		uncommitted_lines: 1,
		checkpoint_percentage: 50,
		commit_percentage: 25,
	},
};

function blamed(payload: unknown = BLAME_PAYLOAD): BlameAnswer {
	return unwrap(decodeBlameAnswer(payload));
}

suite('Entire blame: blame-file', () => {
	test('asks the CLI to blame the file, after the end-of-options separator', async () => {
		const cli = new FakeCli();
		cli.replies.set('blame', { ok: true, value: BLAME_PAYLOAD });
		const service = new BlameService({ runner: cli.asRunner(), workspaceRoot: () => WORKSPACE });

		const result = await service.blameFile(path.join(WORKSPACE, 'src', 'auth.ts'));

		assert.strictEqual(result.kind, 'answered');
		assert.deepStrictEqual(cli.calls[0].args, ['blame', '--json', '--', path.join('src', 'auth.ts')]);
		assert.strictEqual(cli.calls[0].cwd, WORKSPACE);
	});

	test('never lets a file name be read as a flag or a line', () => {
		assert.deepStrictEqual(blameArguments('-rf.ts'), ['blame', '--json', '--', '-rf.ts']);
		assert.deepStrictEqual(blameArguments('notes:12'), ['blame', '--json', '--', 'notes:12/']);
	});

	test('attributes each line to the edit that introduced it', () => {
		const plan = planBlameMarks(blamed(), 100);
		assert.strictEqual(plan.kind, 'marks');
		if (plan.kind !== 'marks') {
			return;
		}
		assert.deepStrictEqual(
			plan.marks.map(mark => [mark.line, mark.state]),
			[
				[0, 'attributed'],
				[1, 'unsynced'],
				[2, 'unattributed'],
				[3, 'attributed'],
			],
		);
		assert.match(plan.marks[0].label, /Copilot CLI/);
		assert.ok(plan.marks[0].facts.some(fact => fact.includes('cp-1')));
		assert.ok(plan.marks[0].facts.some(fact => fact.includes('add a token reader')));
	});

	test('renders the whole file through the why renderer', () => {
		const body = renderWhyBody(blamed());
		assert.match(body, /Why does this file look like this\?/);
		assert.match(body, /Distribution/);
		assert.match(body, /Copilot CLI/);
	});

	test('draws nothing on a file longer than the limit', () => {
		const plan = planBlameMarks(blamed(), 3);
		assert.deepStrictEqual(plan, { kind: 'too-long', lines: 4, limit: 3 });
	});

	test('does not ask about a file outside the workspace', async () => {
		const cli = new FakeCli();
		const service = new BlameService({ runner: cli.asRunner(), workspaceRoot: () => WORKSPACE });

		const result = await service.blameFile('/elsewhere/auth.ts');

		assert.strictEqual(result.kind, 'outside-workspace');
		assert.strictEqual(cli.calls.length, 0);
	});

	test('says so when the CLI is not installed', async () => {
		const cli = new FakeCli();
		cli.replies.set('blame', { ok: false, reason: 'absent', detail: 'the Entire CLI is not installed' });
		const service = new BlameService({ runner: cli.asRunner(), workspaceRoot: () => WORKSPACE });

		const result = await service.blameFile(path.join(WORKSPACE, 'a.ts'));

		assert.strictEqual(result.kind, 'cli-missing');
	});

	test('reports a failure and refuses an answer about another file', async () => {
		const cli = new FakeCli();
		const service = new BlameService({ runner: cli.asRunner(), workspaceRoot: () => WORKSPACE });

		cli.replies.set('blame', { ok: false, reason: 'failed', detail: 'unknown command "blame"' });
		const failed = await service.blameFile(path.join(WORKSPACE, 'src', 'auth.ts'));
		assert.strictEqual(failed.kind, 'failed');

		cli.replies.set('blame', { ok: true, value: { ...BLAME_PAYLOAD, file: 'src/other.ts' } });
		const other = await service.blameFile(path.join(WORKSPACE, 'src', 'auth.ts'));
		assert.strictEqual(other.kind, 'failed');
	});

	test('refuses a single-line payload as a blame answer', () => {
		const result = decodeBlameAnswer({ file: 'a.ts', line: CHECKPOINT_LINE });
		assert.strictEqual(result.ok, false);
	});
});

suite('Entire blame: unattributed-line', () => {
	test('marks a line with no recorded change as not attributed', () => {
		const answer = blamed();
		assert.strictEqual(lineState(answer.lines[2]), 'unattributed');

		const body = renderWhyBody({ kind: 'line', file: answer.file, line: answer.lines[2] });
		assert.match(body, /Not attributed to any recorded change/);
		assert.doesNotMatch(body, /not synced/i);
	});
});

suite('Entire blame: unsynced versus unrecorded', () => {
	test('a line whose change has not synced reads differently from a line with no change', () => {
		const answer = blamed();
		const unsynced = answer.lines[1];
		const unrecorded = answer.lines[2];

		assert.strictEqual(lineState(unsynced), 'unsynced');
		assert.strictEqual(lineState(unrecorded), 'unattributed');

		const unsyncedBody = renderWhyBody({ kind: 'line', file: answer.file, line: unsynced });
		const unrecordedBody = renderWhyBody({ kind: 'line', file: answer.file, line: unrecorded });
		assert.match(unsyncedBody, /Recorded change, not synced yet/);
		assert.doesNotMatch(unsyncedBody, /Not attributed to any recorded change/);
		assert.notStrictEqual(unsyncedBody, unrecordedBody);

		const table = renderWhyBody(answer);
		assert.match(table, /Recorded change, not synced yet/);
		assert.match(table, /Not attributed to any recorded change/);

		const plan = planBlameMarks(answer, 100);
		if (plan.kind !== 'marks') {
			assert.fail('expected marks');
			return;
		}
		assert.notStrictEqual(plan.marks[1].label, plan.marks[2].label);
		assert.notStrictEqual(plan.marks[1].state, plan.marks[2].state);
	});
});

suite('Entire blame: inline-blame', () => {
	test('gives the same answer for the cursor line as why-this-line', async () => {
		const cli = new FakeCli();
		cli.replies.set('blame', { ok: true, value: BLAME_PAYLOAD });
		for (const line of BLAME_PAYLOAD.lines) {
			cli.replies.set('why', { ok: true, value: { file: 'src/auth.ts', line } });

			const file = path.join(WORKSPACE, 'src', 'auth.ts');
			const blameResult = await new BlameService({
				runner: cli.asRunner(),
				workspaceRoot: () => WORKSPACE,
			}).blameFile(file);
			const whyResult = await new WhyService({
				runner: cli.asRunner(),
				workspaceRoot: () => WORKSPACE,
			}).explainLine(file, line.line_number);

			assert.strictEqual(blameResult.kind, 'answered');
			assert.strictEqual(whyResult.kind, 'answered');
			if (blameResult.kind !== 'answered' || whyResult.kind !== 'answered') {
				return;
			}

			const fromBlame = lineAnswerFrom(blameResult.answer, line.line_number);
			assert.ok(fromBlame);
			assert.strictEqual(renderWhyBody(fromBlame), renderWhyBody(whyResult.answer));
		}
	});

	test('has no answer for a line the file does not have', () => {
		assert.strictEqual(lineAnswerFrom(blamed(), 99), undefined);
	});

	test('the hover asks the same command as why-this-line, for the same line', () => {
		const source = fs.readFileSync(path.join(ROOT, 'src', 'providers', 'blameDecorations.ts'), 'utf8');
		assert.match(source, /WHY_COMMAND = 'entirely\.whyThisLine'/);
		assert.match(source, /JSON\.stringify\(\[mark\.lineNumber\]\)/);
	});

	test('the blame command shows its answer in the why panel, with no renderer of its own', () => {
		const source = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'blameFile.ts'), 'utf8');
		assert.match(source, /WhyPanel\.show\(result\.answer\)/);
		assert.doesNotMatch(source, /<table|<div|innerHTML/);
	});
});

suite('Entire blame: workspace paths and settings', () => {
	test('keeps a file inside the workspace', () => {
		assert.strictEqual(workspaceRelative('/w', '/w/a/b.ts'), path.join('a', 'b.ts'));
		assert.strictEqual(workspaceRelative('/w', '/w'), undefined);
		assert.strictEqual(workspaceRelative('/w', '/elsewhere/b.ts'), undefined);
		assert.strictEqual(workspaceRelative('/w', '/w/../x/b.ts'), undefined);
	});

	test('rejects only a real parent segment, not a name that starts with two dots', () => {
		assert.strictEqual(workspaceRelative('/w', '/w/..foo.ts'), '..foo.ts');
		assert.strictEqual(workspaceRelative('/w', '/x/y.ts'), undefined);
		assert.strictEqual(workspaceRelative('/w/a', '/w/x.ts'), undefined);
		assert.strictEqual(workspaceRelative('/w/a', '/w'), undefined);
		assert.strictEqual(workspaceRelative('/w', '/w/../x'), undefined);
	});

	test('reads a requested line only when it is a positive whole number', () => {
		assert.strictEqual(parseRequestedLine(7), 7);
		assert.strictEqual(parseRequestedLine(0), undefined);
		assert.strictEqual(parseRequestedLine(-3), undefined);
		assert.strictEqual(parseRequestedLine(2.5), undefined);
		assert.strictEqual(parseRequestedLine(Number.NaN), undefined);
		assert.strictEqual(parseRequestedLine('4'), undefined);
		assert.strictEqual(parseRequestedLine(vscode.Uri.file('/w/a.ts')), undefined);
		assert.strictEqual(parseRequestedLine(undefined), undefined);
	});

	test('matches the answered file by its trailing segments', () => {
		assert.ok(answerNamesFile(path.join('src', 'a.ts'), 'pkg/src/a.ts'));
		assert.ok(!answerNamesFile(path.join('src', 'a.ts'), 'src/b.ts'));
		assert.ok(!answerNamesFile(path.join('src', 'a.ts'), 'a.ts'));
	});

	test('clamps the drawing limit', () => {
		assert.strictEqual(clampBlameMaxLines(5000), 5000);
		assert.strictEqual(clampBlameMaxLines(1), 100);
		assert.strictEqual(clampBlameMaxLines(10_000_000), 100_000);
		assert.strictEqual(clampBlameMaxLines(Number.NaN), 5000);
	});

	test('declares its commands and setting in the manifest', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			contributes: {
				commands: { command: string }[];
				configuration: { properties: Record<string, unknown> };
			};
		};
		const commands = manifest.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('entirely.blameFile'));
		assert.ok(commands.includes('entirely.clearBlame'));
		assert.ok('entirely.blameMaxDecoratedLines' in manifest.contributes.configuration.properties);
	});
});

suite('Entire blame decorations', () => {
	test('draws marks, and drops them when the text changes', async () => {
		const decorations = new BlameDecorations();
		try {
			const document = await vscode.workspace.openTextDocument({ content: 'one\ntwo\nthree\n' });
			const editor = await vscode.window.showTextDocument(document);
			const plan = planBlameMarks(blamed(), 100);
			if (plan.kind !== 'marks') {
				assert.fail('expected marks');
				return;
			}

			decorations.apply(editor, plan.marks);
			assert.ok(decorations.has(document));

			await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'x'));
			assert.ok(!decorations.has(document));
		} finally {
			decorations.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});

	test('words a commit line as committed, not as a recorded change', () => {
		const plan = planBlameMarks(blamed(), 100);
		if (plan.kind !== 'marks') {
			assert.fail('expected marks');
			return;
		}
		assert.ok(plan.marks[3].facts.includes('Committed (no checkpoint recorded)'));
		assert.ok(plan.marks[0].facts.includes('Attributed to a recorded change'));
	});

	test('draws nothing when the file is edited while the CLI is working', async () => {
		const decorations = new BlameDecorations();
		const directory = makeTempDir('entire-race-');
		try {
			const file = path.join(directory, 'a.txt');
			fs.writeFileSync(file, 'one\ntwo\n', 'utf8');
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const editor = await vscode.window.showTextDocument(document);
			const blame = {
				blameFile: async () => {
					await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'x'));
					return { kind: 'answered', answer: blamed() };
				},
			} as unknown as BlameService;

			await Promise.race([
				blameFile({ blame, decorations, maxDecoratedLines: () => 100 }),
				new Promise(resolve => setTimeout(resolve, 1500)),
			]);

			assert.ok(!decorations.has(document));
		} finally {
			decorations.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('clears the active editor on request', async () => {
		const decorations = new BlameDecorations();
		try {
			const document = await vscode.workspace.openTextDocument({ content: 'one\ntwo\n' });
			const editor = await vscode.window.showTextDocument(document);
			decorations.apply(editor, []);
			assert.ok(decorations.has(document));

			clearBlame(decorations);
			assert.ok(!decorations.has(document));
		} finally {
			decorations.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});
});

suite('Entire blame against the real CLI', function () {
	this.timeout(60_000);
	let directory: string | undefined;

	suiteTeardown(() => {
		if (directory) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('attributes committed lines and marks an uncommitted line as not attributed', async function (this: Mocha.Context) {
		const locator = new CliLocator();
		if ((await locator.current()).state !== 'available') {
			this.skip();
		}
		const runner = new CliRunner(locator);

		directory = makeTempDir('entire-blame-');
		execFileSync('git', ['init', '--quiet'], { cwd: directory });
		execFileSync('git', ['config', 'user.name', 'T'], { cwd: directory });
		execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: directory });
		fs.writeFileSync(path.join(directory, 'file.txt'), 'one\ntwo\n', 'utf8');
		execFileSync('git', ['add', '--all'], { cwd: directory });
		execFileSync(
			'git',
			['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'start'],
			{ cwd: directory },
		);
		fs.appendFileSync(path.join(directory, 'file.txt'), 'three\n', 'utf8');

		const workspace = directory;
		const result = await new BlameService({ runner, workspaceRoot: () => workspace }).blameFile(
			path.join(workspace, 'file.txt'),
		);

		assert.strictEqual(result.kind, 'answered');
		if (result.kind !== 'answered') {
			return;
		}
		assert.deepStrictEqual(
			result.answer.lines.map(line => lineState(line)),
			['attributed', 'attributed', 'unattributed'],
		);
	});
});
