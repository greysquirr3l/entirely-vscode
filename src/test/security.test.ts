import * as assert from 'assert';

import {
	checkpointRef,
	endsWithLineSuffix,
	escapeMarkdown,
	fileArguments,
	fileOperand,
	isCheckpointId,
	oneLine,
	splitLineSuffix,
	type Checkpoint,
	type Session,
} from '../lib/entire';
import { tooltipForCheckpoint } from '../providers/checkpointsProvider';
import { tooltipFor } from '../providers/sessionsProvider';
import { clampRefreshInterval } from '../services/configuration';
import { createCheckpointDetailSource } from '../services/checkpointSource';
import type { CliRunner } from '../services/cli';

/** The characters Markdown acts on. */
const SPECIAL = new Set([
	'\\',
	'`',
	'*',
	'_',
	'{',
	'}',
	'[',
	']',
	'(',
	')',
	'#',
	'+',
	'-',
	'.',
	'!',
	'~',
	'>',
	'|',
	'$',
	'&',
	'<',
	'=',
	':',
]);

/**
 * The characters in a Markdown document that Markdown would still act on.
 *
 * A backslash before a character makes that character text, and a
 * backslash at the end of a line makes a line break. Anything else that
 * Markdown acts on is live: a heading, a list, a link, a quote.
 */
function liveCharacters(text: string): string[] {
	const live: string[] = [];

	for (let index = 0; index < text.length; index++) {
		const character = text[index];

		if (character === '\\') {
			const next = text[index + 1];
			if (next !== undefined && (SPECIAL.has(next) || next === '\n')) {
				index++;
				continue;
			}
			live.push(character);
			continue;
		}

		if (SPECIAL.has(character)) {
			live.push(character);
		}
	}

	return live;
}

