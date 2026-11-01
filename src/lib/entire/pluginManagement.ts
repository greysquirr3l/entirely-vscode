import { describeActingLogin, type ControlConfirmation } from './controlPlaneActions';
import { pickFlags, type FlagWant } from './controlPlaneFlags';
import { END_OF_OPTIONS } from './operand';
import { isPluginName, type InstalledPlugin } from './plugins';
import type { AccountContext } from './accountContext';
import { oneLine } from './text';

/** The `entire plugin` subcommands this module builds arguments for. `browse` is not one: it needs a terminal. */
export type PluginSubcommand = 'info' | 'search' | 'index update' | 'upgrade' | 'remove' | 'doctor';

/** The flags of `entire plugin upgrade`, found by what the help says. */
export const PLUGIN_UPGRADE_WANTS = {
	all: { name: /\ball\b/i, description: /\bevery\b.*\bplugin/i, required: true },
} as const satisfies Record<string, FlagWant>;

/** The flags of `entire plugin remove`. Without the force role the second question is never offered. */
export const PLUGIN_REMOVE_WANTS = {
	force: { name: /force/i, description: /\bremove even\b|\bdepend/i },
} as const satisfies Record<string, FlagWant>;

export function pickUpgradeFlags(help: string) {
	return pickFlags('plugin upgrade', help, [], PLUGIN_UPGRADE_WANTS);
}

export function pickRemoveFlags(help: string) {
	return pickFlags('plugin remove', help, [], PLUGIN_REMOVE_WANTS);
}

export function pluginInfoArguments(name: string): readonly string[] {
	return ['plugin', 'info', END_OF_OPTIONS, name];
}

/** An empty term lists whatever the CLI lists for no term. */
export function pluginSearchArguments(term?: string): readonly string[] {
	const typed = term?.trim() ?? '';
	return typed.length > 0 ? ['plugin', 'search', END_OF_OPTIONS, typed] : ['plugin', 'search'];
}

export function pluginIndexUpdateArguments(): readonly string[] {
	return ['plugin', 'index', 'update'];
}

export type UpgradeTarget = { readonly kind: 'one'; readonly name: string } | { readonly kind: 'all'; readonly flag: string };

/** One name or the all flag, never both. */
export function pluginUpgradeArguments(target: UpgradeTarget): readonly string[] {
	return target.kind === 'one' ? ['plugin', 'upgrade', END_OF_OPTIONS, target.name] : ['plugin', 'upgrade', target.flag];
}

export function pluginRemoveArguments(name: string, forceFlag?: string): readonly string[] {
	return ['plugin', 'remove', ...(forceFlag ? [forceFlag] : []), END_OF_OPTIONS, name];
}

export function pluginDoctorArguments(): readonly string[] {
	return ['plugin', 'doctor'];
}

/** One search hit. */
export interface SearchRow {
	readonly name: string;
	readonly description: string;
}

/**
 * Reads `entire plugin search`.
 *
 * The layout was not observed, so a row is read only when a plugin name
 * stands alone or is followed by a tab or two spaces and then free text.
 * A heading, a blank line, a sentence and a "no results" line are skipped.
 * No rows from non-empty text means the caller shows the CLI's own words.
 */
export function parseSearchResults(text: string): readonly SearchRow[] {
	const rows: SearchRow[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0 || /^(no\s|none\b|nothing\b)/i.test(line)) {
			continue;
		}
		const match = /^(\S+)(?:(?:\t|\s{2,})(.*))?$/.exec(line);
		if (!match) {
			continue;
		}
		const name = match[1].replace(/^entire-/, '');
		const description = (match[2] ?? '').trim();
		if (!isPluginName(name) || rows.some(row => row.name.toLowerCase() === name.toLowerCase())) {
			continue;
		}
		if (/^[A-Z][A-Z_]+$/.test(name) && /^[A-Z\s_/-]*$/.test(description)) {
			continue;
		}
		rows.push({ name, description });
	}
	return rows;
}

