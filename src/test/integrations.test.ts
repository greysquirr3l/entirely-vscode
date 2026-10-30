import * as assert from 'assert';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	DEFAULT_SUGGESTED_PLUGINS,
	chooseConfigTarget,
	confirmProjectMcp,
	describeCliUnavailable,
	describeMcpConfig,
	describeMcpEditor,
	describePluginState,
	detectIndent,
	hasEntireEntry,
	integrationTargetOf,
	isInstallable,
	judgeCli,
	manualSnippet,
	mergeEntireServer,
	missingPlugins,
	parseConfig,
	projectMcpArguments,
	readSuggestedPlugins,
	serverEntry,
	targetFor,
	type ControlConfirmation,
	type FolderIntegrations,
	type IntegrationReading,
	type McpConfigState,
	type PluginRow,
	EDITOR_CONFIG,
	ROOT_CONFIG,
} from '../lib/entire';
import { mcpServerEnabledIn, readExtensionSettings } from '../services/configuration';
import { runPluginCommand } from '../commands/plugins';
import { addMcpToProject, enableMcpFromRow, installFromRow, type IntegrationUi } from '../commands/integrations';
import type { McpDependencies, McpUi } from '../commands/mcp';
import type { PluginDependencies, PluginUi } from '../commands/plugins';
import {
	MCP_CONFIG_ADDABLE,
	MCP_OFF,
	PLUGIN_MISSING,
	IntegrationsProvider,
	buildIntegrationNodes,
	type IntegrationNode,
} from '../providers/integrationsProvider';
import { IntegrationDetector, type IntegrationFolder } from '../services/integrationDetection';
import {
	IntegrationOffers,
	PLUGIN_OFFER_KEY,
	projectOfferKey,
	type OfferState,
	type OfferUi,
	type PluginOfferAnswer,
	type ProjectOfferAnswer,
} from '../services/integrationOffers';
import { McpServerService } from '../services/mcpServer';
import { PluginService } from '../services/plugins';
import { openRegularFile } from '../services/openRegularFile';
import { ProjectMcpConfig } from '../services/projectMcpConfig';
import { ALICE } from './support/activityCli';
import { fakePluginCli, type FakePluginCli } from './support/pluginCli';
import { makeTempDir } from './support/tempDir';

const ARGS = ['mcp'];

function makeFolder(plugins: Record<string, string> = {}): IntegrationFolder {
	const dir = makeTempDir('entire-folder-');
	if (Object.keys(plugins).length > 0) {
		fs.mkdirSync(path.join(dir, '.plugins'));
		for (const [name, content] of Object.entries(plugins)) {
			fs.writeFileSync(path.join(dir, '.plugins', name), content);
		}
	}
	return { name: path.basename(dir), path: dir };
}

function pluginsFor(cli: FakePluginCli) {
	return (folder: string) => new PluginService({ runner: cli.runner, workspaceRoot: () => folder, timeoutSeconds: () => 20 });
}

function detectorFor(cli: FakePluginCli, folders: IntegrationFolder[], extra: { suggested?: readonly string[]; enabled?: (folder: string) => boolean } = {}) {
	const config = new ProjectMcpConfig();
	return new IntegrationDetector({
		cli: async () => judgeCli(await cli.runner.discover(), '0.12.2'),
		folders: () => folders,
		suggested: () => extra.suggested ?? DEFAULT_SUGGESTED_PLUGINS,
		plugins: pluginsFor(cli),
		mcp: folder => new McpServerService({ runner: cli.runner, workspaceRoot: () => folder }),
		mcpEnabled: extra.enabled ?? (() => true),
		config: folder => config.inspect(folder),
	});
}

async function folderReading(detector: IntegrationDetector): Promise<readonly FolderIntegrations[]> {
	const reading = await detector.detect();
	assert.strictEqual(reading.kind, 'folders');
	return reading.kind === 'folders' ? reading.folders : [];
}

function row(folder: FolderIntegrations, name: string): PluginRow {
	const found = folder.plugins.find(item => item.name === name);
	assert.ok(found, `no row for ${name}`);
	return found;
}

suite('Entire suggested plugins setting', () => {
	test('reads the names from the setting value and ignores what cannot name a plugin', () => {
		assert.deepStrictEqual(readSuggestedPlugins(['graph', ' brain ', 'a/b', '', 7, 'GRAPH', '-x', 'my_plugin']), ['graph', 'brain', 'my_plugin']);
	});

	test('falls back to the defaults for a value that is not a list, and allows an empty list', () => {
		assert.deepStrictEqual(readSuggestedPlugins('graph'), DEFAULT_SUGGESTED_PLUGINS);
		assert.deepStrictEqual(readSuggestedPlugins(undefined), DEFAULT_SUGGESTED_PLUGINS);
		assert.deepStrictEqual(readSuggestedPlugins([]), []);
		assert.strictEqual(readSuggestedPlugins(new Array<string>(100).fill('x').map((_, index) => `p${index}`)).length, 24);
	});
});

suite('Entire integration status model', () => {
	test('judges the CLI as ready, absent, broken or too old', () => {
		assert.deepStrictEqual(judgeCli({ state: 'available', version: '0.12.2' }, '0.12.2'), { kind: 'ready' });
		assert.deepStrictEqual(judgeCli({ state: 'available', version: 'entire 0.13.0' }, '0.12.2'), { kind: 'ready' });
		assert.deepStrictEqual(judgeCli({ state: 'available', version: '0.11.9' }, '0.12.2'), { kind: 'old', version: '0.11.9', minimum: '0.12.2' });
		assert.deepStrictEqual(judgeCli({ state: 'available', version: 'dev' }, '0.12.2'), { kind: 'ready' });
		assert.deepStrictEqual(judgeCli({ state: 'absent' }, '0.12.2'), { kind: 'absent' });
		assert.deepStrictEqual(judgeCli({ state: 'broken', detail: 'exec format' }, '0.12.2'), { kind: 'broken', detail: 'exec format' });
	});

	test('says what is wrong with the CLI and the way out', () => {
		assert.match(describeCliUnavailable({ kind: 'absent' }), /not installed.*refresh/i);
		assert.match(describeCliUnavailable({ kind: 'broken', detail: 'bad' }), /bad.*entirely\.cliPath/);
		assert.match(describeCliUnavailable({ kind: 'old', version: '0.1.0', minimum: '0.12.2' }), /0\.1\.0.*0\.12\.2.*Update/);
	});

	test('words each plugin state, and only a missing plugin is installable', () => {
		assert.strictEqual(describePluginState({ kind: 'installed', detail: 'v1' }), 'installed · v1');
		assert.strictEqual(describePluginState({ kind: 'installed', detail: '' }), 'installed');
		assert.strictEqual(describePluginState({ kind: 'on-path' }), 'available on PATH');
		assert.strictEqual(describePluginState({ kind: 'missing' }), 'not installed');
		assert.strictEqual(describePluginState({ kind: 'unknown', detail: 'timed out' }), 'unknown · timed out');
		assert.deepStrictEqual(
			(['installed', 'on-path', 'missing', 'unknown'] as const).map(kind => isInstallable(kind === 'installed' ? { kind, detail: '' } : kind === 'unknown' ? { kind, detail: '' } : { kind })),
			[false, false, true, false],
		);
	});

	test('words the editor and project states of the MCP server', () => {
		assert.strictEqual(describeMcpEditor({ kind: 'offered' }), 'offered to the editor');
		assert.strictEqual(describeMcpEditor({ kind: 'off' }), 'off in this workspace');
		assert.strictEqual(describeMcpEditor({ kind: 'unavailable', reason: 'old', detail: 'x' }), 'the CLI lacks mcp');
		assert.strictEqual(describeMcpConfig({ kind: 'configured', file: '.mcp.json' }), 'in .mcp.json');
		assert.strictEqual(describeMcpConfig({ kind: 'not-configured', target: ROOT_CONFIG }), 'not in .mcp.json');
		assert.match(describeMcpConfig({ kind: 'unreadable', file: '.mcp.json', detail: 'x' }), /not plain JSON/);
	});

	test('reads a row action target from a tree node and nothing else', () => {
		assert.deepStrictEqual(integrationTargetOf({ target: { kind: 'plugin', name: 'graph', folder: '/x' } }), { kind: 'plugin', name: 'graph', folder: '/x' });
		assert.deepStrictEqual(integrationTargetOf({ target: { kind: 'mcp-enable', folder: '/x' } }), { kind: 'mcp-enable', folder: '/x' });
		assert.deepStrictEqual(integrationTargetOf({ target: { kind: 'mcp-config', folder: '/x' } }), { kind: 'mcp-config', folder: '/x' });
		for (const bad of [undefined, null, 'graph', {}, { target: null }, { target: { kind: 'plugin', name: 'a/b', folder: '/x' } }, { target: { kind: 'plugin', name: 'graph' } }, { target: { kind: 'other', folder: '/x' } }]) {
			assert.strictEqual(integrationTargetOf(bad), undefined);
		}
	});

	test('lists the suggested plugins missing in any folder once', () => {
		const make = (state: PluginRow['state']): FolderIntegrations => ({
			name: 'a',
			path: '/a',
			plugins: [{ name: 'graph', suggested: true, state }, { name: 'extra', suggested: false, state: { kind: 'missing' } }],
			mcp: { editor: { kind: 'offered' }, config: { kind: 'configured', file: '.mcp.json' } },
		});
		const reading: IntegrationReading = { kind: 'folders', folders: [make({ kind: 'missing' }), make({ kind: 'missing' })] };
		assert.deepStrictEqual(missingPlugins(reading), ['graph']);
		assert.deepStrictEqual(missingPlugins({ kind: 'folders', folders: [make({ kind: 'on-path' })] }), []);
		assert.deepStrictEqual(missingPlugins({ kind: 'no-cli', cli: { kind: 'absent' } }), []);
	});
});

