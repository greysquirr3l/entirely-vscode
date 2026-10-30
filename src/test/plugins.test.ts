import * as assert from 'assert';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

import {
	MCP_PROVIDER_ID,
	MAX_PLUGIN_ARGUMENTS,
	SUGGESTED_PLUGINS,
	confirmPluginInstall,
	confirmPluginRun,
	describeMcpUnavailable,
	describeMissingPlugin,
	describesMcpServer,
	installCommandLine,
	invalidPluginArguments,
	isMissingPlugin,
	isPluginName,
	isUnknownCommand,
	mcpClientConfig,
	parseInstalledPlugins,
	pickInstallFlags,
	pluginArguments,
	pluginInstallArguments,
	readBuiltinCommands,
	readPluginFlags,
	readSubcommands,
	splitWords,
	type ControlConfirmation,
} from '../lib/entire';
import { copyMcpConfig, startMcpServer, type McpDependencies, type McpUi } from '../commands/mcp';
import { installPluginCommand, runPluginCommand, type PluginChoice, type PluginDependencies, type PluginUi } from '../commands/plugins';
import { EntireMcpProvider, registerMcpProvider } from '../services/mcpProvider';
import { McpServerService } from '../services/mcpServer';
import { PluginService } from '../services/plugins';
import { ALICE } from './support/activityCli';
import { GRAPH_HELP, MCP_HELP, ROOT_AGENT_HELP, ROOT_HELP, fakePluginCli, type FakePluginCli } from './support/pluginCli';

suite('Entire plugin names and arguments', () => {
	test('accepts the part after entire- and nothing that is a path, a flag or a URL', () => {
		for (const name of ['graph', 'investigate', 'my-plugin_2']) {
			assert.strictEqual(isPluginName(name), true, name);
		}
		for (const name of ['', '-graph', 'a/b', './x', 'https://x', 'a b', 'x'.repeat(42)]) {
			assert.strictEqual(isPluginName(name), false, name);
		}
		assert.ok(SUGGESTED_PLUGINS.includes('graph'));
	});

	test('splits typed arguments into words and keeps quoted phrases together', () => {
		assert.deepStrictEqual(splitWords('query --depth 3  "why is this"'), ['query', '--depth', '3', 'why is this']);
		assert.deepStrictEqual(splitWords("a 'b c'"), ['a', 'b c']);
		assert.deepStrictEqual(splitWords('   '), []);
	});

	test('refuses control characters and too many arguments', () => {
		assert.strictEqual(invalidPluginArguments(['a', 'b']), undefined);
		assert.match(invalidPluginArguments(['a\u0000b']) ?? '', /control/);
		assert.match(invalidPluginArguments(new Array<string>(MAX_PLUGIN_ARGUMENTS + 1).fill('x')) ?? '', /at most/);
	});

	test('runs a plugin as a command of the CLI', () => {
		assert.deepStrictEqual(pluginArguments('graph', ['query', '--depth', '3']), ['graph', 'query', '--depth', '3']);
	});
});

