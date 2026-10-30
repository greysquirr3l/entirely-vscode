import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { countStatuses, leafCommands, parseCoverage, STATUSES } from './support/coverageMatrix';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

/** Every page under cli-reference in Entire's documentation index, as of the audit. */
const DOCUMENTED_PAGES = [
	'activity', 'agent', 'agent-help', 'api', 'auth', 'blame', 'checkpoint', 'clean', 'cluster',
	'completion', 'configure', 'disable', 'dispatch', 'doctor', 'enable', 'experts', 'global-flags',
	'grant', 'graph', 'help', 'import', 'investigate', 'labs', 'login', 'logout', 'mcp', 'org',
	'plugin', 'project', 'recap', 'repo', 'review', 'runner', 'search', 'session', 'status',
	'tokens', 'trail', 'version', 'why',
];

const text = fs.readFileSync(path.join(ROOT, 'docs', 'coverage.md'), 'utf8');
const coverage = parseCoverage(text);
const commandRows = coverage.matrix.filter(row => row.command.startsWith('entire '));
const matrixPaths = commandRows.map(row => row.command.replace(/^entire /, ''));

function productionFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === 'test' ? [] : productionFiles(full);
		}
		return entry.name.endsWith('.ts') ? [full] : [];
	});
}

function read(file: string): string {
	return fs.readFileSync(file, 'utf8');
}

function manifestIds(): Set<string> {
	const manifest = JSON.parse(read(path.join(ROOT, 'package.json'))) as {
		contributes?: { commands?: { command: string }[]; configuration?: { properties?: Record<string, unknown> } };
	};
	return new Set([
		...(manifest.contributes?.commands ?? []).map(entry => entry.command),
		...Object.keys(manifest.contributes?.configuration?.properties ?? {}),
	]);
}

function findEntire(): string | undefined {
	const candidates = ['entire', path.join(os.homedir(), '.local', 'bin', 'entire')];
	return candidates.find(candidate => spawnSync(candidate, ['version'], { encoding: 'utf8' }).status === 0);
}

suite('Coverage matrix (docs/coverage.md)', () => {
	test('the totals line matches the rows in the table', () => {
		assert.ok(coverage.totals, 'docs/coverage.md has no "Totals." line');
		const counted = countStatuses(coverage.matrix);
		assert.deepStrictEqual(
			{ rows: coverage.matrix.length, ...counted },
			coverage.totals,
			'update the Totals line in docs/coverage.md',
		);
	});

	test('every row has a known status and no command appears twice', () => {
		for (const row of coverage.matrix) {
			assert.ok((STATUSES as readonly string[]).includes(row.status), `${row.command}: unknown status "${row.status}"`);
		}
		const names = coverage.matrix.map(row => row.command);
		assert.deepStrictEqual(names.filter((name, index) => names.indexOf(name) !== index), []);
	});

	test('an excluded row says why, and a gap row is not dressed up as a decision', () => {
		for (const row of coverage.matrix) {
			if (row.status === 'Excluded') {
				assert.ok(row.notes.length >= 20, `${row.command}: an exclusion needs a stated reason`);
				assert.strictEqual(row.evidence, '', `${row.command}: an exclusion has no evidence column`);
			}
			if (row.status === 'Gap') {
				assert.strictEqual(row.evidence, '', `${row.command}: a gap has no evidence`);
			}
		}
	});

	test('a supported row cites a command id or source file and a test, and every citation exists', () => {
		const ids = manifestIds();
		for (const row of coverage.matrix.filter(entry => entry.status === 'Supported')) {
			const cited = [...row.evidence.matchAll(/`([^`]+)`/g)].map(match => match[1]);
			const tests = cited.filter(item => item.startsWith('src/test/'));
			const implementation = cited.filter(item => item.startsWith('entirely.') || (item.startsWith('src/') && !item.startsWith('src/test/')));
			assert.ok(tests.length > 0, `${row.command}: cite a test`);
			assert.ok(implementation.length > 0, `${row.command}: cite a command id or a source file`);
			for (const item of cited) {
				if (item.startsWith('src/')) {
					assert.ok(fs.existsSync(path.join(ROOT, item)), `${row.command}: ${item} does not exist`);
				} else {
					assert.ok(ids.has(item), `${row.command}: ${item} is not a command or setting in package.json`);
				}
			}
		}
	});

	test('a supported row cites a test file that mentions the command', () => {
		const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		for (const row of commandRows.filter(entry => entry.status === 'Supported')) {
			// An alias row (`auth login`) is tested through the form the extension runs (`login`).
			const alias = /an alias of the `entire ([a-z ]+)` row/.exec(row.notes);
			const words = (alias ? alias[1] : row.command.replace(/^entire /, '')).split(' ');
			const quoted = new RegExp(words.map(word => `'${escape(word)}'`).join('\\s*,\\s*'));
			const phrase = new RegExp(`(^|[^A-Za-z-])${words.map(escape).join('\\s+')}([^A-Za-z-]|$)`);
			const labels = words.map(word => new RegExp(`(^|[^A-Za-z-]|\\\\t)${escape(word)}\\)`));
			const tests = [...row.evidence.matchAll(/`(src\/test\/[^`]+)`/g)].map(match => match[1]);
			const mentions = tests.some(file => {
				const code = read(path.join(ROOT, file));
				return quoted.test(code) || phrase.test(code) || labels.every(label => label.test(code));
			});
			assert.ok(mentions, `${row.command}: none of ${tests.join(', ')} mentions the command; cite the test that runs it`);
		}
	});

	test('every page of the documentation has a row', () => {
		for (const page of DOCUMENTED_PAGES) {
			const covered = matrixPaths.some(
				entry => entry === page || entry.startsWith(`${page} `) || (page === 'grant' && entry.includes(' grant ')),
			);
			assert.ok(covered, `no row for the documented page "${page}"`);
		}
	});

	test('every command the installed CLI lists has a row', function (this: Mocha.Context) {
		const binary = findEntire();
		if (!binary) {
			this.skip();
		}
		const tree = spawnSync(binary, ['help', '-t'], { encoding: 'utf8' });
		assert.strictEqual(tree.status, 0, 'entire help -t failed');
		const missing = leafCommands(tree.stdout).filter(leaf => !matrixPaths.includes(leaf));
		assert.deepStrictEqual(missing, [], 'the CLI has commands the matrix does not mention');
	});
});