suite('Entire project MCP configuration text', () => {
	test('chooses .mcp.json unless only the editor file exists', () => {
		assert.deepStrictEqual(chooseConfigTarget({ root: false, editor: false }), ROOT_CONFIG);
		assert.deepStrictEqual(chooseConfigTarget({ root: true, editor: false }), ROOT_CONFIG);
		assert.deepStrictEqual(chooseConfigTarget({ root: true, editor: true }), ROOT_CONFIG);
		assert.deepStrictEqual(chooseConfigTarget({ root: false, editor: true }), EDITOR_CONFIG);
		assert.deepStrictEqual(targetFor('.vscode/mcp.json'), EDITOR_CONFIG);
		assert.deepStrictEqual(targetFor('.mcp.json'), ROOT_CONFIG);
	});

	test('drops a pinned login from the launch arguments and keeps the rest', () => {
		assert.deepStrictEqual(projectMcpArguments(['--context', 'bob@host', 'mcp']), ['mcp']);
		assert.deepStrictEqual(projectMcpArguments(['--context=bob', 'mcp']), ['mcp']);
		assert.deepStrictEqual(projectMcpArguments(['mcp', '--flag']), ['mcp', '--flag']);
		assert.deepStrictEqual(projectMcpArguments(['--context', 'only']), []);
	});

	test('builds the entry in the shape of each file', () => {
		assert.deepStrictEqual(serverEntry(ROOT_CONFIG, ARGS), { command: 'entire', args: ['mcp'] });
		assert.deepStrictEqual(serverEntry(EDITOR_CONFIG, ARGS), { type: 'stdio', command: 'entire', args: ['mcp'] });
	});

	test('finds an Entire entry by key or by command and arguments, in either servers key', () => {
		assert.strictEqual(hasEntireEntry({ mcpServers: { entire: 5 } }), true);
		assert.strictEqual(hasEntireEntry({ servers: { entire: {} } }), true);
		assert.strictEqual(hasEntireEntry({ mcpServers: { other: { command: '/usr/local/bin/entire', args: ['mcp'] } } }), true);
		assert.strictEqual(hasEntireEntry({ servers: { x: { command: 'C:\\bin\\entire.exe', args: ['--context', 'a', 'mcp'] } } }), true);
		assert.strictEqual(hasEntireEntry({ mcpServers: { x: { command: 'entire', args: ['status'] } } }), false);
		assert.strictEqual(hasEntireEntry({ mcpServers: { x: { command: 'node', args: ['mcp'] } } }), false);
		assert.strictEqual(hasEntireEntry({ mcpServers: [] }), false);
		assert.strictEqual(hasEntireEntry([]), false);
		assert.strictEqual(hasEntireEntry(null), false);
	});

	test('reads plain JSON objects only, and counts a blank file as empty', () => {
		assert.deepStrictEqual(parseConfig('{"a":1}'), { ok: true, value: { a: 1 } });
		assert.deepStrictEqual(parseConfig('  \n'), { ok: true, value: {} });
		assert.strictEqual(parseConfig('{ // c\n}').ok, false);
		assert.strictEqual(parseConfig('{"a":1,}').ok, false);
		assert.strictEqual(parseConfig('[1]').ok, false);
		assert.strictEqual(parseConfig('"x"').ok, false);
	});

	test('copies the file indentation', () => {
		assert.strictEqual(detectIndent('{\n    "a": 1\n}'), '    ');
		assert.strictEqual(detectIndent('{\n\t"a": 1\n}'), '\t');
		assert.strictEqual(detectIndent('{}'), '  ');
	});

	test('creates a new file with the root shape and a final newline', () => {
		const merged = mergeEntireServer(undefined, ROOT_CONFIG, ARGS);
		assert.ok(merged.ok);
		assert.strictEqual(merged.ok && merged.text, '{\n  "mcpServers": {\n    "entire": {\n      "command": "entire",\n      "args": [\n        "mcp"\n      ]\n    }\n  }\n}\n');
	});

	test('merges into an existing file without touching other keys or servers, and keeps their order', () => {
		const original = '{\n    "mcpServers": {\n        "zeta": { "command": "node", "args": ["z.js"], "env": { "K": "v" } },\n        "alpha": { "url": "https://x.example/mcp" }\n    },\n    "other": [1, 2, { "n": null }]\n}\n';
		const merged = mergeEntireServer(original, ROOT_CONFIG, ARGS);
		assert.ok(merged.ok);
		const text = merged.ok ? merged.text : '';
		const before = JSON.parse(original) as { mcpServers: Record<string, unknown>; other: unknown };
		const after = JSON.parse(text) as { mcpServers: Record<string, unknown>; other: unknown };
		assert.deepStrictEqual(Object.keys(after), ['mcpServers', 'other']);
		assert.deepStrictEqual(Object.keys(after.mcpServers), ['zeta', 'alpha', 'entire']);
		assert.deepStrictEqual(after.mcpServers.zeta, before.mcpServers.zeta);
		assert.deepStrictEqual(after.mcpServers.alpha, before.mcpServers.alpha);
		assert.deepStrictEqual(after.other, before.other);
		assert.match(text, /^ {4}"mcpServers"/m);
		assert.ok(text.endsWith('}\n'));
	});

	test('keeps CRLF line endings and a missing final newline', () => {
		const merged = mergeEntireServer('{\r\n  "x": 1\r\n}', ROOT_CONFIG, ARGS);
		assert.ok(merged.ok);
		const text = merged.ok ? merged.text : '';
		assert.ok(text.includes('\r\n'));
		assert.ok(!/[^\r]\n/.test(text));
		assert.ok(text.endsWith('}'));
	});

	test('uses the servers key and the stdio type for the editor file', () => {
		const merged = mergeEntireServer('{ "servers": { "a": { "type": "http", "url": "u" } } }', EDITOR_CONFIG, ARGS);
		assert.ok(merged.ok);
		const parsed = JSON.parse(merged.ok ? merged.text : '') as { servers: Record<string, unknown> };
		assert.deepStrictEqual(parsed.servers.entire, { type: 'stdio', command: 'entire', args: ['mcp'] });
		assert.deepStrictEqual(parsed.servers.a, { type: 'http', url: 'u' });
	});

	test('does nothing when an Entire entry exists, in any shape', () => {
		const result = mergeEntireServer('{"mcpServers":{"entire":{"url":"http://x"}}}', ROOT_CONFIG, ARGS);
		assert.ok(!result.ok && result.reason === 'present');
		const byCommand = mergeEntireServer('{"mcpServers":{"mine":{"command":"/opt/entire","args":["mcp"]}}}', ROOT_CONFIG, ARGS);
		assert.ok(!byCommand.ok && byCommand.reason === 'present');
	});

	test('refuses text that is not plain JSON, or whose servers key is not an object', () => {
		const comment = mergeEntireServer('{\n  // keep\n  "mcpServers": {}\n}', ROOT_CONFIG, ARGS);
		assert.ok(!comment.ok && comment.reason === 'not-json');
		const shape = mergeEntireServer('{"mcpServers": []}', ROOT_CONFIG, ARGS);
		assert.ok(!shape.ok && shape.reason === 'shape');
		const top = mergeEntireServer('[]', ROOT_CONFIG, ARGS);
		assert.ok(!top.ok && top.reason === 'not-json');
	});

	test('writes no absolute path and no login into what it merges', () => {
		const merged = mergeEntireServer('{}', ROOT_CONFIG, projectMcpArguments(['--context', 'bob@host', 'mcp']));
		assert.ok(merged.ok);
		const text = merged.ok ? merged.text : '';
		assert.doesNotMatch(text, /ENTIRE_CONTEXT|bob|--context|"\/|[A-Za-z]:\\\\/);
		assert.match(manualSnippet(ROOT_CONFIG, ARGS), /"mcpServers"[\s\S]*"entire"[\s\S]*"command": "entire"/);
	});

	test('the question names the file, the folder and that other entries are kept', () => {
		const create = confirmProjectMcp(ROOT_CONFIG, '/work/app', false);
		assert.match(create.message, /\.mcp\.json/);
		assert.match(create.detail, /\/work\/app/);
		assert.match(create.detail, /creates \.mcp\.json/);
		assert.match(create.detail, /Every other entry/);
		assert.strictEqual(create.action, 'Add to .mcp.json');
		const editor = confirmProjectMcp(EDITOR_CONFIG, '/work/app', true);
		assert.match(editor.detail, /adds an "entire" entry to \.vscode\/mcp\.json/);
		assert.match(editor.detail, /show it twice/);
	});
});

suite('Entire project MCP configuration files', () => {
	const config = new ProjectMcpConfig();

	function read(folder: IntegrationFolder, file: string): string {
		return fs.readFileSync(path.join(folder.path, file), 'utf8');
	}

	function leftovers(dir: string): string[] {
		return fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));
	}

	test('add-mcp-to-project: creates .mcp.json when it is absent', async () => {
		const folder = makeFolder();
		assert.deepStrictEqual(await config.inspect(folder.path), { kind: 'not-configured', target: ROOT_CONFIG });
		const outcome = await config.add(folder.path, ARGS);
		assert.deepStrictEqual(outcome, { kind: 'added', file: '.mcp.json', created: true });
		assert.deepStrictEqual(JSON.parse(read(folder, '.mcp.json')), { mcpServers: { entire: { command: 'entire', args: ['mcp'] } } });
		assert.deepStrictEqual(await config.inspect(folder.path), { kind: 'configured', file: '.mcp.json' });
		assert.deepStrictEqual(leftovers(folder.path), []);
	});

	test('add-mcp-to-project: merges into an existing file and keeps every other entry and key', async () => {
		const folder = makeFolder();
		const original = { mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'], env: { TOKEN: '${GITHUB_TOKEN}' } } }, extra: { a: [1, 2, 3] } };
		fs.writeFileSync(path.join(folder.path, '.mcp.json'), `${JSON.stringify(original, null, 4)}\n`);
		const outcome = await config.add(folder.path, ARGS);
		assert.deepStrictEqual(outcome, { kind: 'added', file: '.mcp.json', created: false });
		const after = JSON.parse(read(folder, '.mcp.json')) as typeof original & { mcpServers: Record<string, unknown> };
		assert.deepStrictEqual(after.mcpServers.github, original.mcpServers.github);
		assert.deepStrictEqual(after.extra, original.extra);
		assert.deepStrictEqual(Object.keys(after.mcpServers), ['github', 'entire']);
		assert.deepStrictEqual(leftovers(folder.path), []);
	});

	test('existing-entry: nothing is written and the row says it is configured', async () => {
		const folder = makeFolder();
		const text = '{"mcpServers":{"mine":{"command":"/usr/bin/entire","args":["mcp"]}}}';
		fs.writeFileSync(path.join(folder.path, '.mcp.json'), text);
		assert.deepStrictEqual(await config.inspect(folder.path), { kind: 'configured', file: '.mcp.json' });
		assert.deepStrictEqual(await config.add(folder.path, ARGS), { kind: 'present', file: '.mcp.json' });
		assert.strictEqual(read(folder, '.mcp.json'), text);
	});

	test('refuses a file that is not plain JSON, leaves it as it was, and gives the text to add', async () => {
		const folder = makeFolder();
		const text = '{\n  // my servers\n  "mcpServers": {}\n}\n';
		fs.writeFileSync(path.join(folder.path, '.mcp.json'), text);
		const state = await config.inspect(folder.path);
		assert.strictEqual(state.kind, 'unreadable');
		const outcome = await config.add(folder.path, ARGS);
		assert.strictEqual(outcome.kind, 'refused');
		assert.match(outcome.kind === 'refused' ? outcome.snippet : '', /"entire"/);
		assert.strictEqual(read(folder, '.mcp.json'), text);
		assert.deepStrictEqual(leftovers(folder.path), []);
	});

	test('uses .vscode/mcp.json only when it exists and .mcp.json does not, with the servers shape', async () => {
		const folder = makeFolder();
		fs.mkdirSync(path.join(folder.path, '.vscode'));
		fs.writeFileSync(path.join(folder.path, '.vscode', 'mcp.json'), '{\n  "servers": { "a": { "type": "stdio", "command": "x" } }\n}\n');
		assert.deepStrictEqual(await config.plan(folder.path), { target: EDITOR_CONFIG, exists: true });
		assert.deepStrictEqual(await config.add(folder.path, ARGS), { kind: 'added', file: '.vscode/mcp.json', created: false });
		const after = JSON.parse(read(folder, '.vscode/mcp.json')) as { servers: Record<string, unknown> };
		assert.deepStrictEqual(after.servers.entire, { type: 'stdio', command: 'entire', args: ['mcp'] });
		assert.deepStrictEqual(after.servers.a, { type: 'stdio', command: 'x' });
		assert.ok(!fs.existsSync(path.join(folder.path, '.mcp.json')));

		const both = makeFolder();
		fs.mkdirSync(path.join(both.path, '.vscode'));
		fs.writeFileSync(path.join(both.path, '.vscode', 'mcp.json'), '{}');
		fs.writeFileSync(path.join(both.path, '.mcp.json'), '{}');
		assert.deepStrictEqual((await config.plan(both.path)).target, ROOT_CONFIG);
		await config.add(both.path, ARGS);
		assert.strictEqual(read(both, '.vscode/mcp.json'), '{}');
		const neither = makeFolder();
		assert.deepStrictEqual(await config.plan(neither.path), { target: ROOT_CONFIG, exists: false });
		await config.add(neither.path, ARGS);
		assert.ok(!fs.existsSync(path.join(neither.path, '.vscode')));
	});

	test('does not follow a link at the file, so nothing outside the folder is written', async () => {
		const folder = makeFolder();
		const outside = makeFolder();
		const victim = path.join(outside.path, 'shared.json');
		fs.writeFileSync(victim, '{}');
		fs.symlinkSync(victim, path.join(folder.path, '.mcp.json'));
		const outcome = await config.add(folder.path, ARGS);
		assert.strictEqual(outcome.kind, 'refused');
		assert.strictEqual(fs.readFileSync(victim, 'utf8'), '{}');
		assert.strictEqual((await config.inspect(folder.path)).kind, 'unreadable');
	});

	test('refuses a directory or a named pipe at the file, without opening it for good', async function () {
		const folder = makeFolder();
		fs.mkdirSync(path.join(folder.path, '.mcp.json'));
		const directory = await config.add(folder.path, ARGS);
		assert.strictEqual(directory.kind, 'refused');
		assert.match(directory.kind === 'refused' ? directory.detail : '', /not a file/);
		if (process.platform !== 'win32') {
			const piped = makeFolder();
			childProcess.execFileSync('mkfifo', [path.join(piped.path, '.mcp.json')]);
			const outcome = await config.add(piped.path, ARGS);
			assert.strictEqual(outcome.kind, 'refused');
			assert.match(outcome.kind === 'refused' ? outcome.detail : '', /not a file/);
		}
	});

	test('openRegularFile reads from the handle it checked, and names a link, a directory and a missing file', async function () {
		const folder = makeFolder();
		const file = path.join(folder.path, 'a.json');
		fs.writeFileSync(file, 'hello');
		const opened = await openRegularFile(file);
		assert.strictEqual(opened.kind, 'ok');
		if (opened.kind === 'ok') {
			// Replacing the name after the open does not change what the handle reads.
			fs.rmSync(file);
			fs.writeFileSync(file, 'other');
			assert.strictEqual(await opened.handle.readFile({ encoding: 'utf8' }), 'hello');
			await opened.handle.close();
		}
		assert.strictEqual((await openRegularFile(path.join(folder.path, 'none'))).kind, 'absent');
		assert.strictEqual((await openRegularFile(folder.path)).kind, 'not-file');
		if (process.platform !== 'win32') {
			fs.symlinkSync(file, path.join(folder.path, 'link.json'));
			assert.strictEqual((await openRegularFile(path.join(folder.path, 'link.json'))).kind, 'link');
		}
	});

	test('does not write through a .vscode directory that leads outside the folder', async () => {
		const folder = makeFolder();
		const outside = makeFolder();
		fs.writeFileSync(path.join(outside.path, 'mcp.json'), '{}');
		fs.symlinkSync(outside.path, path.join(folder.path, '.vscode'));
		const outcome = await config.add(folder.path, ARGS);
		assert.strictEqual(outcome.kind, 'refused');
		assert.strictEqual(fs.readFileSync(path.join(outside.path, 'mcp.json'), 'utf8'), '{}');
	});

	test('reports a folder that cannot be written to without leaving a temporary file', async () => {
		const outcome = await config.add(path.join(makeFolder().path, 'missing'), ARGS);
		assert.strictEqual(outcome.kind, 'failed');
	});

	test('keeps the permissions of the file it replaces', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		const folder = makeFolder();
		const file = path.join(folder.path, '.mcp.json');
		fs.writeFileSync(file, '{}');
		fs.chmodSync(file, 0o600);
		await config.add(folder.path, ARGS);
		assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
	});
});