suite('Entire plugin help and list text', () => {
	test('reads an empty plugin list as no plugins, not as rows', () => {
		const text = "No plugins installed in /x/bin.\nInstall one with 'entire plugin install <name|url|path>', or drop an entire-<name> binary anywhere on $PATH.\n";
		assert.deepStrictEqual(parseInstalledPlugins(text), []);
	});

	test('reads rows of a populated list by their first word', () => {
		const text = 'NAME   VERSION  SOURCE\ngraph  v1.2.0    index\nentire-brain  v0.3.0\n';
		assert.deepStrictEqual(parseInstalledPlugins(text), [
			{ name: 'graph', detail: 'v1.2.0 index' },
			{ name: 'brain', detail: 'v0.3.0' },
		]);
	});

	test('reads subcommands from the agent-help line and from the Available Commands rows', () => {
		assert.deepStrictEqual(readSubcommands(GRAPH_HELP), ['query', 'nodes', 'edges']);
		const cobra = 'Usage:\n  x [command]\n\nAvailable Commands:\n  browse      Interactively browse\n  help        Help about any command\n  list        List plugins\n\nFlags:\n  -h, --help   help\n';
		assert.deepStrictEqual(readSubcommands(cobra), ['browse', 'list']);
		assert.deepStrictEqual(readSubcommands('no subcommands here'), []);
	});

	test('reads the plugin flags from its help and drops help and context', () => {
		const flags = readPluginFlags(`${GRAPH_HELP}\nInherited flags:\n      --context name   Act as\n  -h, --help   help\n`);
		assert.deepStrictEqual(flags.map(flag => flag.name), ['--depth', '--format']);
	});

	test('reads the CLI own command names from both of its help layouts', () => {
		const names = readBuiltinCommands(ROOT_AGENT_HELP, ROOT_HELP);
		for (const name of ['session', 'checkpoint', 'recap', 'logout', 'plugin', 'agent', 'status', 'help']) {
			assert.ok(names.has(name), name);
		}
		assert.strictEqual(names.has('graph'), false);
	});

	test('recognises the CLI saying a command does not exist, for that name only', () => {
		assert.strictEqual(isUnknownCommand('Error: Invalid usage: unknown command "graph"; run `entire agent-help`', 'graph'), true);
		assert.strictEqual(isUnknownCommand('Error: unknown command "other"', 'graph'), false);
		assert.strictEqual(isUnknownCommand('graph failed: boom', 'graph'), false);
		assert.strictEqual(isUnknownCommand('unknown command "a.b"', 'a-b'), false);
	});

	test('recognises both ways the CLI says a plugin is not installed, for that name only', () => {
		const real = "the entire-graph plugin is not installed; run 'entire plugin install graph' and retry";
		assert.strictEqual(isMissingPlugin(real, 'graph'), true);
		assert.strictEqual(isMissingPlugin(real.toUpperCase(), 'graph'), true);
		assert.strictEqual(isMissingPlugin('Error: Invalid usage: unknown command "graph"', 'graph'), true);
		assert.strictEqual(isMissingPlugin(real, 'brain'), false);
		assert.strictEqual(isMissingPlugin('the entire-a-b plugin is not installed', 'a.b'), false);
		assert.strictEqual(isMissingPlugin('graph failed: boom', 'graph'), false);
	});

	test('reads a plugin called name as a row, and only the upper-case heading as a heading', () => {
		assert.deepStrictEqual(parseInstalledPlugins('NAME  VERSION  SOURCE\nname  v1.0\n'), [{ name: 'name', detail: 'v1.0' }]);
		assert.deepStrictEqual(parseInstalledPlugins('NAME\n'), []);
	});

	test('says which plugin is missing and how to install it', () => {
		const message = describeMissingPlugin('graph');
		assert.match(message, /"graph" plugin is not installed/);
		assert.match(message, /entire plugin install graph/);
		assert.strictEqual(installCommandLine('graph'), 'entire plugin install graph');
	});
});

suite('Entire plugin install request', () => {
	test('uses the flag the help describes as skipping prompts, and no flag by a fixed name', () => {
		const picked = pickInstallFlags(
			'Flags:\n      --assume   Skip confirmation prompts (non-index sources)\n      --force   Replace an existing entry\n',
			[],
		);
		assert.ok(picked.ok);
		assert.strictEqual(picked.ok && picked.flags.skipPrompt, '--assume');
		assert.deepStrictEqual(pluginInstallArguments('graph', '--assume'), ['plugin', 'install', '--assume', '--', 'graph']);
		assert.strictEqual(pickInstallFlags('Flags:\n      --force   Replace\n', []).ok, false);
	});

	test('the questions name the plugin, the acting login, and what runs', () => {
		const run = confirmPluginRun('graph', ['query', '--depth', '3'], ALICE);
		assert.match(run.detail, /entire graph query --depth 3/);
		assert.match(run.detail, /alice \(login alice@us\.auth\.entire\.io\)/);
		assert.strictEqual(run.action, 'Run Plugin');
		const install = confirmPluginInstall('graph', ALICE);
		assert.match(install.detail, /entire plugin install graph/);
		assert.match(install.detail, /executable/);
		assert.strictEqual(install.action, 'Install Plugin');
	});
});

function pluginService(cli: FakePluginCli): PluginService {
	return new PluginService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20 });
}