/** The managed directory, from the first line of `plugin list` or its empty form. */
export function parseManagedDirectory(listText: string): string | undefined {
	const listed = /^Managed plugin directory:\s*(.+?)\s*$/m.exec(listText);
	if (listed) {
		return listed[1];
	}
	const empty = /^No plugins installed in\s+(.+?)\.?\s*$/m.exec(listText);
	return empty ? empty[1] : undefined;
}

/** The first version-looking word of a list row. */
export function versionOf(detail: string): string | undefined {
	return /(?:^|\s)(v?\d+(?:\.\d+)+[\w.+-]{0,40})/.exec(detail)?.[1];
}

/** The file a list row points at, after the arrow. */
export function pluginPathOf(detail: string): string | undefined {
	const path = /→\s*(.+?)\s*$/.exec(detail)?.[1];
	return path && path.length > 0 ? path : undefined;
}

export interface PluginChange {
	readonly name: string;
	/** `unknown` is a plugin whose row carries no version on one side, so a change cannot be told. */
	readonly kind: 'changed' | 'unchanged' | 'unknown' | 'added' | 'removed';
	readonly from?: string;
	readonly to?: string;
}

/** Compares two readings of the installed list by each plugin's version. */
export function diffVersions(before: readonly InstalledPlugin[], after: readonly InstalledPlugin[]): readonly PluginChange[] {
	const changes: PluginChange[] = [];
	for (const old of before) {
		const now = after.find(plugin => plugin.name === old.name);
		const from = versionOf(old.detail);
		if (!now) {
			changes.push({ name: old.name, kind: 'removed', from });
			continue;
		}
		const to = versionOf(now.detail);
		if (from === undefined && to === undefined) {
			changes.push({ name: old.name, kind: 'unknown' });
		} else {
			changes.push({ name: old.name, kind: from === to ? 'unchanged' : 'changed', from, to });
		}
	}
	for (const now of after) {
		if (!before.some(plugin => plugin.name === now.name)) {
			changes.push({ name: now.name, kind: 'added', to: versionOf(now.detail) });
		}
	}
	return changes;
}

/** One change in words. */
export function describePluginChange(change: PluginChange): string {
	const at = (version: string | undefined) => version ?? 'no version shown';
	switch (change.kind) {
		case 'changed':
			return `${change.name} went from ${at(change.from)} to ${at(change.to)}`;
		case 'unchanged':
			return `${change.name} is still at ${at(change.from)}`;
		case 'unknown':
			return `${change.name} shows no version, so a change cannot be told`;
		case 'added':
			return `${change.name} is new in the list (${at(change.to)})`;
		case 'removed':
			return `${change.name} is no longer in the list`;
	}
}

const DOWNLOAD =
	'Entire looks up the newest semver tag of the repository the plugin was installed from (the index or the URL recorded in its install manifest) ' +
	"and downloads that release's asset over HTTPS, checking it against the release's checksums.txt when one is published. " +
	'The downloaded binary replaces the installed one and runs with your permissions.';

const NO_PREVIEW = 'The newest version cannot be previewed: the CLI has no dry run.';

function directoryWords(directory: string | undefined): string {
	return directory ? oneLine(directory, 300) : 'the managed plugin directory';
}

export function confirmPluginUpgrade(name: string, version: string | undefined, directory: string | undefined, acting: AccountContext): ControlConfirmation {
	return {
		message: `Upgrade the ${name} plugin from ${version ?? 'its installed version'} to its newest release?`,
		detail:
			`${DOWNLOAD} It replaces ${name} in ${directoryWords(directory)}. It runs as ${describeActingLogin(acting)} on Entire. ${NO_PREVIEW}`,
		action: 'Upgrade Plugin',
	};
}