suite('Entire integration detection', () => {
	test('status-per-project: the same plugin is installed in one folder and not installed in another', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const withGraph = makeFolder({ graph: 'managed' });
		const without = makeFolder();
		const folders = await folderReading(detectorFor(cli, [withGraph, without]));
		assert.strictEqual(row(folders[0], 'graph').state.kind, 'installed');
		assert.strictEqual(row(folders[1], 'graph').state.kind, 'missing');
		assert.strictEqual(folders[0].path, withGraph.path);
	});

	test('runs the CLI from each folder', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const first = makeFolder();
		const second = makeFolder();
		await folderReading(detectorFor(cli, [first, second]));
		const cwds = new Set(cli.recorded.map(item => item.invocation.cwd));
		assert.ok(cwds.has(first.path) && cwds.has(second.path));
		assert.ok(cli.recorded.filter(item => item.invocation.cwd !== undefined).every(item => item.invocation.cwd === first.path || item.invocation.cwd === second.path));
		assert.ok(cli.recorded.some(item => item.invocation.args.includes('list') && item.invocation.cwd === second.path));
	});

	test('reports a plugin the CLI reaches only through the PATH as available, and not as installed', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder({ graph: 'path', brain: 'managed' });
		const [result] = await folderReading(detectorFor(cli, [folder]));
		assert.strictEqual(row(result, 'graph').state.kind, 'on-path');
		assert.strictEqual(row(result, 'brain').state.kind, 'installed');
		assert.strictEqual(row(result, 'investigate').state.kind, 'missing');
	});

	test('shows a plain failure as unknown with the reason, not as not installed', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const [result] = await folderReading(detectorFor(cli, [makeFolder()], { suggested: ['weird', 'session'] }));
		const weird = row(result, 'weird').state;
		assert.strictEqual(weird.kind, 'unknown');
		const builtin = row(result, 'session').state;
		assert.ok(builtin.kind === 'unknown' && /command of the Entire CLI itself/.test(builtin.detail));
	});

	test('lists installed plugins that are not suggested, after the suggested ones', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const [result] = await folderReading(detectorFor(cli, [makeFolder({ extra: 'managed', graph: 'managed' })]));
		assert.deepStrictEqual(result.plugins.map(item => item.name), ['graph', 'investigate', 'brain', 'extra']);
		assert.deepStrictEqual(result.plugins.map(item => item.suggested), [true, true, true, false]);
	});

	test('the suggested plugins come from the setting', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const [result] = await folderReading(detectorFor(cli, [makeFolder()], { suggested: ['brain'] }));
		assert.deepStrictEqual(result.plugins.map(item => item.name), ['brain']);
		const [none] = await folderReading(detectorFor(cli, [makeFolder()], { suggested: [] }));
		assert.deepStrictEqual(none.plugins, []);
	});

	test('names every plugin as unknown when the list cannot be read', async () => {
		const cli = fakePluginCli({ stateful: 'folder', fail: { plugin: 'plugin index offline' } });
		const [result] = await folderReading(detectorFor(cli, [makeFolder()]));
		assert.ok(result.plugins.every(item => item.state.kind === 'unknown'));
		assert.match(result.pluginsDetail ?? '', /'plugin' command/);
	});

	test('reports the MCP server as offered, off in the workspace, or unavailable when the CLI lacks mcp', async () => {
		const folder = makeFolder();
		const on = await folderReading(detectorFor(fakePluginCli({ stateful: 'folder' }), [folder]));
		assert.deepStrictEqual(on[0].mcp.editor, { kind: 'offered' });
		const off = await folderReading(detectorFor(fakePluginCli({ stateful: 'folder' }), [folder], { enabled: () => false }));
		assert.deepStrictEqual(off[0].mcp.editor, { kind: 'off' });
		const old = await folderReading(detectorFor(fakePluginCli({ stateful: 'folder', helps: { 'mcp_--help': null } }), [folder]));
		assert.strictEqual(old[0].mcp.editor.kind, 'unavailable');
		assert.strictEqual(describeMcpEditor(old[0].mcp.editor), 'the CLI lacks mcp');
	});

	test('the MCP setting is read for each folder', async () => {
		const first = makeFolder();
		const second = makeFolder();
		const result = await folderReading(detectorFor(fakePluginCli({ stateful: 'folder' }), [first, second], { enabled: folder => folder === first.path }));
		assert.strictEqual(result[0].mcp.editor.kind, 'offered');
		assert.strictEqual(result[1].mcp.editor.kind, 'off');
	});

	test('shows whether the project configuration has the entry', async () => {
		const configured = makeFolder();
		fs.writeFileSync(path.join(configured.path, '.mcp.json'), '{"mcpServers":{"entire":{"command":"entire","args":["mcp"]}}}');
		const bare = makeFolder();
		const result = await folderReading(detectorFor(fakePluginCli({ stateful: 'folder' }), [configured, bare]));
		assert.deepStrictEqual(result[0].mcp.config, { kind: 'configured', file: '.mcp.json' });
		assert.deepStrictEqual(result[1].mcp.config, { kind: 'not-configured', target: ROOT_CONFIG });
	});

	test('no-cli: a missing CLI is a reading of its own, and no folder is a reading of its own', async () => {
		const reading = await detectorFor(fakePluginCli({ noCli: true }), [makeFolder()]).detect();
		assert.deepStrictEqual(reading, { kind: 'no-cli', cli: { kind: 'absent' } });
		assert.deepStrictEqual(await detectorFor(fakePluginCli({ stateful: 'folder' }), []).detect(), { kind: 'no-folder' });
	});
});

