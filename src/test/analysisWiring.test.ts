import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { renderWhyBody } from '../providers/whyView';
import { expertsForPath, expertsStaged } from '../commands/experts';
import { showReviewFindings, showReviewProfiles } from '../commands/review';
import { showTokenProfile } from '../commands/tokenProfile';
import { GENERATED_SCHEME, GeneratedDocuments, type GeneratedKind } from '../providers/generatedDocuments';
import { GeneratedLinks } from '../providers/generatedLinks';
import { ExpertsService } from '../services/experts';
import { ReviewService } from '../services/review';
import { reviewTerminalLauncher } from '../services/reviewTerminal';
import { TokenProfileService } from '../services/tokenProfile';
import { ALICE, fakeAnalysisCli } from './support/analysisCli';
import { PROFILE_CHECKPOINT_IDS } from './support/analysisFixtures';
import { FakeReviewUi, fakeLauncher } from './support/reviewHarness';

const ROOT = path.resolve(__dirname, '..', '..');

/** The production files this task added. */
const NEW_FILES = [
	'src/lib/entire/commandHelp.ts',
	'src/lib/entire/experts.ts',
	'src/lib/entire/generatedLinks.ts',
	'src/lib/entire/review.ts',
	'src/lib/entire/reviewActions.ts',
	'src/lib/entire/reviewConfig.ts',
	'src/lib/entire/tokenProfile.ts',
	'src/services/commandHelp.ts',
	'src/services/experts.ts',
	'src/services/review.ts',
	'src/services/reviewTerminal.ts',
	'src/services/tokenProfile.ts',
	'src/providers/generatedLinks.ts',
	'src/commands/analysisCommands.ts',
	'src/commands/analysisUi.ts',
	'src/commands/experts.ts',
	'src/commands/generatedView.ts',
	'src/commands/review.ts',
	'src/commands/tokenProfile.ts',
];

const COMMANDS = [
	'entirely.tokenProfile',
	'entirely.expertsForPath',
	'entirely.expertsAsk',
	'entirely.expertsStaged',
	'entirely.showExpertsRawReply',
	'entirely.reviewProfiles',
	'entirely.reviewShowConfig',
	'entirely.reviewFindings',
	'entirely.reviewRun',
	'entirely.reviewSetup',
];

