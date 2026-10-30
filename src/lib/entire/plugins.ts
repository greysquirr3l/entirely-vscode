import { readFlagTable, type HelpFlag } from './search';
import { describeActingLogin, type ControlConfirmation } from './controlPlaneActions';
import { pickFlags, type FlagWant } from './controlPlaneFlags';
import type { AccountContext } from './accountContext';

/** Whether a value can name a plugin: the part after `entire-` in the executable's name. */
export function isPluginName(value: string): boolean {
	return /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(value);
}

/** The most arguments one plugin command is run with. */
export const MAX_PLUGIN_ARGUMENTS = 64;

/** Splits what the person typed into words, keeping quoted phrases together. */
export function splitWords(text: string): readonly string[] {
	const words: string[] = [];
	const token = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (let match = token.exec(text); match !== null; match = token.exec(text)) {
		words.push(match[1] ?? match[2] ?? match[3]);
	}
	return words;
}

/** Why the arguments cannot be run, or undefined when they can. */
export function invalidPluginArguments(words: readonly string[]): string | undefined {
	if (words.length > MAX_PLUGIN_ARGUMENTS) {
		return `use at most ${MAX_PLUGIN_ARGUMENTS} arguments`;
	}
	if (words.some(word => /[\u0000-\u001f\u007f]/.test(word))) {
		return 'arguments cannot hold control characters';
	}
	return undefined;
}

/** The arguments that run a plugin command. The CLI finds `entire-<name>` for an unknown command. */
export function pluginArguments(name: string, words: readonly string[]): readonly string[] {
	return [name, ...words];
}

/** A plugin the managed directory holds. */
export interface InstalledPlugin {
	readonly name: string;
	/** The rest of the row, as the CLI printed it. */
	readonly detail: string;
}

/**
 * Whether a line is the column heading of the list: NAME on its own or
 * followed by other upper-case column titles. A plugin called `name` has a
 * row with lower-case words after it, which is not a heading.
 */
function isListHeader(line: string): boolean {
	return /^NAME(\s+[A-Z][A-Z_/ -]*)*$/.test(line);
}

/**
 * Reads `entire plugin list`.
 *
 * The CLI prints text. With nothing installed it prints a sentence and a
 * hint, which is not a row. A row is read only when it starts with a
 * plugin name; a heading and prose are skipped rather than guessed at.
 * The layout of a populated list was not seen, so only the name is relied on.
 */
export function parseInstalledPlugins(text: string): readonly InstalledPlugin[] {
	const found: InstalledPlugin[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0 || /^(no plugins|install one)/i.test(line) || isListHeader(line)) {
			continue;
		}
		const [first, ...rest] = line.split(/\s+/);
		const name = first.replace(/^entire-/, '');
		if (isPluginName(name) && !found.some(item => item.name === name) && /^[a-z0-9]/i.test(first) && !/[:.]$/.test(first)) {
			found.push({ name, detail: rest.join(' ') });
		}
	}
	return found;
}

/**
 * The subcommands a command's help names.
 *
 * Both layouts the CLI uses are read: the `Subcommands: a · b` line of
 * `agent-help`, and the indented rows under `Available Commands:` of
 * `--help`. Words that cannot be a subcommand are dropped.
 */
export function readSubcommands(help: string): readonly string[] {
	const found = new Set<string>();
	const lines = help.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const inline = /^\s*Subcommands:\s*(.*)$/i.exec(line);
		if (inline) {
			let text = inline[1];
			while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]) && !/:\s*$/.test(lines[index + 1]) && !/^\s*Next:/i.test(lines[index + 1])) {
				index += 1;
				text += ` · ${lines[index].trim()}`;
			}
			for (const word of text.split(/\s*·\s*|\s+/)) {
				if (/^[a-z][a-z0-9-]*$/i.test(word)) {
					found.add(word);
				}
			}
			continue;
		}
		if (/^\s*Available Commands:\s*$/i.test(line)) {
			for (let next = index + 1; next < lines.length; next += 1) {
				const row = /^\s+([a-z][a-z0-9-]*)\s{2,}\S/i.exec(lines[next]);
				if (!row) {
					break;
				}
				if (row[1] !== 'help' && row[1] !== 'completion') {
					found.add(row[1]);
				}
				index = next;
			}
		}
	}
	return [...found];
}

