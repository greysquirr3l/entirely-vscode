import * as fs from 'fs';
import * as path from 'path';

import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { makeTempDir } from './tempDir';
import { PLUGIN_INSTALL_HELP, ROOT_AGENT_HELP, ROOT_HELP } from './pluginCli';

/**
 * A stateful FAKE of the Entire CLI for the plugin management commands.
 *
 * Captured from the real CLI (0.12.2): the help text of every subcommand, the
 * first line `Managed plugin directory: <dir>` and the row shape
 * `name  version  -> path` of `plugin list`, and `All plugins healthy.` from
 * `plugin doctor`. INVENTED, not captured from the real CLI, because running
 * them would change the machine: the output of search, info, index update,
 * upgrade and remove, a failing doctor, and every exit code of a failure.
 *
 * It is a Node script behind a one-line shim. The plugin list lives in a state
 * file, so an upgrade or a removal changes what a later `plugin list` prints.
 * Each call is appended to a log as one JSON line, written before any output.
 */

export const UPGRADE_HELP = (allFlag: string): string => `entire plugin upgrade — Upgrade remote-installed plugins to their newest tag
Upgrade remote-installed plugins to their newest semver tag.

Flags:
      ${allFlag}   Upgrade every remote-installed plugin

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

export const REMOVE_HELP = (forceFlag: string): string => `entire plugin remove — Remove a plugin from the managed directory
Remove a plugin from the managed directory.

Flags:
      ${forceFlag}   Remove even when other plugins depend on it

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

const PLAIN_HELP = (sub: string, summary: string, flag = ''): string =>
	`entire plugin ${sub} — ${summary}\n\n${flag}Inherited flags:\n      --context name   Act as this saved login name for this command only\n`;

export interface FakeManagedPlugin {
	name: string;
	version: string;
}

export interface FakePluginManagementOptions {
	/** The managed plugins at the start. Defaults to brain v0.4.0 and graph v0.6.0. */
	plugins?: FakeManagedPlugin[];
	/** Name of the all flag in the upgrade help. Defaults to `--all`; a test renames it. */
	allFlag?: string;
	forceFlag?: string;
	/** Subcommands whose `agent-help plugin <sub>` exits 1, as a CLI without them does. Use `index update` for that one. */
	without?: string[];
	/** Whole-CLI absence. */
	noCli?: boolean;
	/** Names `agent-help NAME` answers (a binary on the PATH, not in the managed directory). */
	onPath?: string[];
	searchOut?: string;
	searchFail?: string;
	infoOut?: string;
	infoFail?: string;
	indexOut?: string;
	indexFail?: string;
	doctorOut?: string;
	doctorExit?: number;
	/** New versions an upgrade moves a plugin to, by name. */
	upgrades?: Record<string, string>;
	upgradeFail?: string;
	upgradeOut?: string;
	/** What `plugin remove` does without the force flag. `noop` exits 0 and removes nothing. */
	removeMode?: 'removes' | 'noop' | 'dependents' | 'fail';
	removeFail?: string;
	/** After any upgrade or removal, `plugin list` exits 1. */
	listFailsAfterMutation?: boolean;
	/** `plugin install` exits 1 with this text. */
	installFail?: string;
	/** Replaces the directory the list names, to test text the CLI controls. */
	managedDirText?: string;
	/** Make `plugin list` always exit 1. */
	listFails?: string;
	/** Help overrides, keyed `plugin_upgrade` and so on. */
	helps?: Record<string, string>;
}

export interface FakePluginManagementCli {
	readonly runner: CliRunner;
	readonly dir: string;
	readonly managedDir: string;
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
	/** Every run that was not a help lookup, as `{ context, args, line }`. */
	calls(): { context: string | undefined; args: string[]; line: string }[];
	/** The runs that change something: upgrade, remove, index update. */
	mutations(): { context: string | undefined; args: string[]; line: string }[];
	state(): { plugins: FakeManagedPlugin[]; mutated: boolean };
}

const SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const statePath = path.join(root, 'state.json');
let args = process.argv.slice(2);
if (args[0] === '--context') args = args.slice(2);
const isHelp = args[0] === 'agent-help' || args.includes('--help');
fs.appendFileSync(path.join(root, 'calls.log'), JSON.stringify({ context: process.env.ENTIRE_CONTEXT, args, help: isHelp }) + '\n');
const out = text => process.stdout.write(text.endsWith('\n') ? text : text + '\n');
const fail = (text, code = 1) => { process.stderr.write(text.endsWith('\n') ? text : text + '\n'); process.exit(code); };
const load = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = state => fs.writeFileSync(statePath, JSON.stringify(state));

if (args[0] === 'version') { out('entire 0.12.2'); process.exit(0); }
if (args[0] === 'agent-help' || args.includes('--help')) {
  const words = args[0] === 'agent-help' ? args.slice(1) : args.filter(a => a !== '--help');
  const key = args[0] === 'agent-help' ? (words.length ? words.join('_') : '_') : (words.length ? words.join('_') + '_--help' : '--help');
  if (words[0] === 'plugin' && words.length > 1) {
    const sub = words.slice(1).join(' ');
    if (config.without.includes(sub)) fail('Error: Invalid usage: unknown command "' + words.join(' ') + '"');
  }
  if (config.helps[key] !== undefined) { out(config.helps[key]); process.exit(0); }
  if (words.length === 1 && config.onPath.includes(words[0]) && args[0] === 'agent-help') { out('entire ' + words[0] + ' — a plugin on the PATH'); process.exit(0); }
  if (words.length === 1 && words[0] === 'mcp' && args[0] !== 'agent-help') { out('Runs a Model Context Protocol (MCP) server over stdio.'); process.exit(0); }
  fail('Error: Invalid usage: unknown command "' + words.join(' ') + '"; run entire agent-help for the list of commands');
}

if (args[0] !== 'plugin') fail('Error: Invalid usage: unknown command "' + args[0] + '"');
const sub = args[1];
const state = load();
const operand = () => { const i = args.indexOf('--'); return i >= 0 ? args[i + 1] : undefined; };