suite('Entire plugin service', () => {
	test('run-plugin: runs as the acting login, by flag and by ENTIRE_CONTEXT, and returns the output', async () => {
		const cli = fakePluginCli();
		const outcome = await pluginService(cli).run('graph', ['query'], ALICE);
		assert.deepStrictEqual(outcome, { kind: 'done', text: `graph output as ${ALICE.name}` });
		assert.deepStrictEqual(cli.calls(), [`${ALICE.name}|${ALICE.name}|graph query`]);
	});

	test('run-plugin: a pinned login does not override the login that was confirmed', async () => {
		const cli = fakePluginCli();
		cli.runner.setContext('bob@us.auth.entire.io');
		await pluginService(cli).run('graph', [], ALICE);
		assert.deepStrictEqual(cli.calls(), [`${ALICE.name}|${ALICE.name}|graph`]);
	});

	test('keeps plugin output out of the invocation record', async () => {
		const cli = fakePluginCli();
		await pluginService(cli).run('graph', [], ALICE);
		const record = cli.recorded.find(item => item.invocation.args.includes('graph') && !item.invocation.args.includes('--help'));
		assert.ok(record);
		assert.deepStrictEqual(record.bodies, {});
	});

	test('missing-plugin: an unknown plugin comes back as missing, by name, not as a failure', async () => {
		const cli = fakePluginCli();
		assert.deepStrictEqual(await pluginService(cli).run('investigate', [], ALICE), { kind: 'missing', name: 'investigate' });
	});

	test('refuses a built-in command of the CLI without running it', async () => {
		const cli = fakePluginCli();
		const outcome = await pluginService(cli).run('session', ['stop'], ALICE);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(outcome.kind === 'failed' ? outcome.detail : '', /command of the Entire CLI itself/);
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('refuses a name that is not a plugin name and refuses when the CLI commands cannot be read', async () => {
		const cli = fakePluginCli();
		assert.strictEqual((await pluginService(cli).run('a/b', [], ALICE)).kind, 'failed');
		const none = fakePluginCli({ noCli: true });
		const outcome = await pluginService(none).run('graph', [], ALICE);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(outcome.kind === 'failed' ? outcome.detail : '', /not installed/);
	});

	test('reports a plugin that fails with what it said', async () => {
		const cli = fakePluginCli({ fail: { graph: 'graph: database locked' } });
		const outcome = await pluginService(cli).run('graph', [], ALICE);
		assert.deepStrictEqual(outcome, { kind: 'failed', detail: 'graph: database locked' });
	});

	test('says so when a plugin prints nothing', async () => {
		const cli = fakePluginCli({ plugins: { quiet: '' } });
		assert.deepStrictEqual((await pluginService(cli).run('quiet', [], ALICE)).kind, 'done');
	});

	test('reads the plugin subcommands and flags from its help', async () => {
		const cli = fakePluginCli();
		const usage = await pluginService(cli).usage('graph');
		assert.ok(usage.ok);
		assert.deepStrictEqual(usage.ok ? usage.value.subcommands : [], ['query', 'nodes', 'edges']);
		assert.deepStrictEqual(usage.ok ? usage.value.flags.map(flag => flag.name) : [], ['--depth', '--format']);
	});

	test('falls back to the plugin own --help when agent-help does not know it', async () => {
		const cli = fakePluginCli({ helps: { graph: null, 'graph_--help': GRAPH_HELP }, list: 'graph  v1\n' });
		const usage = await pluginService(cli).usage('graph');
		assert.ok(usage.ok);
	});

	test('missing-plugin: help for a plugin that is not installed says it is missing', async () => {
		const cli = fakePluginCli();
		const usage = await pluginService(cli).usage('investigate');
		assert.strictEqual(usage.ok, false);
		assert.ok(!usage.ok && 'missing' in usage && usage.missing);
		assert.match(usage.ok ? '' : usage.detail, /investigate/);
	});

	test('missing-plugin: the CLI message for a known plugin that is not installed is read by usage and by run', async () => {
		const cli = fakePluginCli();
		for (const name of ['graph', 'brain', 'investigate']) {
			const missingBrain = name === 'graph' ? fakePluginCli({ helps: { graph: null } }) : cli;
			const usage = await pluginService(missingBrain).usage(name);
			assert.ok(!usage.ok && 'missing' in usage && usage.missing, `usage ${name}`);
			assert.match(usage.ok ? '' : usage.detail, new RegExp(name));
		}
		for (const name of ['brain', 'investigate']) {
			assert.deepStrictEqual(await pluginService(cli).run(name, ['why'], ALICE), { kind: 'missing', name });
		}
		assert.strictEqual(cli.calls().length, 2);
	});

	test('missing-plugin: the unknown command message for a name the CLI does not know is still read as missing', async () => {
		const cli = fakePluginCli();
		const usage = await pluginService(cli).usage('zzzfoo');
		assert.ok(!usage.ok && 'missing' in usage && usage.missing);
		assert.deepStrictEqual(await pluginService(cli).run('zzzfoo', [], ALICE), { kind: 'missing', name: 'zzzfoo' });
	});

	test('missing-plugin: a failed agent-help that names the plugin is enough, whatever --help says', async () => {
		const cli = fakePluginCli({ helps: { 'brain_--help': null } });
		const usage = await pluginService(cli).usage('brain');
		assert.ok(!usage.ok && 'missing' in usage && usage.missing);
	});

	test('refuses hidden built-in commands, which no listing names but --help answers', async () => {
		const cli = fakePluginCli();
		for (const name of ['mcp', 'completion']) {
			const outcome = await pluginService(cli).run(name, [], ALICE);
			assert.strictEqual(outcome.kind, 'failed', name);
			assert.match(outcome.kind === 'failed' ? outcome.detail : '', /command of the Entire CLI itself/);
			const usage = await pluginService(cli).usage(name);
			assert.ok(!usage.ok && !('missing' in usage), name);
		}
		assert.deepStrictEqual(cli.calls().filter(call => !call.endsWith('|plugin list')), []);
	});

	test('allows a name the CLI answers when an installed plugin holds it', async () => {
		const cli = fakePluginCli({ list: 'completion  v1\n', plugins: { completion: 'plugin output' } });
		const outcome = await pluginService(cli).run('completion', [], ALICE);
		assert.deepStrictEqual(outcome, { kind: 'done', text: `plugin output as ${ALICE.name}` });
	});

	test('records the plugin name but not the words typed after it', async () => {
		const cli = fakePluginCli();
		await pluginService(cli).run('graph', ['query', 'why is auth slow'], ALICE);
		const record = cli.recorded.find(item => item.invocation.args.includes('graph') && !item.invocation.args.includes('--help'));
		assert.ok(record);
		assert.deepStrictEqual(record.invocation.args, ['--context', ALICE.name, 'graph', '<redacted>', '<redacted>']);
		assert.ok(!JSON.stringify(cli.recorded).includes('why is auth slow'));
	});

	test('the runner records every argument unless redactFrom is set', async () => {
		const cli = fakePluginCli();
		await cli.runner.run(['plugin', 'list', 'visible'], { cwd: cli.dir });
		await cli.runner.run(['plugin', 'list', 'hidden'], { cwd: cli.dir, redactFrom: 2 });
		await cli.runner.run(['plugin', 'list', 'also'], { cwd: cli.dir, context: ALICE.name, redactFrom: 0 });
		const argsOf = cli.recorded.slice(-3).map(item => item.invocation.args);
		assert.deepStrictEqual(argsOf[0], ['plugin', 'list', 'visible']);
		assert.deepStrictEqual(argsOf[1], ['plugin', 'list', '<redacted>']);
		assert.deepStrictEqual(argsOf[2], ['--context', ALICE.name, '<redacted>', '<redacted>', '<redacted>']);
	});

	test('lists installed plugins and reports a missing CLI', async () => {
		const cli = fakePluginCli({ list: 'graph  v1\n' });
		assert.deepStrictEqual(await pluginService(cli).installed(), { ok: true, value: [{ name: 'graph', detail: 'v1' }] });
		const none = await pluginService(fakePluginCli({ noCli: true })).installed();
		assert.strictEqual(none.ok, false);
	});

	test('installs by bare name with the skip-prompt flag from the help, as the acting login', async () => {
		const cli = fakePluginCli();
		const outcome = await pluginService(cli).install('graph', ALICE);
		assert.strictEqual(outcome.kind, 'installed');
		assert.deepStrictEqual(cli.calls(), [`${ALICE.name}|${ALICE.name}|plugin install --yes -- graph`]);
	});

	test('does not install from a path or URL, or when the help has no skip-prompt flag', async () => {
		const cli = fakePluginCli();
		assert.strictEqual((await pluginService(cli).install('https://x/y', ALICE)).kind, 'failed');
		assert.strictEqual((await pluginService(cli).install('./x', ALICE)).kind, 'failed');
		const old = fakePluginCli({ helps: { plugin_install: 'Flags:\n      --force   Replace\n' } });
		const outcome = await pluginService(old).install('graph', ALICE);
		assert.strictEqual(outcome.kind, 'failed');
		assert.match(outcome.kind === 'failed' ? outcome.detail : '', /update the CLI/);
		assert.deepStrictEqual(old.calls(), []);
	});

	test('reports a failed install with what the CLI said', async () => {
		const cli = fakePluginCli({ fail: { plugin: 'plugin "nope" not found in the index' } });
		const outcome = await pluginService(cli).install('nope', ALICE);
		assert.deepStrictEqual(outcome, { kind: 'failed', detail: 'plugin "nope" not found in the index' });
	});
});

interface PluginScript {
	picked?: string;
	subcommand?: string;
	typed?: string;
	confirm?: boolean;
	installOffer?: boolean;
	acting?: boolean;
}

function pluginUi(script: PluginScript = {}) {
	const log = { warnings: [] as string[], informs: [] as string[], prompts: [] as ControlConfirmation[], output: '', offered: '', choices: [] as PluginChoice[] };
	const ui: PluginUi = {
		pickPlugin: choices => {
			log.choices = [...choices];
			return Promise.resolve(script.picked);
		},
		pickSubcommand: () => Promise.resolve(script.subcommand ?? ''),
		askArguments: (_plugin, _flags, validate) => {
			assert.strictEqual(validate('ok'), undefined);
			return Promise.resolve(script.typed ?? '');
		},
		confirm: prompt => {
			log.prompts.push(prompt);
			return Promise.resolve(script.confirm ?? true);
		},
		withProgress: (_title, work) => work(new AbortController().signal),
		warn: message => {
			log.warnings.push(message);
			return Promise.resolve();
		},
		offerInstall: message => {
			log.offered = message;
			return Promise.resolve(script.installOffer ?? false);
		},
		showOutput: (_plugin, text) => {
			log.output = text;
			return Promise.resolve();
		},
		inform: message => {
			log.informs.push(message);
			return Promise.resolve();
		},
	};
	return { ui, log };
}

function pluginDeps(cli: FakePluginCli, ui: PluginUi, script: PluginScript = {}): PluginDependencies {
	return {
		source: pluginService(cli),
		acting: () => Promise.resolve(script.acting === false ? undefined : ALICE),
		ui,
		running: { active: false },
	};
}

/** The commands that ran, without the plugin list the picker reads. */
function runs(cli: FakePluginCli): string[] {
	return cli.calls().filter(line => !line.endsWith('|plugin list'));
}

suite('Entire plugin commands', () => {
	test('run-plugin: asks, confirms as the acting login, runs it and shows the output', async () => {
		const cli = fakePluginCli();
		const script = { picked: 'graph', subcommand: 'query', typed: '--depth 3' };
		const { ui, log } = pluginUi(script);
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, ui, script)), 'shown');
		assert.match(log.prompts[0].detail, /entire graph query --depth 3/);
		assert.match(log.prompts[0].detail, /alice/);
		assert.deepStrictEqual(runs(cli), [`${ALICE.name}|${ALICE.name}|graph query --depth 3`]);
		assert.strictEqual(log.output, `graph output as ${ALICE.name}`);
	});

	test('offers the suggested plugins even when none is installed', async () => {
		const cli = fakePluginCli();
		const { ui, log } = pluginUi({});
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, ui)), 'cancelled');
		assert.deepStrictEqual(log.choices.map(choice => choice.name).sort(), [...SUGGESTED_PLUGINS].sort());
		assert.ok(log.choices.every(choice => !choice.installed));
	});

	test('missing-plugin: names the plugin and offers to install it, and nothing runs when declined', async () => {
		const cli = fakePluginCli();
		const { ui, log } = pluginUi({ picked: 'investigate', installOffer: false });
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, ui)), 'missing');
		assert.match(log.offered, /"investigate" plugin is not installed/);
		assert.match(log.offered, /entire plugin install investigate/);
		assert.deepStrictEqual(log.warnings, []);
		assert.deepStrictEqual(runs(cli), []);
	});

	test('missing-plugin: accepting the offer installs it after a question naming the download', async () => {
		const cli = fakePluginCli();
		const script = { picked: 'investigate', installOffer: true };
		const { ui, log } = pluginUi(script);
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, ui, script)), 'installed');
		assert.match(log.prompts[0].message, /Install the investigate plugin/);
		assert.deepStrictEqual(runs(cli), [`${ALICE.name}|${ALICE.name}|plugin install --yes -- investigate`]);
		assert.match(log.informs[0], /investigate plugin is installed/);
	});

	test('a plugin that vanishes between help and run is still reported as missing', async () => {
		const cli = fakePluginCli({ fail: {} });
		const { ui, log } = pluginUi({ picked: 'graph', installOffer: false });
		const deps = pluginDeps(cli, ui);
		const source = deps.source;
		const racing: PluginDependencies = {
			...deps,
			source: {
				installed: () => source.installed(),
				usage: () => Promise.resolve({ ok: true, value: { subcommands: [], flags: [] } }),
				run: () => Promise.resolve({ kind: 'missing', name: 'graph' }),
				install: (name, acting, signal) => source.install(name, acting, signal),
			},
		};
		assert.strictEqual(await runPluginCommand(racing), 'missing');
		assert.match(log.offered, /"graph" plugin is not installed/);
	});

	test('does not run when the person declines the question or there is no login', async () => {
		const cli = fakePluginCli();
		const declined = pluginUi({ picked: 'graph', confirm: false });
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, declined.ui, { confirm: false })), 'cancelled');
		const nobody = pluginUi({ picked: 'graph' });
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, nobody.ui, { acting: false })), 'no-login');
		assert.match(nobody.log.warnings[0], /Sign in first/);
		assert.deepStrictEqual(runs(cli), []);
	});

	test('reports a failing plugin and refuses a second command while one runs', async () => {
		const cli = fakePluginCli({ fail: { graph: 'database locked' } });
		const { ui, log } = pluginUi({ picked: 'graph' });
		const deps = pluginDeps(cli, ui);
		assert.strictEqual(await runPluginCommand(deps), 'failed');
		assert.match(log.warnings[0], /graph plugin failed: database locked/);
		const busy = { ...deps, running: { active: true } };
		assert.strictEqual(await runPluginCommand(busy), 'busy');
	});

	test('explains a CLI that cannot list plugins instead of failing obscurely', async () => {
		const cli = fakePluginCli({ noCli: true });
		const { ui, log } = pluginUi({ picked: 'graph' });
		assert.strictEqual(await runPluginCommand(pluginDeps(cli, ui)), 'unavailable');
		assert.match(log.warnings[0], /not installed/);
	});

	test('install offers only plugins that are not installed, and confirms before it runs', async () => {
		const cli = fakePluginCli({ list: 'graph  v1\n' });
		const script = { picked: 'brain' };
		const { ui, log } = pluginUi(script);
		assert.strictEqual(await installPluginCommand(pluginDeps(cli, ui, script)), 'installed');
		assert.deepStrictEqual(log.choices.map(choice => choice.name).sort(), ['brain', 'investigate']);
		assert.match(log.prompts[0].detail, /entire plugin install brain/);
		const declined = pluginUi({ picked: 'brain', confirm: false });
		assert.strictEqual(await installPluginCommand(pluginDeps(cli, declined.ui, { confirm: false })), 'cancelled');
	});

	test('install refuses a name that is a URL', async () => {
		const cli = fakePluginCli();
		const { ui, log } = pluginUi({ picked: 'https://x/y' });
		assert.strictEqual(await installPluginCommand(pluginDeps(cli, ui)), 'failed');
		assert.match(log.warnings[0], /not a plugin name/);
	});
});