class MemoryState implements OfferState {
	readonly values = new Map<string, unknown>();
	get<T>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}
	update(key: string, value: unknown): Promise<void> {
		this.values.set(key, value);
		return Promise.resolve();
	}
}

function readingFor(folders: readonly { folder: IntegrationFolder; plugin?: PluginRow['state']; config?: McpConfigState; editorOk?: boolean }[]): IntegrationReading {
	return {
		kind: 'folders',
		folders: folders.map(item => ({
			name: item.folder.name,
			path: item.folder.path,
			plugins: [{ name: 'graph', suggested: true, state: item.plugin ?? { kind: 'missing' } }],
			mcp: {
				editor: item.editorOk === false ? { kind: 'unavailable', reason: 'old', detail: 'no mcp' } : { kind: 'offered' },
				config: item.config ?? { kind: 'not-configured', target: ROOT_CONFIG },
			},
		})),
	};
}

interface OfferScript {
	plugins?: PluginOfferAnswer | undefined;
	picked?: readonly string[];
	project?: ProjectOfferAnswer | undefined;
}

function offerHarness(script: OfferScript = {}, setting = true) {
	const log = { pluginOffers: [] as (readonly string[])[], projectOffers: [] as string[], installs: [] as string[], adds: [] as string[], refreshes: 0, stateAtOffer: undefined as unknown };
	const machine = new MemoryState();
	const workspace = new MemoryState();
	const ui: OfferUi = {
		offerPlugins: names => {
			log.pluginOffers.push(names);
			log.stateAtOffer = machine.get(PLUGIN_OFFER_KEY);
			return Promise.resolve('plugins' in script ? script.plugins : 'not-now');
		},
		pickPlugins: names => Promise.resolve(script.picked ?? names),
		offerProjectConfig: (folder, file) => {
			log.projectOffers.push(`${folder.path}|${file}`);
			return Promise.resolve('project' in script ? script.project : 'not-now');
		},
	};
	let enabled = setting;
	const build = (workspaceState: OfferState) => new IntegrationOffers({
		machine,
		workspace: workspaceState,
		enabled: () => enabled,
		install: name => {
			log.installs.push(name);
			return Promise.resolve();
		},
		addToProject: folder => {
			log.adds.push(folder.path);
			return Promise.resolve();
		},
		refresh: () => {
			log.refreshes += 1;
			return Promise.resolve();
		},
		ui,
	});
	return { offers: build(workspace), build, log, machine, workspace, disable: () => void (enabled = false) };
}

