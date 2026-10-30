import * as fs from 'fs';
import * as path from 'path';

import { CliLocator } from '../../services/cli/locator';
import { CliRunner } from '../../services/cli/runner';
import type { CliInvocation, CliInvocationBodies } from '../../services/cli/invocation';
import { makeTempDir } from './tempDir';

/** The top-level agent-help of the real CLI (0.12.2), shortened. */
export const ROOT_AGENT_HELP = `Entire's CLI is the source of truth for its own usage.

When to use entire — the commands that bear on the work:
  checkpoint  Inspect and search checkpoints
  session     Manage agent sessions tracked by Entire
  status      Show Entire status

Also available (entire agent-help <command> for any of these):
  read-only, safe to run:
    activity · labs · recap · version
  the user's — suggest, don't run:
    agent · auth · clean · enable
    login · logout · plugin · repo
`;

export const ROOT_HELP = `The command-line interface for Entire

Usage:
  entire [flags]
  entire [command]

Entire Setup:
  agent                      Manage agent integrations (add, remove, list)
  plugin                     Manage Entire plugins (install, list, upgrade, search, remove)
  status                     Show Entire status

Additional Commands:
  agent-help                 Machine-readable usage for coding agents
  help                       Help about any command
`;

export const PLUGIN_INSTALL_HELP = `entire plugin install — Install a plugin from the index, a git repository URL, or a local executable

Flags:
      --allow-unverified   Install even when the release publishes no checksums.txt to authenticate the download
      --force              Replace an existing entry with the same name
      --no-deps            Do not install declared dependencies
      --yes                Skip confirmation prompts (non-index sources, dependency installs)

Inherited flags:
      --context name   Act as this saved login name for this command only
`;

export const GRAPH_HELP = `entire graph — Explore the knowledge graph

Flags:
      --depth int      How far to follow links (default 2)
      --format string  Output format

Subcommands: query · nodes · edges
Next:  entire agent-help graph <subcommand>
`;

export const MCP_HELP = `Runs a Model Context Protocol (MCP) server over stdio. Configure an MCP host to
launch "entire mcp" as a stdio server. Read-only; speaks newline-delimited JSON-RPC 2.0.

Usage:
  entire mcp [flags]
`;

export const PLUGIN_LIST_EMPTY = `No plugins installed in /home/x/.local/share/entire/plugins/bin.
Install one with 'entire plugin install <name|url|path>', or drop an entire-<name> binary anywhere on $PATH.
`;

export interface FakePluginOptions {
	/** Help texts to replace or add, keyed by the words after agent-help (or the arguments, for --help). A null value means the CLI has none. */
	helps?: Record<string, string | null>;
	/** What `entire plugin list` prints. */
	list?: string;
	/** Plugins that exist, with the text each prints. */
	plugins?: Record<string, string>;
	/** Commands that exit 1 with this text on stderr. */
	fail?: Record<string, string>;
	noCli?: boolean;
}

export interface FakePluginCli {
	readonly runner: CliRunner;
	readonly dir: string;
	/** The path of the fake binary. */
	readonly binary: string;
	/** Every command that was run, as `context|ENTIRE_CONTEXT|arguments`, without help lookups. */
	calls(): string[];
	readonly recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[];
}

/** A stand-in `entire` with a plugin list, plugins that print the context they ran as, and an MCP server that answers one line. */
export function fakePluginCli(options: FakePluginOptions = {}): FakePluginCli {
	const dir = makeTempDir('entire-plugins-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const state = path.join(dir, 'state');
	for (const sub of ['help', 'out', 'fail']) {
		fs.mkdirSync(path.join(state, sub), { recursive: true });
	}
	const log = path.join(dir, 'calls.log');

	const helps: Record<string, string | null> = {
		_: ROOT_AGENT_HELP,
		'--help': ROOT_HELP,
		plugin_install: PLUGIN_INSTALL_HELP,
		graph: GRAPH_HELP,
		'mcp_--help': MCP_HELP,
		...(options.helps ?? {}),
	};
	for (const [key, text] of Object.entries(helps)) {
		if (text !== null) {
			fs.writeFileSync(path.join(state, 'help', key), text);
		}
	}
	for (const [name, text] of Object.entries({ graph: 'graph output', ...(options.plugins ?? {}) })) {
		fs.writeFileSync(path.join(state, 'out', name), text);
	}
	for (const [key, text] of Object.entries(options.fail ?? {})) {
		fs.writeFileSync(path.join(state, 'fail', key), text);
	}
	fs.writeFileSync(path.join(state, 'out', 'plugin_list'), options.list ?? PLUGIN_LIST_EMPTY);

	const script = [
		'#!/bin/sh',
		'CTX=none',
		'if [ "$1" = "--context" ]; then CTX="$2"; shift 2; fi',
		`S='${state}'`,
		'case "$1" in',
		'\tversion) echo "entire 0.12.2"; exit 0 ;;',
		'\tagent-help) shift; k=$(echo "$*" | tr " " "_"); [ -z "$k" ] && k=_; if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; echo "Error: Invalid usage: unknown command" >&2; exit 1 ;;',
		'esac',
		'k=$(echo "$*" | tr " " "_")',
		'case "$*" in *--help) if [ -f "$S/help/$k" ]; then cat "$S/help/$k"; exit 0; fi; cat "$S/help/--help"; echo "Error: Invalid usage: unknown command \\"$1\\"" >&2; exit 1 ;; esac',
		`echo "$CTX|$ENTIRE_CONTEXT|$*" >> '${log}'`,
		'if [ -f "$S/fail/$1" ]; then cat "$S/fail/$1" >&2; exit 1; fi',
		'case "$1" in',
		'\tmcp) read line; echo \'{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"entire"}}}\'; exit 0 ;;',
		'\tplugin) k2="plugin_$2"; if [ -f "$S/out/$k2" ]; then cat "$S/out/$k2"; else echo "done"; fi; exit 0 ;;',
		'esac',
		'if [ -f "$S/out/$1" ]; then echo "$(cat "$S/out/$1") as ${ENTIRE_CONTEXT:-nobody}"; exit 0; fi',
		'echo "Error: Invalid usage: unknown command \\"$1\\"; run `entire agent-help` for the list of commands" >&2',
		'exit 1',
	].join('\n');

	const binary = path.join(bin, 'entire');
	if (!options.noCli) {
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const recorded: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
	runner.setSink({ report: (invocation, bodies) => void recorded.push({ invocation, bodies }) });
	const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
	return { runner, dir, binary, calls, recorded };
}