suite('Entire MCP server launch', () => {
	test('describes only a CLI whose help says it is an MCP server over stdio', () => {
		assert.strictEqual(describesMcpServer(MCP_HELP), true);
		assert.strictEqual(describesMcpServer(ROOT_HELP), false);
		assert.match(describeMcpUnavailable('absent'), /not installed/);
		assert.match(describeMcpUnavailable('old'), /update the CLI/);
		assert.strictEqual(describeMcpUnavailable('broken', 'boom'), 'boom');
	});

	test('writes a client configuration to text and leaves out an empty environment', () => {
		const withEnv = JSON.parse(mcpClientConfig({ command: '/bin/entire', args: ['--context', 'a', 'mcp'], env: { ENTIRE_CONTEXT: 'a' } })) as {
			mcpServers: { entire: { command: string; args: string[]; env?: Record<string, string> } };
		};
		assert.strictEqual(withEnv.mcpServers.entire.command, '/bin/entire');
		assert.deepStrictEqual(withEnv.mcpServers.entire.env, { ENTIRE_CONTEXT: 'a' });
		const plain = JSON.parse(mcpClientConfig({ command: '/bin/entire', args: ['mcp'], env: {} })) as { mcpServers: { entire: { env?: unknown } } };
		assert.strictEqual(plain.mcpServers.entire.env, undefined);
	});
});