suite('Entire integration offers', () => {
	const folder: IntegrationFolder = { name: 'app', path: '/work/app' };

	test('offer-once: shows one notification listing the missing plugins, recorded when shown', async () => {
		const { offers, log, machine } = offerHarness();
		assert.strictEqual(await offers.offerPlugins(readingFor([{ folder }])), true);
		assert.deepStrictEqual(log.pluginOffers, [['graph']]);
		assert.strictEqual(log.stateAtOffer, true, 'the offer is recorded before the answer');
		assert.strictEqual(machine.get(PLUGIN_OFFER_KEY), true);
	});

	test('offer-once: is not shown again after dismissal, after Not now, or in another workspace', async () => {
		for (const answer of [undefined, 'not-now'] as const) {
			const { offers, build, log, machine } = offerHarness({ plugins: answer });
			await offers.offerPlugins(readingFor([{ folder }]));
			const later = build(new MemoryState());
			assert.strictEqual(await later.offerPlugins(readingFor([{ folder: { name: 'other', path: '/other' } }])), false);
			assert.strictEqual(await offers.offerPlugins(readingFor([{ folder }])), false);
			assert.strictEqual(log.pluginOffers.length, 1, String(answer));
			assert.strictEqual(machine.get(PLUGIN_OFFER_KEY), true);
		}
	});

	test('offer-once: Install lets the person pick which plugins, installs them through the install flow and detects again', async () => {
		const { offers, log } = offerHarness({ plugins: 'install', picked: ['graph'] });
		const reading: IntegrationReading = {
			kind: 'folders',
			folders: [
				{
					name: 'a',
					path: '/a',
					plugins: [
						{ name: 'graph', suggested: true, state: { kind: 'missing' } },
						{ name: 'brain', suggested: true, state: { kind: 'missing' } },
					],
					mcp: { editor: { kind: 'offered' }, config: { kind: 'configured', file: '.mcp.json' } },
				},
			],
		};
		await offers.offerPlugins(reading);
		assert.deepStrictEqual(log.pluginOffers, [['graph', 'brain']]);
		assert.deepStrictEqual(log.installs, ['graph']);
		assert.strictEqual(log.refreshes, 1);
	});

	test('offer-once: installs nothing when the picker is dismissed or names a plugin that was not offered', async () => {
		const dismissed = offerHarness({ plugins: 'install', picked: [] });
		await dismissed.offers.offerPlugins(readingFor([{ folder }]));
		assert.deepStrictEqual(dismissed.log.installs, []);
		const foreign = offerHarness({ plugins: 'install', picked: ['rm-rf'] });
		await foreign.offers.offerPlugins(readingFor([{ folder }]));
		assert.deepStrictEqual(foreign.log.installs, []);
	});

	test('no-cli: no offer is shown and nothing is recorded when the CLI is missing', async () => {
		const { offers, log, machine, workspace } = offerHarness();
		await offers.offer({ kind: 'no-cli', cli: { kind: 'absent' } });
		await offers.offer({ kind: 'no-folder' });
		assert.deepStrictEqual(log.pluginOffers, []);
		assert.deepStrictEqual(log.projectOffers, []);
		assert.strictEqual(machine.values.size + workspace.values.size, 0);
	});

	test('is never shown when the setting is off, and is shown later once it is on', async () => {
		const off = offerHarness({}, false);
		await off.offers.offer(readingFor([{ folder }]));
		assert.deepStrictEqual(off.log.pluginOffers, []);
		assert.deepStrictEqual(off.log.projectOffers, []);
		assert.strictEqual(off.machine.values.size, 0);
	});

	test('asks nothing when no suggested plugin is missing or the state is unknown', async () => {
		const { offers, log } = offerHarness();
		await offers.offerPlugins(readingFor([{ folder, plugin: { kind: 'installed', detail: '' } }]));
		await offers.offerPlugins(readingFor([{ folder, plugin: { kind: 'unknown', detail: 'x' } }]));
		await offers.offerPlugins(readingFor([{ folder, plugin: { kind: 'on-path' } }]));
		assert.deepStrictEqual(log.pluginOffers, []);
	});

	test('add-mcp-to-project: asks once per project, recorded when shown, and adds on yes', async () => {
		const { offers, log, workspace } = offerHarness({ project: 'add' });
		const reading = readingFor([{ folder }]);
		assert.deepStrictEqual(await offers.offerProjects(reading), [folder.path]);
		assert.deepStrictEqual(log.projectOffers, [`${folder.path}|.mcp.json`]);
		assert.deepStrictEqual(log.adds, [folder.path]);
		assert.strictEqual(workspace.get(projectOfferKey(folder.path)), true);
		assert.deepStrictEqual(await offers.offerProjects(reading), []);
		assert.strictEqual(log.projectOffers.length, 1);
	});

	test('asks at most once per project after Not now, after Don\'t ask, and after dismissal, and adds nothing', async () => {
		for (const answer of ['not-now', 'never', undefined] as const) {
			const { offers, log } = offerHarness({ project: answer });
			const reading = readingFor([{ folder }]);
			await offers.offerProjects(reading);
			await offers.offerProjects(reading);
			assert.strictEqual(log.projectOffers.length, 1, String(answer));
			assert.deepStrictEqual(log.adds, []);
		}
	});

	test('asks for each project of a multi-root workspace, once each', async () => {
		const second: IntegrationFolder = { name: 'lib', path: '/work/lib' };
		const { offers, log } = offerHarness();
		const reading = readingFor([{ folder }, { folder: second }]);
		await offers.offerProjects(reading);
		await offers.offerProjects(reading);
		assert.deepStrictEqual(log.projectOffers, [`${folder.path}|.mcp.json`, `${second.path}|.mcp.json`]);
	});

	test('existing-entry: offers nothing when the project already has an entry, the file is unreadable, or the CLI lacks mcp', async () => {
		const { offers, log } = offerHarness();
		await offers.offerProjects(readingFor([{ folder, config: { kind: 'configured', file: '.mcp.json' } }]));
		await offers.offerProjects(readingFor([{ folder, config: { kind: 'unreadable', file: '.mcp.json', detail: 'x' } }]));
		await offers.offerProjects(readingFor([{ folder, editorOk: false }]));
		assert.deepStrictEqual(log.projectOffers, []);
	});

	test('names .vscode/mcp.json when that is the target', async () => {
		const { offers, log } = offerHarness();
		await offers.offerProjects(readingFor([{ folder, config: { kind: 'not-configured', target: EDITOR_CONFIG } }]));
		assert.deepStrictEqual(log.projectOffers, [`${folder.path}|.vscode/mcp.json`]);
	});

	test('respects the setting for the project question too', async () => {
		const { offers, log, disable } = offerHarness();
		disable();
		assert.deepStrictEqual(await offers.offerProjects(readingFor([{ folder }])), []);
		assert.deepStrictEqual(log.projectOffers, []);
	});
});