/** Removes the escapes `escapeMarkdown` added. */
function unescapeMarkdown(text: string): string {
	return text.replace(/\\([\\`*_{}[\]()#+\-.!~>|$&<=:\n])/g, '$1');
}

/** A session as the CLI reports one. */
function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'abc-123',
		agent: 'Copilot CLI',
		status: 'active',
		worktreePath: '/work/sandbox',
		branch: 'master',
		turns: 3,
		pendingTurns: 0,
		checkpoints: 2,
		lastPrompt: 'add a test',
		...overrides,
	};
}

/** A checkpoint as the CLI reports one. */
const CHECKPOINT: Checkpoint = {
	id: 'abc123def456',
	agent: 'Copilot CLI',
	message: 'add a test',
	date: { date: new Date('2026-10-26T23:34:45Z'), raw: '2026-10-26T23:34:45Z' },
	sessionIds: ['session-1'],
	sessionCount: 1,
	isTaskCheckpoint: false,
	isLogsOnly: false,
};

/** A runner that records what it was asked to run. */
class RecordingRunner {
	readonly calls: { args: readonly string[]; cwd?: string }[] = [];

	async runJson(
		args: readonly string[],
		_decode: (value: unknown) => unknown,
		options: { cwd?: string } = {},
	): Promise<{ ok: boolean; value?: unknown; detail: string }> {
		this.calls.push({ args, cwd: options.cwd });
		return { ok: true, value: {}, detail: '' };
	}

	/** The runner, as the services take it. */
	asRunner(): CliRunner {
		return this as unknown as CliRunner;
	}
}

suite('Entire markdown escaping', () => {
	const HOSTILE = [
		'[click me](https://example.invalid)',
		'![an image](https://example.invalid/pixel.png)',
		'# a heading',
		'> a quotation',
		'- a list item',
		'1. an ordered item',
		'```a code fence```',
		'    an indented code block',
		'<img src=x onerror=alert(1)>',
		'$(zap)',
		'$x^2$',
		'a & b',
		'| a | b |',
		'---',
		'===',
		'~~struck out~~',
		'a\\b',
	].join('\n');

	test('leaves nothing in a value that Markdown would act on', () => {
		assert.deepStrictEqual(liveCharacters(escapeMarkdown(HOSTILE)), []);
	});

	test('shows the value as it was written', () => {
		assert.strictEqual(unescapeMarkdown(escapeMarkdown(HOSTILE)), HOSTILE);
	});

	test('keeps the text of a value, whatever it contains', () => {
		const value = 'fix the parser in src/parse.ts and run the tests';

		assert.strictEqual(unescapeMarkdown(escapeMarkdown(value)), value);
		assert.deepStrictEqual(liveCharacters(escapeMarkdown(value)), []);
	});

	test('keeps a line break inside a value from starting a block', () => {
		const escaped = escapeMarkdown('first line\nsecond line');

		// A hard break, not a new paragraph: the value stays one block.
		assert.ok(escaped.includes('\\\n'), 'the line break is not a hard break');
		assert.ok(!escaped.includes('\n\n'), 'the value was broken into paragraphs');
	});

	test('does not let a value end a line with spaces that pull the next line in', () => {
		const escaped = escapeMarkdown('a value   \nnext line');

		assert.ok(!/[ \t]+\n/.test(escaped), 'the value still ends a line with spaces');
	});
});

suite('Entire rendered markdown', () => {
	/**
	 * Renders Markdown the way the editor does.
	 *
	 * The editor renders Markdown with marked, with GitHub's extensions
	 * on. A test that only reads the Markdown source cannot see what the
	 * renderer does with it: a renderer that links a bare address turns
	 * `https://example.invalid` in a prompt into a link, and a link in a
	 * tooltip is a link a user can click without meaning to.
	 */
	async function render(markdown: string): Promise<string> {
		const { marked } = await import('marked');
		return marked.parse(markdown) as string;
	}

	const HOSTILE = [
		'[click me](https://example.invalid)',
		'![an image](https://example.invalid/pixel.png)',
		'https://example.invalid',
		'ftp://example.invalid',
		'www.example.invalid',
		'user@example.invalid',
		'<https://example.invalid>',
		'<img src=x onerror=alert(1)>',
		'command:workbench.action.terminal.new',
		'# a heading',
		'> a quotation',
		'- a list item',
		'1. an ordered item',
		'```a code fence```',
		'~~struck out~~',
		'$x^2$',
		'$(zap)',
	].join('\n');

	test('renders a value as text, with no link and no image in it', async () => {
		const html = await render(escapeMarkdown(HOSTILE));

		assert.ok(!html.includes('<a '), 'the value became a link');
		assert.ok(!html.includes('<img'), 'the value became an image');
		assert.ok(!html.includes('<h1'), 'the value became a heading');
		assert.ok(!html.includes('<blockquote'), 'the value became a quotation');
		assert.ok(!html.includes('<code'), 'the value became a code block');
	});

	test('shows the words of the value', async () => {
		const html = await render(escapeMarkdown(HOSTILE));

		assert.ok(html.includes('[click me](https://example.invalid)'), 'the value was not shown');
		assert.ok(html.includes('command:workbench.action.terminal.new'), 'the value was not shown');
	});

	test('renders a tooltip with a hostile value as a tooltip and nothing else', async () => {
		const html = await render(tooltipFor(makeSession({ lastPrompt: HOSTILE })).value);

		assert.ok(!html.includes('<a '), 'the tooltip holds a link');
		assert.ok(!html.includes('<img'), 'the tooltip holds an image');
		assert.ok(html.includes('<strong>Copilot CLI</strong>'), 'the structure of the tooltip is gone');
		assert.ok(html.includes('<li>Session: abc-123</li>'), 'the structure of the tooltip is gone');
	});

	test('renders a checkpoint tooltip with a hostile value as a tooltip and nothing else', async () => {
		const html = await render(tooltipForCheckpoint({ ...CHECKPOINT, message: HOSTILE }).value);

		assert.ok(!html.includes('<a '), 'the tooltip holds a link');
		assert.ok(!html.includes('<img'), 'the tooltip holds an image');
		assert.ok(html.includes('<li>Agent: Copilot CLI</li>'), 'the structure of the tooltip is gone');
	});
});

suite('Entire tree tooltips', () => {
	const HOSTILE = '[click me](https://example.invalid)';

	test('shows a prompt that contains a link as text', () => {
		const benign = tooltipFor(makeSession()).value;
		const hostile = tooltipFor(makeSession({ lastPrompt: HOSTILE })).value;

		assert.ok(hostile.includes(escapeMarkdown(HOSTILE)), 'the prompt is not shown');
		assert.ok(!hostile.includes(HOSTILE), 'the prompt was left as it was');
		assert.deepStrictEqual(
			liveCharacters(hostile),
			liveCharacters(benign),
			'the prompt introduced Markdown of its own',
		);
	});

	test('shows a branch name that contains a link as text', () => {
		const benign = tooltipFor(makeSession()).value;
		const hostile = tooltipFor(makeSession({ branch: HOSTILE })).value;

		assert.ok(!hostile.includes(HOSTILE), 'the branch name was left as it was');
		assert.deepStrictEqual(
			liveCharacters(hostile),
			liveCharacters(benign),
			'the branch name introduced Markdown of its own',
		);
	});

	test('shows the agent, the worktree and the model as text', () => {
		const benign = tooltipFor(
			makeSession({
				agent: 'an agent',
				worktreePath: '/work/sandbox',
				model: 'a-model',
				status: 'active',
			}),
		).value;
		const hostile = tooltipFor(
			makeSession({
				agent: HOSTILE,
				worktreePath: HOSTILE,
				model: HOSTILE,
				status: HOSTILE,
			}),
		).value;

		assert.ok(!hostile.includes(HOSTILE), 'a value was left as it was');
		assert.deepStrictEqual(
			liveCharacters(hostile),
			liveCharacters(benign),
			'a value introduced Markdown of its own',
		);
	});

	test('shows a checkpoint message that contains a link as text', () => {
		const benign = tooltipForCheckpoint(CHECKPOINT).value;
		const hostile = tooltipForCheckpoint({ ...CHECKPOINT, message: HOSTILE }).value;

		assert.ok(hostile.includes(escapeMarkdown(HOSTILE)), 'the message is not shown');
		assert.ok(!hostile.includes(HOSTILE), 'the message was left as it was');
		assert.deepStrictEqual(
			liveCharacters(hostile),
			liveCharacters(benign),
			'the message introduced Markdown of its own',
		);
	});

	test('shows a checkpoint id and agent as text', () => {
		const benign = tooltipForCheckpoint(CHECKPOINT).value;
		const hostile = tooltipForCheckpoint({ ...CHECKPOINT, id: HOSTILE, agent: HOSTILE }).value;

		assert.ok(!hostile.includes(HOSTILE), 'a value was left as it was');
		assert.deepStrictEqual(
			liveCharacters(hostile),
			liveCharacters(benign),
			'a value introduced Markdown of its own',
		);
	});

	test('does not let a tooltip carry a trusted command link', () => {
		const tooltip = tooltipFor(makeSession({ lastPrompt: HOSTILE }));

		assert.notStrictEqual(tooltip.isTrusted, true, 'the tooltip is trusted');
		assert.notStrictEqual(tooltip.supportHtml, true, 'the tooltip allows raw HTML');
	});

	test('does not let a tooltip carry a theme icon', () => {
		// The editor substitutes theme icons into the rendered output,
		// not into the Markdown, so escaping the text would not stop one.
		const tooltip = tooltipFor(makeSession({ lastPrompt: '$(zap)' }));

		assert.notStrictEqual(tooltip.supportThemeIcons, true, 'the tooltip allows theme icons');
	});
});

suite('Entire CLI arguments', () => {
	test('puts the file after the end-of-options separator', () => {
		const args = fileArguments(['why'], 'src/auth.ts', undefined, ['--json']);

		assert.deepStrictEqual(args, ['why', '--json', '--', 'src/auth.ts']);
	});

	test('states the line with the CLI own flag rather than in the path', () => {
		const args = fileArguments(['why'], 'src/auth.ts', 42, ['--json']);

		assert.deepStrictEqual(args, ['why', '--json', '--line', '42', '--', 'src/auth.ts']);
	});

	test('keeps a path that contains a colon whole', () => {
		assert.ok(endsWithLineSuffix('notes:12'));
		assert.deepStrictEqual(splitLineSuffix('notes:12'), { file: 'notes', line: 12 });
		assert.strictEqual(fileOperand('notes:12'), 'notes:12/');
	});

	test('leaves a path the CLI would not split alone', () => {
		assert.ok(!endsWithLineSuffix('notes:12b'));
		assert.ok(!endsWithLineSuffix('notes:'));
		assert.ok(!endsWithLineSuffix('a/b:c'));
		assert.strictEqual(splitLineSuffix('notes:12b'), undefined);
		assert.strictEqual(fileOperand('src/auth.ts'), 'src/auth.ts');
	});

	test('puts a checkpoint id after the end-of-options separator', async () => {
		const runner = new RecordingRunner();
		const source = createCheckpointDetailSource(runner.asRunner(), () => '/work/sandbox');

		await source('abc123def456');

		assert.deepStrictEqual(runner.calls[0].args, [
			'checkpoint',
			'explain',
			'--json',
			'--',
			'abc123def456',
		]);
	});
});

suite('Entire bounded values', () => {
	test('clamps the refresh interval', () => {
		assert.strictEqual(clampRefreshInterval(0), 0, 'zero no longer means "do not poll"');
		assert.strictEqual(clampRefreshInterval(30), 30);
		assert.strictEqual(clampRefreshInterval(0.5), 1);
		assert.strictEqual(clampRefreshInterval(-5), 1);
		assert.strictEqual(clampRefreshInterval(3600), 3600);
		assert.strictEqual(clampRefreshInterval(1e12), 3600);
	});

	test('falls back to a sane interval when the setting is not a number', () => {
		assert.strictEqual(clampRefreshInterval(Number.NaN), 30);
		assert.strictEqual(clampRefreshInterval(Number.POSITIVE_INFINITY), 30);
	});

	test('folds a value onto one line', () => {
		assert.strictEqual(oneLine('first\nsecond'), 'first <break> second');
		assert.strictEqual(oneLine('a\tb'), 'a <break> b');
		assert.strictEqual(oneLine('a\u0000b'), 'ab');
	});

	test('bounds a value that is too long to read', () => {
		const folded = oneLine('x'.repeat(500));

		assert.strictEqual(folded.length, 200);
		assert.ok(folded.endsWith('…'));
	});

	test('refuses a checkpoint id that the CLI would not recognise', () => {
		assert.ok(isCheckpointId('abc123def456'));
		assert.ok(isCheckpointId('01ARZ3NDEKTSV4RRFFQ69G5FAV'));
		assert.ok(!isCheckpointId('../../etc/passwd'));
		assert.ok(!isCheckpointId('ABC123DEF456'));
		assert.ok(!isCheckpointId(''));
	});

	test('builds no ref from an id that is not a checkpoint id', () => {
		assert.strictEqual(checkpointRef('abc123def456'), 'refs/entire/checkpoints/56/abc123def456');
		assert.strictEqual(checkpointRef('../../etc/passwd'), undefined);
		assert.strictEqual(checkpointRef('01ARZ3NDEKTSV4RRFFQ69G5FAV'), 'refs/entire/checkpoints/AV/01ARZ3NDEKTSV4RRFFQ69G5FAV');
	});
});