function mcpService(cli: FakePluginCli): McpServerService {
	return new McpServerService({ runner: cli.runner, workspaceRoot: () => cli.dir });
}

function talkTo(command: string, args: readonly string[], env: Record<string, string>): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
		let out = '';
		child.stdout.on('data', (chunk: Buffer) => {
			out += chunk.toString('utf8');
		});
		child.on('error', reject);
		child.on('close', () => resolve(out));
		child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
	});
}

suite('Entire MCP server service', () => {
	test('start-mcp: gives a launch line that starts a server answering JSON-RPC over stdio', async () => {
		const cli = fakePluginCli();
		const probe = await mcpService(cli).probe();
		assert.ok(probe.ok);
		if (!probe.ok) {
			return;
		}
		assert.strictEqual(probe.launch.command, cli.binary);
		assert.deepStrictEqual(probe.launch.args, ['mcp']);
		const answer = await talkTo(probe.launch.command, probe.launch.args, probe.launch.env);
		assert.match(answer, /"jsonrpc":"2.0"/);
		assert.match(answer, /"id":1/);
		assert.deepStrictEqual(runs(cli), [`none||mcp`]);
	});

	test('a pinned login reaches the server by flag and by ENTIRE_CONTEXT', async () => {
		const cli = fakePluginCli();
		cli.runner.setContext('alice@us.auth.entire.io');
		const probe = await mcpService(cli).probe();
		assert.ok(probe.ok);
		assert.deepStrictEqual(probe.ok ? probe.launch.args : [], ['--context', 'alice@us.auth.entire.io', 'mcp']);
		assert.deepStrictEqual(probe.ok ? probe.launch.env : {}, { ENTIRE_CONTEXT: 'alice@us.auth.entire.io' });
	});

	test('says why the server is unavailable for a missing CLI and an old CLI', async () => {
		const none = await mcpService(fakePluginCli({ noCli: true })).probe();
		assert.deepStrictEqual(none, { ok: false, reason: 'absent', detail: describeMcpUnavailable('absent') });
		const old = await mcpService(fakePluginCli({ helps: { 'mcp_--help': null } })).probe();
		assert.deepStrictEqual(old, { ok: false, reason: 'old', detail: describeMcpUnavailable('old') });
	});
});