interface Manifest {
	contributes: {
		commands: { command: string; title: string }[];
		configuration: { properties: Record<string, { default?: number; minimum?: number; maximum?: number }> };
		menus: Record<string, { command: string; when?: string; group?: string }[]>;
	};
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;

function read(file: string): string {
	return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

suite('Review, experts and tokens: wiring', () => {
	test('every command is contributed with a title, and registered by the one registration function', () => {
		const registered = read('src/commands/analysisCommands.ts');
		for (const command of COMMANDS) {
			assert.ok(manifest.contributes.commands.some(entry => entry.command === command), `${command} is not contributed`);
			assert.ok(registered.includes(`registerCommand('${command}'`), `${command} is not registered`);
		}
	});

	test('the menus reach the commands from where the task puts them', () => {
		const menus = manifest.contributes.menus;
		assert.ok(menus['view/title'].some(item => item.command === 'entirely.tokenProfile' && item.when === 'view == entirely.checkpoints'));
		assert.ok(menus['explorer/context'].some(item => item.command === 'entirely.expertsForPath'));
		assert.ok(menus['editor/context'].some(item => item.command === 'entirely.expertsForPath'));
		for (const command of ['entirely.reviewRun', 'entirely.reviewProfiles', 'entirely.reviewShowConfig', 'entirely.reviewFindings', 'entirely.reviewSetup']) {
			assert.ok(menus['view/title'].some(item => item.command === command && item.when === 'view == entirely.activity'), command);
		}
		for (const group of Object.values(menus)) {
			for (const item of group) {
				assert.ok(manifest.contributes.commands.some(entry => entry.command === item.command), `${item.command} has a menu entry but no command`);
			}
		}
	});

	test('every command title named in a message exists in the manifest', () => {
		const titles = new Set(manifest.contributes.commands.map(entry => entry.title));
		const named: string[] = [];
		for (const file of NEW_FILES) {
			for (const match of read(file).matchAll(/Entirely: ([A-Z][^"'`]*?)["'`]/g)) {
				named.push(match[1]);
			}
		}
		assert.ok(named.length >= 4, 'the messages name the commands to use');
		for (const title of named) {
			assert.ok(titles.has(title), `"Entirely: ${title}" is named in a message but is not a command title`);
		}
	});

	test('the six settings are declared with the defaults and bounds the clamps use', () => {
		const properties = manifest.contributes.configuration.properties;
		const expected: [string, number, number, number][] = [
			['tokenProfileCheckpoints', 50, 1, 1000],
			['tokenProfileTimeout', 30, 5, 300],
			['expertsLimit', 8, 1, 20],
			['expertsTimeout', 30, 5, 300],
			['reviewReadTimeout', 30, 5, 300],
			['reviewReviewerTimeoutMinutes', 0, 0, 1440],
		];
		for (const [name, fallback, min, max] of expected) {
			const property = properties[`entirely.${name}`];
			assert.ok(property, `${name} is not declared`);
			assert.deepStrictEqual([property.default, property.minimum, property.maximum], [fallback, min, max], name);
			assert.strictEqual(vscode.workspace.getConfiguration('entirely').get(name), fallback);
		}
	});

	test('no flag is named as a literal in the new files: every flag comes from the help', () => {
		const offenders: string[] = [];
		for (const file of NEW_FILES) {
			const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
			for (const match of code.matchAll(/['"`]--[A-Za-z][A-Za-z-]*/g)) {
				offenders.push(`${file}: ${match[0]}`);
			}
		}
		assert.deepStrictEqual(offenders, []);
	});

	test('no model or provider is named in the new files', () => {
		const offenders: string[] = [];
		const names = /\b(?:gpt|claude|gemini|sonnet|opus|haiku|llama|mistral|openai|anthropic|copilot|codex|cursor|bedrock|ollama)\b/i;
		for (const file of NEW_FILES) {
			read(file)
				.split('\n')
				.forEach((line, index) => {
					if (names.test(line)) {
						offenders.push(`${file}:${index + 1}`);
					}
				});
		}
		assert.deepStrictEqual(offenders, []);
	});

	test('nothing in the new files imports vscode except where the layers allow it', () => {
		for (const file of NEW_FILES.filter(entry => entry.startsWith('src/lib/'))) {
			assert.ok(!/from 'vscode'/.test(read(file)), `${file} imports vscode`);
		}
	});

	test('the generated document kinds keep the old ones and add the new ones with their extensions', () => {
		const documents = new GeneratedDocuments();
		const extensions: Record<GeneratedKind, string> = {
			dispatch: 'md',
			recap: 'txt',
			plugin: 'txt',
			detail: 'txt',
			doctor: 'txt',
			capture: 'txt',
			tokenProfile: 'md',
			experts: 'md',
			expertsRaw: 'txt',
			reviewProfiles: 'txt',
			reviewConfig: 'md',
			reviewFindings: 'txt',
		};
		for (const [kind, extension] of Object.entries(extensions)) {
			const uri = documents.set(kind as GeneratedKind, 'text');
			assert.strictEqual(uri.scheme, GENERATED_SCHEME);
			assert.ok(uri.path.endsWith(`.${extension}`), `${kind} -> ${uri.path}`);
		}
		documents.dispose();
	});

	test('the blame panel links to the experts command for the file, in both views', () => {
		const file = renderWhyBody({ kind: 'file', file: 'src/a.ts', lines: [], summary: { totalLines: 0, checkpointLines: 0, commitLines: 0, uncommittedLines: 0, checkpointPercentage: 0, commitPercentage: 0 } } as never);
		assert.match(file, /command:entirely\.expertsForPath\?%5B%22src%2Fa\.ts%22%5D">Who else touched this file</);
	});
});

suite('Review, experts and tokens: checkpoint links in a generated document', () => {
	test('the ids of a signal become links to the explain command, and other command text does not', async () => {
		const link = (id: string): string => `[${id}](command:entirely.explainCheckpoint?${encodeURIComponent(JSON.stringify([id]))})`;
		const text = `- ${link(PROFILE_CHECKPOINT_IDS[0])}\n- [x](command:workbench.action.quit)\n- ${link('nope')}\n`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
		const links = new GeneratedLinks().provideDocumentLinks(document);
		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].target?.scheme, 'command');
		assert.strictEqual(links[0].target?.path, 'entirely.explainCheckpoint');
		assert.deepStrictEqual(JSON.parse(links[0].target?.query ?? ''), [PROFILE_CHECKPOINT_IDS[0]]);
		assert.strictEqual(document.getText(links[0].range).startsWith('command:entirely.explainCheckpoint?'), true);
	});
});

suite('Review, experts and tokens: nothing polls', () => {
	test('the flows start no timer of their own, and no interval at all', async function () {
		this.timeout(60_000);
		const intervals: string[] = [];
		const timeouts: string[] = [];
		const realInterval = global.setInterval;
		const realTimeout = global.setTimeout;
		global.setInterval = ((...args: Parameters<typeof setInterval>) => {
			intervals.push(new Error().stack ?? '');
			return realInterval(...args);
		}) as typeof setInterval;
		global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
			timeouts.push(new Error().stack ?? '');
			return realTimeout(...args);
		}) as typeof setTimeout;

		const cli = fakeAnalysisCli();
		const ui = new FakeReviewUi();
		const base = { runner: cli.runner, workspaceRoot: () => cli.dir };
		const review = {
			source: new ReviewService({ ...base, readTimeoutSeconds: () => 20 }),
			ui,
			launch: fakeLauncher().launch,
			acting: async () => ALICE,
			branches: async () => ({ local: [] }),
			timeoutMinutes: () => 0,
			running: { active: false },
		};
		try {
			await showTokenProfile({ source: new TokenProfileService({ ...base, timeoutSeconds: () => 20 }), ui: { ...ui, pickScope: async () => ({ kind: 'default' as const }), show: ui.show.bind(ui), warn: ui.warn.bind(ui), withProgress: ui.withProgress.bind(ui) }, limit: () => 50 });
			const experts = { source: new ExpertsService({ ...base, timeoutSeconds: () => 20, limit: () => 8, branch: () => undefined }), acting: async () => ALICE, workspaceRoot: () => cli.dir };
			const expertsUi = { askQuestion: async () => 'q', askPath: async () => 'src', show: ui.show.bind(ui), warn: ui.warn.bind(ui), withProgress: ui.withProgress.bind(ui) };
			await expertsStaged({ ...experts, ui: expertsUi });
			await expertsForPath({ ...experts, ui: expertsUi }, path.join(cli.dir, 'src'));
			await showReviewProfiles(review);
			await showReviewFindings(review);
		} finally {
			global.setInterval = realInterval;
			global.setTimeout = realTimeout;
		}
		// The editor host and its built-in extensions start timers of their own. A timer counts against the
		// flows only when the extension's code is on its stack.
		const ours = /out[\\/](?:commands|services|lib|providers)[\\/]/;
		const fromRunner = /services[\\/]cli[\\/]exec/;
		assert.deepStrictEqual(intervals.filter(stack => ours.test(stack)), []);
		assert.deepStrictEqual(
			timeouts.filter(stack => ours.test(stack) && !fromRunner.test(stack)),
			[],
			"only the runner's own timeout may start a timer",
		);
	});
});

suite('Review, experts and tokens: the terminal', () => {
	test('reports the exit code of the terminal when it closes, once, and registers its listener for disposal', async function () {
		this.timeout(30_000);
		const disposables: vscode.Disposable[] = [];
		const launch = reviewTerminalLauncher(disposables);
		const exited = new Promise<number | undefined>(resolve => {
			const process = launch({ ok: true, path: '/bin/sh', args: ['-c', 'exit 3'], env: {}, cwd: undefined });
			process.onExit(resolve);
		});
		assert.strictEqual(disposables.length, 1);
		const code = await Promise.race([exited, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 20_000))]);
		vscode.Disposable.from(...disposables).dispose();
		for (const terminal of vscode.window.terminals.filter(entry => entry.name === 'Entire: review')) {
			terminal.dispose();
		}
		assert.strictEqual(code, 3);
	});
});