/** The flags a plugin's help lists, as the CLI's own help table gives them. */
export function readPluginFlags(help: string): readonly HelpFlag[] {
	return readFlagTable(help).filter(flag => flag.name !== '--help' && flag.name !== '--context');
}

/**
 * The commands the CLI itself provides, from its top-level help.
 *
 * A plugin name that is also one of these would run a built-in command
 * and not a plugin, so the plugin flow refuses them.
 */
export function readBuiltinCommands(...helps: readonly string[]): ReadonlySet<string> {
	const names = new Set<string>();
	for (const help of helps) {
		for (const line of help.split(/\r?\n/)) {
			const row = /^\s{2,}([a-z][a-z0-9-]*)\s{2,}\S/.exec(line);
			if (row) {
				names.add(row[1]);
				continue;
			}
			if (/^\s{2,}\S/.test(line) && /(?:^|\s)·(?:\s|$)|^\s{4,}[a-z]/.test(line)) {
				for (const word of line.trim().split(/\s*·\s*|\s+/)) {
					if (/^[a-z][a-z0-9-]*$/.test(word)) {
						names.add(word);
					}
				}
			}
		}
	}
	return names;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the CLI's refusal says no command or plugin has this name at all. */
export function isUnknownCommand(output: string, name: string): boolean {
	return new RegExp(`unknown command\\s+["'\`]?${escapeRegExp(name)}["'\`]?`, 'i').test(output);
}

/**
 * Whether the CLI's refusal means this plugin is not installed.
 *
 * The CLI says `the entire-NAME plugin is not installed; run 'entire plugin
 * install NAME' and retry` for a plugin it knows of, such as graph, brain
 * and investigate, and `unknown command "NAME"` for a name it does not know.
 * Both mean the same thing to the person: the plugin is not there.
 */
export function isMissingPlugin(output: string, name: string): boolean {
	return (
		isUnknownCommand(output, name) ||
		new RegExp(`\\bentire-${escapeRegExp(name)}\\s+plugin\\s+is\\s+not\\s+installed`, 'i').test(output)
	);
}

/** The install line a person can run themselves. */
export function installCommandLine(name: string): string {
	return `entire plugin install ${name}`;
}

/** What to say when a plugin is not installed. It names the plugin and the way forward. */
export function describeMissingPlugin(name: string): string {
	return `The "${name}" plugin is not installed. Install it with "${installCommandLine(name)}", or choose Install Plugin.`;
}

/** The flags of `entire plugin install` the extension uses. */
export const PLUGIN_INSTALL_WANTS = {
	skipPrompt: { description: /\bskip\b.*\bconfirm/i, required: true },
} as const satisfies Record<string, FlagWant>;

/** Arguments to install a plugin from the index by its bare name. */
export function pluginInstallArguments(name: string, skipPrompt: string): readonly string[] {
	return ['plugin', 'install', skipPrompt, '--', name];
}

/** Picks the install flags from the help. */
export function pickInstallFlags(help: string, fallback: readonly HelpFlag[]) {
	return pickFlags('plugin install', help, fallback, PLUGIN_INSTALL_WANTS);
}

/** The question before a plugin command runs. A plugin is another program, so it says whose and what. */
export function confirmPluginRun(name: string, words: readonly string[], acting: AccountContext): ControlConfirmation {
	const line = ['entire', name, ...words].join(' ');
	return {
		message: `Run the ${name} plugin?`,
		detail: `${line}\n\nIt runs as ${describeActingLogin(acting)}. A plugin is a separate program, and what it does is up to the plugin.`,
		action: 'Run Plugin',
	};
}

/** The question before a plugin is installed. */
export function confirmPluginInstall(name: string, acting: AccountContext): ControlConfirmation {
	return {
		message: `Install the ${name} plugin?`,
		detail:
			`${installCommandLine(name)}\n\nEntire downloads the plugin named "${name}" from its plugin index into your plugin directory, ` +
			`as ${describeActingLogin(acting)}. The plugin is an executable and runs with your permissions. Dependencies it declares are installed too.`,
		action: 'Install Plugin',
	};
}