suite('Entire MCP server provider', () => {
	test('start-mcp: offers a stdio definition the editor can start, labelled Entire', async () => {
		const cli = fakePluginCli();
		const provider = new EntireMcpProvider(mcpService(cli), () => true);
		const definitions = await provider.provideMcpServerDefinitions();
		assert.strictEqual(definitions.length, 1);
		assert.ok(definitions[0] instanceof vscode.McpStdioServerDefinition);
		assert.strictEqual(definitions[0].label, 'Entire');
		assert.strictEqual(definitions[0].command, cli.binary);
		assert.deepStrictEqual(definitions[0].args, ['mcp']);
		const resolved = await provider.resolveMcpServerDefinition(definitions[0]);
		assert.strictEqual(resolved?.command, cli.binary);
		provider.dispose();
	});

	test('offers nothing when turned off or when the CLI is missing, and resolves to nothing', async () => {
		const off = new EntireMcpProvider(mcpService(fakePluginCli()), () => false);
		assert.deepStrictEqual(await off.provideMcpServerDefinitions(), []);
		const none = fakePluginCli({ noCli: true });
		const missing = new EntireMcpProvider(mcpService(none), () => true);
		assert.deepStrictEqual(await missing.provideMcpServerDefinitions(), []);
		const server = new vscode.McpStdioServerDefinition('Entire', 'entire', ['mcp']);
		assert.strictEqual(await missing.resolveMcpServerDefinition(server), undefined);
		off.dispose();
		missing.dispose();
	});

	test('tells the editor to ask again on refresh, and registers under the id the manifest declares', async () => {
		const provider = new EntireMcpProvider(mcpService(fakePluginCli()), () => true);
		let fired = 0;
		const listener = provider.onDidChangeMcpServerDefinitions(() => {
			fired += 1;
		});
		provider.refresh();
		assert.strictEqual(fired, 1);
		listener.dispose();
		const registration = registerMcpProvider(provider);
		registration.dispose();
		provider.dispose();
		const manifest = vscode.extensions.getExtension('undefined_publisher.entirely') ?? vscode.extensions.all.find(item => item.id.endsWith('.entirely'));
		const declared = (manifest?.packageJSON as { contributes?: { mcpServerDefinitionProviders?: { id: string }[] } } | undefined)?.contributes
			?.mcpServerDefinitionProviders;
		assert.deepStrictEqual(declared?.map(item => item.id), [MCP_PROVIDER_ID]);
	});
});