function integrationUi() {
	const log = { prompts: [] as ControlConfirmation[], informs: [] as string[], warnings: [] as string[], snippets: [] as { message: string; snippet: string }[] };
	const script = { confirm: true };
	const ui: IntegrationUi = {
		confirm: prompt => {
			log.prompts.push(prompt);
			return Promise.resolve(script.confirm);
		},
		inform: message => {
			log.informs.push(message);
			return Promise.resolve();
		},
		warn: message => {
			log.warnings.push(message);
			return Promise.resolve();
		},
		showSnippet: (message, snippet) => {
			log.snippets.push({ message, snippet });
			return Promise.resolve();
		},
	};
	return { ui, log, script };
}

suite('Entire integration row actions', () => {
	function mcpSource(cli: FakePluginCli) {
		return (folder: string) => new McpServerService({ runner: cli.runner, workspaceRoot: () => folder });
	}

	test('add-mcp-to-project: asks naming the file, then creates .mcp.json with no absolute path and no login', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		cli.runner.setContext('bob@us.auth.entire.io');
		const folder = makeFolder();
		const { ui, log } = integrationUi();
		let refreshed = 0;
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve(void (refreshed += 1)) };
		assert.strictEqual(await addMcpToProject(deps, folder, false), 'added');
		assert.match(log.prompts[0].message, /\.mcp\.json/);
		assert.match(log.prompts[0].detail, new RegExp(folder.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		const text = fs.readFileSync(path.join(folder.path, '.mcp.json'), 'utf8');
		assert.deepStrictEqual(JSON.parse(text), { mcpServers: { entire: { command: 'entire', args: ['mcp'] } } });
		assert.doesNotMatch(text, /ENTIRE_CONTEXT|bob|--context/);
		assert.ok(!text.includes(cli.binary) && !text.includes(cli.dir));
		assert.strictEqual(refreshed, 1);
		assert.match(log.informs[0], /\.mcp\.json/);
	});

	test('add-mcp-to-project: writes nothing when the question is declined', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const { ui, script } = integrationUi();
		script.confirm = false;
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve() };
		assert.strictEqual(await addMcpToProject(deps, folder, false), 'cancelled');
		assert.deepStrictEqual(fs.readdirSync(folder.path), []);
	});

	test('add-mcp-to-project: an answer to the one-time offer is the confirmation, so no second question is asked', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const { ui, log } = integrationUi();
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve() };
		assert.strictEqual(await addMcpToProject(deps, folder, true), 'added');
		assert.deepStrictEqual(log.prompts, []);
	});

	test('existing-entry: says nothing is changed and leaves the file alone', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const text = '{"servers":{"entire":{"type":"stdio","command":"entire","args":["mcp"]}}}';
		fs.mkdirSync(path.join(folder.path, '.vscode'));
		fs.writeFileSync(path.join(folder.path, '.vscode', 'mcp.json'), text);
		const { ui, log } = integrationUi();
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve() };
		assert.strictEqual(await addMcpToProject(deps, folder, true), 'present');
		assert.strictEqual(fs.readFileSync(path.join(folder.path, '.vscode', 'mcp.json'), 'utf8'), text);
		assert.match(log.informs[0], /Nothing was changed/);
	});

	test('add-mcp-to-project: shows what to add by hand for a file that is not plain JSON and writes nothing', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const text = '{ /* mine */ "mcpServers": {} }';
		fs.writeFileSync(path.join(folder.path, '.mcp.json'), text);
		const { ui, log } = integrationUi();
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve() };
		assert.strictEqual(await addMcpToProject(deps, folder, false), 'refused');
		assert.strictEqual(fs.readFileSync(path.join(folder.path, '.mcp.json'), 'utf8'), text);
		assert.match(log.snippets[0].message, /not changed.*plain JSON/);
		assert.match(log.snippets[0].snippet, /"entire"/);
	});

	test('add-mcp-to-project: says why when the CLI has no mcp command, and writes nothing', async () => {
		const cli = fakePluginCli({ stateful: 'folder', helps: { 'mcp_--help': null } });
		const folder = makeFolder();
		const { ui, log } = integrationUi();
		const deps = { config: new ProjectMcpConfig(), mcp: mcpSource(cli), ui, refresh: () => Promise.resolve() };
		assert.strictEqual(await addMcpToProject(deps, folder, false), 'unavailable');
		assert.match(log.warnings[0], /no MCP server/);
		assert.deepStrictEqual(fs.readdirSync(folder.path), []);
	});

	function pluginFlows(cli: FakePluginCli, folder: IntegrationFolder, confirm = true) {
		const prompts: ControlConfirmation[] = [];
		const ui: PluginUi = {
			pickPlugin: () => Promise.resolve(undefined),
			pickSubcommand: () => Promise.resolve(''),
			askArguments: () => Promise.resolve(''),
			confirm: prompt => {
				prompts.push(prompt);
				return Promise.resolve(confirm);
			},
			withProgress: (_title, work) => work(new AbortController().signal),
			warn: () => Promise.resolve(),
			offerInstall: () => Promise.resolve(false),
			showOutput: () => Promise.resolve(),
			inform: () => Promise.resolve(),
		};
		const deps: PluginDependencies = {
			source: pluginsFor(cli)(folder.path),
			acting: () => Promise.resolve(ALICE),
			ui,
			suggested: () => DEFAULT_SUGGESTED_PLUGINS,
			running: { active: false },
		};
		return { deps, prompts };
	}

	test('click-to-install: runs the install flow with its question and the row is detected as installed afterwards', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const detector = detectorFor(cli, [folder]);
		assert.strictEqual(row((await folderReading(detector))[0], 'graph').state.kind, 'missing');
		const { deps, prompts } = pluginFlows(cli, folder);
		let latest: readonly FolderIntegrations[] = [];
		const result = await installFromRow({ plugins: deps, refresh: async () => void (latest = await folderReading(detector)) }, 'graph');
		assert.strictEqual(result, 'installed');
		assert.match(prompts[0].message, /Install the graph plugin/);
		assert.match(prompts[0].detail, /downloads the plugin named "graph"/);
		assert.deepStrictEqual(cli.calls().filter(line => line.includes('plugin install')), [`${ALICE.name}|${ALICE.name}|plugin install --yes -- graph`]);
		assert.strictEqual(row(latest[0], 'graph').state.kind, 'installed');
	});

	test('click-to-install: nothing is installed when the question is declined, and the row stays missing', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const detector = detectorFor(cli, [folder]);
		const { deps } = pluginFlows(cli, folder, false);
		let latest: readonly FolderIntegrations[] = [];
		assert.strictEqual(await installFromRow({ plugins: deps, refresh: async () => void (latest = await folderReading(detector)) }, 'graph'), 'cancelled');
		assert.deepStrictEqual(cli.calls().filter(line => line.includes('plugin install')), []);
		assert.strictEqual(row(latest[0], 'graph').state.kind, 'missing');
	});

	function mcpFlows(cli: FakePluginCli, state: { enabled: boolean }, accept = true): { deps: McpDependencies; offered: () => number } {
		let offered = 0;
		const ui: McpUi = {
			warn: () => Promise.resolve(),
			inform: () => Promise.resolve(),
			showServers: () => Promise.resolve(true),
			offerEnable: () => {
				offered += 1;
				return Promise.resolve(accept);
			},
			copy: () => Promise.resolve(),
		};
		return {
			deps: {
				source: mcpSource(cli)(cli.dir),
				ui,
				enabled: () => state.enabled,
				enable: () => Promise.resolve(void (state.enabled = true)),
				refresh: () => undefined,
			},
			offered: () => offered,
		};
	}

	test('enable-mcp: runs the ask-before-changing flow and the row updates', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const state = { enabled: false };
		const detector = detectorFor(cli, [folder], { enabled: () => state.enabled });
		assert.strictEqual((await folderReading(detector))[0].mcp.editor.kind, 'off');
		const { deps, offered } = mcpFlows(cli, state);
		const { ui, log } = integrationUi();
		let latest: readonly FolderIntegrations[] = [];
		const result = await enableMcpFromRow({ mcp: deps, enabledFor: () => state.enabled, ui, refresh: async () => void (latest = await folderReading(detector)) }, folder);
		assert.strictEqual(result, 'listed');
		assert.strictEqual(offered(), 1);
		assert.strictEqual(latest[0].mcp.editor.kind, 'offered');
		assert.deepStrictEqual(log.warnings, []);
	});

	test('enable-mcp: nothing changes when the question is declined', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const state = { enabled: false };
		const { deps } = mcpFlows(cli, state, false);
		const { ui, log } = integrationUi();
		const result = await enableMcpFromRow({ mcp: deps, enabledFor: () => state.enabled, ui, refresh: () => Promise.resolve() }, folder);
		assert.strictEqual(result, 'disabled');
		assert.strictEqual(state.enabled, false);
		assert.deepStrictEqual(log.warnings, []);
	});

	test('enable-mcp: says so when a workspace setting keeps the server off after the user setting is changed', async () => {
		const cli = fakePluginCli({ stateful: 'folder' });
		const folder = makeFolder();
		const state = { enabled: false };
		const { deps } = mcpFlows(cli, state);
		const { ui, log } = integrationUi();
		await enableMcpFromRow({ mcp: deps, enabledFor: () => false, ui, refresh: () => Promise.resolve() }, folder);
		assert.match(log.warnings[0], /still off.*overrides your user setting/);
	});
});

