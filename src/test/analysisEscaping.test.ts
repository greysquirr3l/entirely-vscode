import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	classifyExpertsFailure,
	decodeExperts,
	decodeReviewConfig,
	decodeTokenProfile,
	describeEmptyExperts,
	describeExperts,
	describeProfile,
	describeReviewConfig,
	repositoryFileToAbsolute,
	type ExpertsContext,
} from '../lib/entire';
import { expertsForPath } from '../commands/experts';
import { runReview } from '../commands/review';
import { GeneratedLinks } from '../providers/generatedLinks';
import { ReviewService } from '../services/review';
import { ExpertsService } from '../services/experts';
import { ALICE, fakeAnalysisCli } from './support/analysisCli';
import { FakeReviewUi, fakeLauncher } from './support/reviewHarness';

/** Values a hostile CLI, server or checkout could send. */
const HOSTILE = [
	'[x](command:workbench.action.quit)',
	'<command:workbench.action.quit>',
	'`x`',
	'*bold*',
	'ok\n# Injected heading\n- injected item\n[y](command:workbench.action.quit)',
];

function assertInert(text: string, value: string): void {
	assert.ok(!/\]\(command:/.test(text), `a live command link survived in:\n${text}`);
	assert.ok(!/<command:/.test(text), 'an autolink survived');
	assert.ok(!/^#{1,6} Injected/m.test(text), 'a heading was injected');
	assert.ok(!/^\s*- injected item/m.test(text), 'a list item was injected');
	assert.ok(!text.includes(value) || !/[[\]<>`*]/.test(value), 'the raw value was written unescaped');
}

const CONTEXT: ExpertsContext = { repository: 'gh/a/b', branch: 'main', login: 'alice' };

suite('Generated Markdown: every value from outside is escaped', () => {
	test('experts entries', () => {
		for (const value of HOSTILE) {
			const reading = decodeExperts([{ name: value, kind: value, score: 1, [value]: value }]);
			assert.ok(reading.kind === 'entries');
			const text = describeExperts(reading.entries, { kind: 'scope', scope: value }, { ...CONTEXT, repository: value, branch: value, login: value });
			assertInert(text, value);
			assertInert(describeEmptyExperts({ kind: 'scope', scope: value }, { ...CONTEXT, branch: value }), value);
		}
	});

	test('the review config', () => {
		for (const value of HOSTILE) {
			const decoded = decodeReviewConfig({
				target: value,
				head: value,
				yours: false,
				entries: [{ agent: value, kind: value, name: value, command: value, source: value }],
				instructions: [value],
				isolated_agents: [value],
			});
			assert.ok(decoded.ok);
			assertInert(describeReviewConfig(decoded.value), value);
		}
	});

	test('token profile signals, recommendations and limitations', () => {
		for (const value of HOSTILE) {
			const decoded = decodeTokenProfile({
				checkpoints_analyzed: 3,
				usage_scope: value,
				tokens: { total: 1 },
				signals: [{ id: value, label: value, count: 1, checkpoint_ids: [value] }],
				recommendations: [{ id: 'r', severity: value, message: value }],
				limitations: [value],
			});
			assert.ok(decoded.ok);
			assertInert(describeProfile(decoded.value, 'scope'), value);
		}
	});

	test('the link provider does not turn escaped text into a link', async () => {
		const decoded = decodeTokenProfile({
			checkpoints_analyzed: 1,
			signals: [],
			limitations: ['[go](command:entirely.explainCheckpoint?%5B%2201HXA000000000000000000001%22%5D)'],
		});
		assert.ok(decoded.ok);
		const text = describeProfile(decoded.value, 'scope');
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
		assert.strictEqual(new GeneratedLinks().provideDocumentLinks(document).length, 0);
	});
});

suite('Experts: failure wording and the branch note', () => {
	test('only the repository being missing reads as not mirrored', () => {
		for (const text of ['command not found', 'path not found', 'file src/a.ts not found', 'connection reset']) {
			assert.strictEqual(classifyExpertsFailure(text), 'other', text);
		}
		for (const text of ['repository not found', 'repo gh/a/b not found', 'not found: repository gh/a/b', 'not mirrored', 'publish it first', 'no such repo']) {
			assert.strictEqual(classifyExpertsFailure(text), 'not-mirrored', text);
		}
	});

	test('an empty result says the branch may not be pushed', () => {
		const text = describeEmptyExperts({ kind: 'staged' }, { ...CONTEXT, branch: 'feat/x' });
		assert.match(text, /Branch feat\\\/x may not be pushed to Entire|Branch feat\/x may not be pushed to Entire/);
		assert.ok(!/may not be pushed/.test(describeEmptyExperts({ kind: 'staged' }, { login: 'alice' })));
	});
});

suite('Review: branch names and the confirmed login', () => {
	const nonAscii = 'feat/café';

	test('a branch the CLI cannot be given is not offered, and a chosen one is refused before the modal', async () => {
		const cli = fakeAnalysisCli();
		const launcher = fakeLauncher();
		const ui = new FakeReviewUi({ target: { target: nonAscii } });
		const deps = {
			source: new ReviewService({ runner: cli.runner, workspaceRoot: () => cli.dir, readTimeoutSeconds: () => 20 }),
			ui,
			launch: launcher.launch,
			acting: async () => ALICE,
			branches: async () => ({ current: 'main', local: ['main', 'feat/x', nonAscii] }),
			timeoutMinutes: () => 0,
			running: { active: false },
		};
		assert.strictEqual(await runReview(deps), 'unavailable');
		assert.deepStrictEqual(ui.targetChoices[0].branches, ['feat/x']);
		assert.match(ui.warnings[0], /feat\/café.*cannot be given safely/);
		assert.strictEqual(ui.confirmations.length, 0);
		assert.strictEqual(launcher.launches.length, 0);
		assert.strictEqual(cli.modes('review.config').length, 0);
	});

	test('the service refuses an invalid target instead of reading another branch', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await new ReviewService({ runner: cli.runner, workspaceRoot: () => cli.dir, readTimeoutSeconds: () => 20 }).config({ profile: 'p', target: nonAscii });
		assert.ok(outcome.kind === 'failed' && /cannot be given safely/.test(outcome.detail));
		assert.strictEqual(cli.calls().length, 0);
	});

	test('what the review would load is read as the confirmed login, not the pinned one', async () => {
		const cli = fakeAnalysisCli();
		cli.runner.setContext('bob@us.auth.entire.io');
		const ui = new FakeReviewUi();
		const launcher = fakeLauncher();
		await runReview({
			source: new ReviewService({ runner: cli.runner, workspaceRoot: () => cli.dir, readTimeoutSeconds: () => 20 }),
			ui,
			launch: launcher.launch,
			acting: async () => ALICE,
			branches: async () => ({ current: 'main', local: [] }),
			timeoutMinutes: () => 0,
			running: { active: false },
		});
		const configCall = cli.calls().find(line => line.includes('--show-config'));
		assert.ok(configCall?.startsWith(`${ALICE.name}|`), String(configCall));
	});
});

suite('Experts: a file named relative to the repository root', () => {
	test('is resolved against the repository root, then confined to the workspace', async () => {
		const cli = fakeAnalysisCli();
		const repo = path.join(cli.dir, 'repo');
		const workspace = path.join(repo, 'sub');
		fs.mkdirSync(workspace, { recursive: true });
		assert.strictEqual(repositoryFileToAbsolute(repo, 'sub/a.ts'), path.join(workspace, 'a.ts'));
		assert.strictEqual(repositoryFileToAbsolute(repo, path.join(repo, 'x.ts')), path.join(repo, 'x.ts'));
		const warnings: string[] = [];
		const deps = {
			source: new ExpertsService({ runner: cli.runner, workspaceRoot: () => workspace, timeoutSeconds: () => 20, limit: () => 8, branch: () => undefined }),
			ui: {
				askQuestion: async () => undefined,
				askPath: async () => undefined,
				show: async () => undefined,
				warn: async (message: string) => void warnings.push(message),
				withProgress: <T>(_t: string, work: (s: AbortSignal) => Promise<T>) => work(new AbortController().signal),
			},
			acting: async () => ALICE,
			workspaceRoot: () => workspace,
		};
		assert.strictEqual(await expertsForPath(deps, repositoryFileToAbsolute(repo, 'sub/a.ts')), 'shown');
		assert.deepStrictEqual(cli.modes('experts')[0].slice(-2), ['--', 'a.ts']);
		assert.strictEqual(await expertsForPath(deps, repositoryFileToAbsolute(repo, 'other/b.ts')), 'failed');
		assert.match(warnings[0], /outside the workspace/);
		assert.strictEqual(cli.modes('experts').length, 1);
	});
});