function mcpUi(script: { enable?: boolean; servers?: boolean } = {}) {
	const log = { warnings: [] as string[], informs: [] as string[], copied: '', listed: 0, offered: 0 };
	const ui: McpUi = {
		warn: message => {
			log.warnings.push(message);
			return Promise.resolve();
		},
		inform: message => {
			log.informs.push(message);
			return Promise.resolve();
		},
		showServers: () => {
			log.listed += 1;
			return Promise.resolve(script.servers ?? true);
		},
		offerEnable: () => {
			log.offered += 1;
			return Promise.resolve(script.enable ?? true);
		},
		copy: text => {
			log.copied = text;
			return Promise.resolve();
		},
	};
	return { ui, log };
}

suite('Entire MCP commands', () => {
	function deps(cli: FakePluginCli, ui: McpUi, state: { enabled: boolean; refreshed: number }): McpDependencies {
		return {
			source: mcpService(cli),
			ui,
			enabled: () => state.enabled,
			enable: () => {
				state.enabled = true;
				return Promise.resolve();
			},
			refresh: () => {
				state.refreshed += 1;
			},
		};
	}

	test('start-mcp: refreshes the editor server list and shows it', async () => {
		const state = { enabled: true, refreshed: 0 };
		const { ui, log } = mcpUi();
		assert.strictEqual(await startMcpServer(deps(fakePluginCli(), ui, state)), 'listed');
		assert.strictEqual(state.refreshed, 1);
		assert.strictEqual(log.listed, 1);
		assert.deepStrictEqual(log.warnings, []);
	});

	test('tells the person where to start the server when the editor cannot list servers', async () => {
		const { ui, log } = mcpUi({ servers: false });
		assert.strictEqual(await startMcpServer(deps(fakePluginCli(), ui, { enabled: true, refreshed: 0 })), 'listed');
		assert.match(log.informs[0], /start "Entire"/);
	});

	test('asks before turning the setting on, and stops when declined', async () => {
		const declined = mcpUi({ enable: false });
		const state = { enabled: false, refreshed: 0 };
		assert.strictEqual(await startMcpServer(deps(fakePluginCli(), declined.ui, state)), 'disabled');
		assert.strictEqual(state.enabled, false);
		assert.strictEqual(declined.log.listed, 0);
		const accepted = mcpUi();
		assert.strictEqual(await startMcpServer(deps(fakePluginCli(), accepted.ui, state)), 'listed');
		assert.strictEqual(state.enabled, true);
	});

	test('says why it cannot start for a missing or old CLI', async () => {
		const missing = mcpUi();
		assert.strictEqual(await startMcpServer(deps(fakePluginCli({ noCli: true }), missing.ui, { enabled: true, refreshed: 0 })), 'unavailable');
		assert.match(missing.log.warnings[0], /not installed/);
		const old = mcpUi();
		assert.strictEqual(await startMcpServer(deps(fakePluginCli({ helps: { 'mcp_--help': null } }), old.ui, { enabled: true, refreshed: 0 })), 'unavailable');
		assert.match(old.log.warnings[0], /no MCP server/);
	});

	test('copies a client configuration to the clipboard without writing a file', async () => {
		const cli = fakePluginCli();
		const { ui, log } = mcpUi();
		assert.strictEqual(await copyMcpConfig({ source: mcpService(cli), ui }), 'copied');
		const parsed = JSON.parse(log.copied) as { mcpServers: { entire: { command: string } } };
		assert.strictEqual(parsed.mcpServers.entire.command, cli.binary);
		assert.match(log.informs[0], /did not change any file/);
		const none = mcpUi();
		assert.strictEqual(await copyMcpConfig({ source: mcpService(fakePluginCli({ noCli: true })), ui: none.ui }), 'unavailable');
	});
});

suite('Entire plugin and MCP commands in the editor', () => {
	test('registers every command the manifest declares', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of ['entirely.runPluginCommand', 'entirely.installPlugin', 'entirely.startMcpServer', 'entirely.copyMcpConfig']) {
			assert.ok(commands.includes(id), id);
		}
	});
});