export function confirmPluginUpgradeAll(plugins: readonly InstalledPlugin[], directory: string | undefined, acting: AccountContext): ControlConfirmation {
	const rows = plugins.map(plugin => `  ${plugin.name} ${versionOf(plugin.detail) ?? '(no version shown)'}`).join('\n');
	return {
		message: `Upgrade all ${plugins.length} installed plugin${plugins.length === 1 ? '' : 's'}?`,
		detail:
			`Up to ${plugins.length} may be replaced; the CLI skips plugins installed with a pin and linked local-dev installs.\n${rows}\n\n` +
			`${DOWNLOAD} They are replaced in ${directoryWords(directory)}. It runs as ${describeActingLogin(acting)} on Entire. ${NO_PREVIEW} The versions above are the current ones.`,
		action: 'Upgrade All Plugins',
	};
}

export function confirmPluginRemove(name: string, directory: string | undefined, path: string | undefined, acting: AccountContext): ControlConfirmation {
	return {
		message: `Remove the ${name} plugin?`,
		detail:
			`This deletes ${name} from ${directoryWords(directory)}${path ? ` (${oneLine(path, 300)})` : ''}. ` +
			`The plugin stops working in every workspace on this machine until it is installed again with "entire plugin install ${name}". ` +
			`It runs as ${describeActingLogin(acting)}.`,
		action: 'Remove Plugin',
	};
}

/** The second question, after the CLI refused because other plugins depend on the target. */
export function confirmPluginRemoveForce(name: string, reason: string, acting: AccountContext): ControlConfirmation {
	return {
		message: `Remove ${name} even though other plugins depend on it?`,
		detail:
			`The CLI refused: ${oneLine(reason, 400)}\n\nThe plugins that depend on ${name} will stop working. ` +
			`This is a new action, not a retry. It runs as ${describeActingLogin(acting)}.`,
		action: 'Remove Anyway',
	};
}

export function confirmIndexUpdate(acting: AccountContext): ControlConfirmation {
	return {
		message: 'Refresh the plugin index?',
		detail:
			`Entire fetches the plugin index over the network and replaces its local copy of the index, as ${describeActingLogin(acting)} on this machine. ` +
			'No plugin is installed or changed.',
		action: 'Refresh Index',
	};
}

/** Said on the row, in the Info result, and when a removal is asked for by name. */
export function describeUnmanagedPlugin(name: string, directory?: string): string {
	return (
		`${name} was found on the PATH, outside the managed directory${directory ? ` ${oneLine(directory, 300)}` : ''}. ` +
		'The Entire CLI can only remove or upgrade plugins in the managed directory; delete this binary by hand to remove it.'
	);
}

export function describeMissingPluginSubcommand(subcommand: PluginSubcommand): string {
	return `this version of the Entire CLI has no "plugin ${subcommand}"; update the CLI`;
}

/** Whether a refused removal says other plugins depend on the target. */
export function refusedForDependents(text: string): boolean {
	return /\bdepend/i.test(text);
}

/** What the plugin check said, for the doctor report. Only the verdict goes in; the CLI's text is behind Check Plugins. */
export type PluginCheckReading =
	| { readonly kind: 'healthy' }
	| { readonly kind: 'problems' }
	| { readonly kind: 'failed'; readonly detail: string }
	| { readonly kind: 'unsupported'; readonly detail: string }
	| { readonly kind: 'no-cli'; readonly detail: string };

export function describePluginCheck(reading: PluginCheckReading | undefined): readonly string[] {
	if (!reading) {
		return ['- (not run)'];
	}
	switch (reading.kind) {
		case 'healthy':
			return ['- Result: healthy'];
		case 'problems':
			return ['- Result: the CLI reported problems; run "Entirely: Check Plugins" for its text'];
		case 'failed':
			return [`- Result: the check could not run (${oneLine(reading.detail, 200)})`];
		case 'unsupported':
			return [`- Result: not available (${oneLine(reading.detail, 200)})`];
		case 'no-cli':
			return [`- Result: not run (${oneLine(reading.detail, 200)})`];
	}
}