suite('Coverage matrix CLI surface', () => {
	const surfacePaths = coverage.surface.map(row => row.command.replace(/^entire /, ''));
	const topLevel = new Set(matrixPaths.map(entry => entry.split(' ')[0]));

	test('a CLI call in src/ is listed in the surface section', () => {
		const unlisted: string[] = [];
		for (const file of productionFiles(SRC)) {
			for (const match of read(file).matchAll(/\[\s*'([a-z][a-z-]*)'(?:\s*,\s*'([a-z][a-z-]*)')?/g)) {
				const [, command, sub] = match;
				if (!topLevel.has(command)) {
					continue;
				}
				const pair = sub === undefined ? undefined : `${command} ${sub}`;
				const subIsCommand = pair !== undefined && matrixPaths.some(entry => entry === pair || entry.startsWith(`${pair} `));
				const wanted = subIsCommand ? pair : command;
				const listed = surfacePaths.some(entry => entry === wanted || entry.startsWith(`${wanted} `));
				if (!listed) {
					unlisted.push(`${path.relative(ROOT, file)}: entire ${wanted}`);
				}
			}
		}
		assert.deepStrictEqual([...new Set(unlisted)], [], 'add these invocations to section 1 of docs/coverage.md');
	});

	test('a surface row names only words its callers build', () => {
		for (const row of coverage.surface) {
			const words = row.command.replace(/^entire /, '').split(' ');
			const source = row.callers.map(caller => {
				assert.ok(fs.existsSync(path.join(ROOT, caller)), `${row.command}: ${caller} does not exist`);
				return read(path.join(ROOT, caller));
			});
			assert.ok(source.length > 0, `${row.command}: name a caller`);
			// A caller may build the command as separate words, or as one quoted phrase handed to a helper.
			const phrase = `'${words.join(' ')}'`;
			// A flag in a row's name (`disable --uninstall`) is read from the CLI's help at runtime, so no caller spells it.
			for (const word of words.filter(candidate => !candidate.startsWith('-'))) {
				assert.ok(
					source.some(code => code.includes(`'${word}'`) || code.includes(phrase)),
					`${row.command}: no caller builds '${word}'`,
				);
			}
		}
	});

	test('every surface row is a row of the matrix, and is supported there', () => {
		for (const row of coverage.surface) {
			const entry = commandRows.find(candidate => candidate.command === row.command);
			assert.ok(entry, `${row.command} is called but has no matrix row`);
			assert.strictEqual(entry.status, 'Supported', `${row.command} is called, so its row cannot be ${entry.status}`);
		}
	});

	test('a supported matrix row for a command is in the surface section', () => {
		const listed = new Set(coverage.surface.map(row => row.command));
		// These are reached without a literal invocation of their own.
		const reachedOtherwise = new Set([
			'entire auth login',
			'entire auth logout',
		]);
		for (const row of commandRows.filter(entry => entry.status === 'Supported')) {
			assert.ok(listed.has(row.command) || reachedOtherwise.has(row.command), `${row.command} is supported but not in the CLI surface`);
		}
	});
});

suite('Coverage matrix parser', () => {
	const sample = [
		'**Totals.** Rows: 3 (supported 1, excluded 1, gap 1)',
		'',
		'## 1. The extension\'s CLI surface',
		'| CLI invocation | Called from | What |',
		'| --- | --- | --- |',
		'| `entire status` | `src/a.ts`, `src/b.ts` | x |',
		'',
		'## 2. The matrix',
		'| Command | Status | Evidence | Notes |',
		'| --- | --- | --- | --- |',
		'| `entire status` | Supported | `src/a.ts`, `src/test/a.test.ts` | |',
		'| `entire help` | Excluded | | Not an editor concern. |',
		'| `--context` and `ENTIRE_CONTEXT` | Gap | | |',
		'',
		'## 3. Gaps',
	].join('\n');

	test('reads totals, surface rows and matrix rows', () => {
		const parsed = parseCoverage(sample);
		assert.deepStrictEqual(parsed.totals, { rows: 3, supported: 1, excluded: 1, gap: 1 });
		assert.deepStrictEqual(parsed.surface, [{ command: 'entire status', callers: ['src/a.ts', 'src/b.ts'] }]);
		assert.deepStrictEqual(
			parsed.matrix.map(row => [row.command, row.status]),
			[['entire status', 'Supported'], ['entire help', 'Excluded'], ['--context and ENTIRE_CONTEXT', 'Gap']],
		);
	});

	test('counts rows by status', () => {
		assert.deepStrictEqual(countStatuses(parseCoverage(sample).matrix), { supported: 1, excluded: 1, gap: 1 });
	});

	test('a document with no totals line has no totals', () => {
		assert.strictEqual(parseCoverage('# nothing').totals, undefined);
	});

	test('lists only the commands with no subcommand of their own', () => {
		const tree = ['entire', '├── agent', '│   ├── add', '│   └── list', '├── status', '└── trail', '    └── show'].join('\n');
		assert.deepStrictEqual(leafCommands(tree), ['agent add', 'agent list', 'status', 'trail show']);
	});
});