if (sub === 'list') {
  if (config.listFails) fail(config.listFails);
  if (config.listFailsAfterMutation && state.mutated) fail('Error: could not read the plugin directory');
  out('Managed plugin directory: ' + config.managedDir);
  if (state.plugins.length === 0) { process.exit(0); }
  out('');
  for (const p of state.plugins) out('  ' + p.name.padEnd(20) + ' ' + p.version.padEnd(18) + ' → ' + config.managedDir + '/../pkg/' + p.name + '/entire-' + p.name);
  process.exit(0);
}
if (sub === 'info') { if (config.infoFail) fail(config.infoFail); out(config.infoOut.replace('NAME', operand() || '')); process.exit(0); }
if (sub === 'search') { if (config.searchFail) fail(config.searchFail); out(config.searchOut); process.exit(0); }
if (sub === 'index' && args[2] === 'update') {
  if (config.indexFail) fail(config.indexFail);
  out(config.indexOut); process.exit(0);
}
if (sub === 'doctor') {
  if (config.doctorExit) fail(config.doctorOut, config.doctorExit);
  out(config.doctorOut); process.exit(0);
}
if (sub === 'upgrade') {
  if (config.upgradeFail) fail(config.upgradeFail);
  const all = args.includes(config.allFlag);
  const only = operand();
  for (const p of state.plugins) {
    if ((all || p.name === only) && config.upgrades[p.name]) p.version = config.upgrades[p.name];
  }
  state.mutated = true; save(state);
  out(config.upgradeOut); process.exit(0);
}
if (sub === 'remove') {
  const name = operand();
  const forced = args.includes(config.forceFlag);
  if (config.removeMode === 'fail') fail(config.removeFail);
  if (config.removeMode === 'dependents' && !forced) fail('Error: refusing to remove ' + name + ': brain depends on it (use ' + config.forceFlag + ' to remove anyway)');
  if (config.removeMode !== 'noop') { state.plugins = state.plugins.filter(p => p.name !== name); }
  state.mutated = true; save(state);
  out('removed ' + name); process.exit(0);
}
if (sub === 'install') { if (config.installFail) fail(config.installFail); out('installed'); process.exit(0); }
fail('Error: unknown plugin command');
`;

export function fakePluginManagementCli(options: FakePluginManagementOptions = {}): FakePluginManagementCli {
	const dir = makeTempDir('entire-plugin-mgmt-');
	const bin = path.join(dir, '.local', 'bin');
	const lib = path.join(bin, 'lib');
	fs.mkdirSync(lib, { recursive: true });
	const managedDir = path.join(dir, 'plugins', 'bin');
	const allFlag = options.allFlag ?? '--all';
	const forceFlag = options.forceFlag ?? '--force';
	const helps: Record<string, string> = {
		_: ROOT_AGENT_HELP,
		'--help': ROOT_HELP,
		plugin_install: PLUGIN_INSTALL_HELP,
		plugin_upgrade: UPGRADE_HELP(allFlag),
		plugin_remove: REMOVE_HELP(forceFlag),
		plugin_info: PLAIN_HELP('info', 'Show index and install details for a plugin', 'Flags:\n      --index string   Plugin index URL\n\n'),
		plugin_search: PLAIN_HELP('search', 'Search the plugin index', 'Flags:\n      --index string   Plugin index URL\n\n'),
		plugin_index_update: PLAIN_HELP('index update', 'Force a refresh of the plugin index', 'Flags:\n      --index string   Plugin index URL\n\n'),
		plugin_doctor: PLAIN_HELP('doctor', 'Check installed plugins for missing dependencies and broken entries'),
		...(options.helps ?? {}),
	};
	const config = {
		installFail: options.installFail,
		managedDir: options.managedDirText ?? managedDir,
		allFlag,
		forceFlag,
		helps,
		without: options.without ?? [],
		onPath: options.onPath ?? [],
		searchOut: options.searchOut ?? '',
		searchFail: options.searchFail,
		infoOut: options.infoOut ?? 'NAME 1.0.0 (invented index entry)',
		infoFail: options.infoFail,
		indexOut: options.indexOut ?? '',
		indexFail: options.indexFail,
		doctorOut: options.doctorOut ?? 'All plugins healthy.',
		doctorExit: options.doctorExit ?? 0,
		upgrades: options.upgrades ?? {},
		upgradeFail: options.upgradeFail,
		upgradeOut: options.upgradeOut ?? '',
		removeMode: options.removeMode ?? 'removes',
		removeFail: options.removeFail ?? 'Error: could not remove',
		listFailsAfterMutation: options.listFailsAfterMutation ?? false,
		listFails: options.listFails,
	};
	const plugins = options.plugins ?? [
		{ name: 'brain', version: 'v0.4.0' },
		{ name: 'graph', version: 'v0.6.0' },
	];
	fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ plugins, mutated: false }));
	fs.writeFileSync(path.join(dir, 'calls.log'), '');
	const script = path.join(lib, 'fake.js');
	fs.writeFileSync(script, SCRIPT, 'utf8');
	if (!options.noCli) {
		const shim = path.join(bin, 'entire');
		fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 'utf8');
		fs.chmodSync(shim, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });

	const all = () =>
		fs
			.readFileSync(path.join(dir, 'calls.log'), 'utf8')
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => JSON.parse(line) as { context?: string; args: string[]; help: boolean })
			.filter(call => !call.help)
			.map(call => ({ context: call.context, args: call.args, line: call.args.join(' ') }));
	return {
		runner,
		dir,
		managedDir,
		recorded,
		calls: all,
		mutations: () => all().filter(call => /^plugin (upgrade|remove|index update)\b/.test(call.line)),
		state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as { plugins: FakeManagedPlugin[]; mutated: boolean },
	};
}