suite('Entire integrations view', () => {
	const sample = (name: string, path: string, state: PluginRow['state'], editor: FolderIntegrations['mcp']['editor'], config: McpConfigState): FolderIntegrations => ({
		name,
		path,
		plugins: [{ name: 'graph', suggested: true, state }],
		mcp: { editor, config },
	});

	function rows(nodes: readonly IntegrationNode[]): IntegrationNode[] {
		return nodes.flatMap(node => (node.kind === 'group' ? [node, ...rows(node.children)] : [node]));
	}

	test('shows the rows directly for one folder and groups them by folder for several', () => {
		const one = buildIntegrationNodes({ kind: 'folders', folders: [sample('a', '/a', { kind: 'missing' }, { kind: 'offered' }, { kind: 'configured', file: '.mcp.json' })] });
		assert.deepStrictEqual(one.map(node => node.kind), ['row', 'group']);
		assert.deepStrictEqual(one.map(node => node.label), ['graph', 'MCP server']);
		const many = buildIntegrationNodes({
			kind: 'folders',
			folders: [
				sample('a', '/a', { kind: 'missing' }, { kind: 'offered' }, { kind: 'configured', file: '.mcp.json' }),
				sample('b', '/b', { kind: 'installed', detail: '' }, { kind: 'off' }, { kind: 'not-configured', target: ROOT_CONFIG }),
			],
		});
		assert.deepStrictEqual(many.map(node => node.label), ['a', 'b']);
		assert.ok(many.every(node => node.kind === 'group'));
	});

	test('puts the actions only on the rows that can use them', () => {
		const nodes = rows(buildIntegrationNodes({ kind: 'folders', folders: [sample('a', '/a', { kind: 'missing' }, { kind: 'off' }, { kind: 'not-configured', target: ROOT_CONFIG })] }));
		const withAction = nodes.flatMap(node => (node.kind === 'row' && node.contextValue ? [node.contextValue] : []));
		assert.deepStrictEqual(withAction, [PLUGIN_MISSING, MCP_OFF, MCP_CONFIG_ADDABLE]);
		const quiet = rows(buildIntegrationNodes({ kind: 'folders', folders: [sample('a', '/a', { kind: 'installed', detail: '' }, { kind: 'offered' }, { kind: 'configured', file: '.mcp.json' })] }));
		assert.ok(quiet.every(node => node.kind === 'group' || node.contextValue === undefined));
		const targets = rows(buildIntegrationNodes({ kind: 'folders', folders: [sample('a', '/a', { kind: 'missing' }, { kind: 'off' }, { kind: 'unreadable', file: '.mcp.json', detail: 'x' })] }));
		assert.deepStrictEqual(
			targets.flatMap(node => (node.kind === 'row' && node.target ? [node.target.kind] : [])),
			['plugin', 'mcp-enable', 'mcp-config'],
		);
	});

	test('shows the MCP server as one row when the CLI lacks mcp, and still says what the project file holds', () => {
		const nodes = buildIntegrationNodes({
			kind: 'folders',
			folders: [sample('a', '/a', { kind: 'installed', detail: '' }, { kind: 'unavailable', reason: 'old', detail: 'x' }, { kind: 'configured', file: '.mcp.json' })],
		});
		const mcp = nodes[1];
		assert.ok(mcp.kind === 'row');
		assert.strictEqual(mcp.kind === 'row' && mcp.description, 'the CLI lacks mcp · in .mcp.json');
	});

	test('a reading without folders has no rows', () => {
		assert.deepStrictEqual(buildIntegrationNodes({ kind: 'no-cli', cli: { kind: 'absent' } }), []);
		assert.deepStrictEqual(buildIntegrationNodes({ kind: 'no-folder' }), []);
	});

	function providerWith(readings: IntegrationReading[]) {
		let calls = 0;
		const provider = new IntegrationsProvider({
			detect: () => {
				const reading = readings[Math.min(calls, readings.length - 1)];
				calls += 1;
				return Promise.resolve(reading);
			},
		});
		return { provider, calls: () => calls };
	}

	test('no-cli: the view says so with a way out and has no rows or offer-worthy state', async () => {
		const { provider } = providerWith([{ kind: 'no-cli', cli: { kind: 'absent' } }]);
		const seen: IntegrationReading[] = [];
		provider.onDidDetect(reading => seen.push(reading));
		await provider.refresh();
		assert.match(provider.viewMessage ?? '', /not installed.*refresh/i);
		assert.strictEqual(provider.state, 'no-cli');
		assert.deepStrictEqual(provider.getChildren(), []);
		assert.deepStrictEqual(missingPlugins(seen[0]), []);
		provider.dispose();
	});

	test('detects when first opened and when refreshed, and does not poll', async () => {
		const reading: IntegrationReading = { kind: 'folders', folders: [sample('a', '/a', { kind: 'missing' }, { kind: 'offered' }, { kind: 'configured', file: '.mcp.json' })] };
		const { provider, calls } = providerWith([reading]);
		assert.deepStrictEqual(provider.getChildren(), []);
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(calls(), 1);
		assert.strictEqual(provider.getChildren().length, 2);
		provider.getChildren();
		await new Promise(resolve => setTimeout(resolve, 250));
		assert.strictEqual(calls(), 1, 'nothing detects on its own');
		await provider.refresh();
		assert.strictEqual(calls(), 2);
		provider.dispose();
	});

	test('refreshIfStarted does nothing for a view nobody opened', async () => {
		const { provider, calls } = providerWith([{ kind: 'no-folder' }]);
		await provider.refreshIfStarted();
		assert.strictEqual(calls(), 0);
		await provider.refresh();
		await provider.refreshIfStarted();
		assert.strictEqual(calls(), 2);
		provider.dispose();
	});

	test('drops the answer of a detection that a newer one replaced', async () => {
		const slow = { release: (_reading: IntegrationReading) => undefined as void };
		let calls = 0;
		const provider = new IntegrationsProvider({
			detect: () => {
				calls += 1;
				if (calls === 1) {
					return new Promise<IntegrationReading>(resolve => void (slow.release = resolve));
				}
				return Promise.resolve<IntegrationReading>({ kind: 'no-folder' });
			},
		});
		const seen: string[] = [];
		provider.onDidDetect(reading => seen.push(reading.kind));
		const first = provider.refresh();
		await provider.refresh();
		slow.release({ kind: 'no-cli', cli: { kind: 'absent' } });
		await first;
		assert.deepStrictEqual(seen, ['no-folder']);
		provider.dispose();
	});

	test('reports a detection that throws as a message, not as an unhandled error', async () => {
		const provider = new IntegrationsProvider({ detect: () => Promise.reject(new Error('boom')) });
		await provider.refresh();
		assert.match(provider.viewMessage ?? '', /could not be checked: boom/);
		provider.dispose();
	});

	test('builds tree items with the context value the manifest matches', () => {
		const { provider } = providerWith([{ kind: 'no-folder' }]);
		const missing = buildIntegrationNodes({ kind: 'folders', folders: [sample('a', '/a', { kind: 'missing' }, { kind: 'offered' }, { kind: 'configured', file: '.mcp.json' })] })[0];
		assert.strictEqual(provider.getTreeItem(missing).contextValue, PLUGIN_MISSING);
		assert.strictEqual(provider.getTreeItem(missing).description, 'not installed');
		provider.dispose();
	});

	test('nothing in the integration modules sets a timer', () => {
		const root = path.resolve(__dirname, '..', '..', 'src');
		const files = [
			'lib/entire/integrations.ts',
			'lib/entire/mcpProjectConfig.ts',
			'services/integrationDetection.ts',
			'services/integrationOffers.ts',
			'services/projectMcpConfig.ts',
			'providers/integrationsProvider.ts',
			'commands/integrations.ts',
			'commands/integrationCommands.ts',
			'commands/integrationUi.ts',
		];
		for (const file of files) {
			assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /\bset(?:Timeout|Interval|Immediate)\b/, file);
		}
	});
});

suite('Entire integration manifest', () => {
	interface Manifest {
		contributes: {
			views: Record<string, { id: string }[]>;
			commands: { command: string }[];
			configuration: { properties: Record<string, { default?: unknown; type?: string }> };
			menus: Record<string, { command: string; when?: string }[]>;
		};
	}
	const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as Manifest;

	test('declares the view, its commands and inline actions, and both settings', () => {
		assert.ok(manifest.contributes.views.entirely.some(view => view.id === 'entirely.integrations'));
		const commands = manifest.contributes.commands.map(item => item.command);
		for (const id of ['entirely.refreshIntegrations', 'entirely.installIntegration', 'entirely.enableMcpIntegration', 'entirely.addMcpToProject']) {
			assert.ok(commands.includes(id), id);
		}
		const properties = manifest.contributes.configuration.properties;
		assert.deepStrictEqual(properties['entirely.suggestedPlugins'].default, ['graph', 'investigate', 'brain']);
		assert.strictEqual(properties['entirely.offerIntegrationInstall'].default, true);
		const inline = manifest.contributes.menus['view/item/context'].filter(item => item.when?.includes('entirely.integrations')).map(item => item.command);
		assert.deepStrictEqual(inline.sort(), ['entirely.addMcpToProject', 'entirely.enableMcpIntegration', 'entirely.installIntegration']);
		assert.ok(manifest.contributes.menus['view/title'].some(item => item.command === 'entirely.refreshIntegrations'));
	});
});

suite('Entire integration settings', () => {
	test('reads the suggested plugins and the offer switch with their defaults', () => {
		const settings = readExtensionSettings();
		assert.deepStrictEqual(settings.suggestedPlugins, DEFAULT_SUGGESTED_PLUGINS);
		assert.strictEqual(settings.offerIntegrationInstall, true);
		assert.strictEqual(mcpServerEnabledIn(makeFolder().path), vscode.workspace.getConfiguration('entirely').get<boolean>('mcpServerEnabled', true));
	});

	test('the plugin picker offers the plugins from the setting, not a fixed list', async () => {
		const cli = fakePluginCli();
		const offered: string[] = [];
		const ui: PluginUi = {
			pickPlugin: choices => Promise.resolve(void offered.push(...choices.map(choice => choice.name))),
			pickSubcommand: () => Promise.resolve(''),
			askArguments: () => Promise.resolve(''),
			confirm: () => Promise.resolve(false),
			withProgress: (_title, work) => work(new AbortController().signal),
			warn: () => Promise.resolve(),
			offerInstall: () => Promise.resolve(false),
			showOutput: () => Promise.resolve(),
			inform: () => Promise.resolve(),
		};
		const deps: PluginDependencies = {
			source: pluginsFor(cli)(cli.dir),
			acting: () => Promise.resolve(ALICE),
			ui,
			suggested: () => ['alpha', 'beta'],
			running: { active: false },
		};
		await runPluginCommand(deps);
		assert.deepStrictEqual(offered.sort(), ['alpha', 'beta']);
	});
});
