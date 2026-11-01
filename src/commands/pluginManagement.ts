import {
	confirmIndexUpdate,
	confirmPluginRemove,
	confirmPluginRemoveForce,
	confirmPluginUpgrade,
	confirmPluginUpgradeAll,
	describeMissingPluginSubcommand,
	describePluginChange,
	describeUnmanagedPlugin,
	neutraliseLinks,
	oneLine,
	pickRemoveFlags,
	pluginPathOf,
	versionOf,
	type AccountContext,
	type ControlConfirmation,
	type PluginChange,
	type PluginSubcommand,
	type SearchRow,
} from '../lib/entire';
import type { PluginManagementSource } from '../services/pluginManagement';
import { exclusiveAction, type PluginChoice, type PluginResult } from './plugins';

/** One search hit in the picker. */
export interface SearchItem extends SearchRow {
	readonly installed: boolean;
	/** Why it cannot be installed, when it cannot. */
	readonly blocked?: string;
}

export interface FollowUp {
	readonly label: string;
	readonly run: () => Promise<void>;
}

/** The questions and answers of the plugin management flows. */
export interface PluginManagementUi {
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	pickPlugin(choices: readonly PluginChoice[], title: string): Promise<string | undefined>;
	/** The search term; empty is allowed. Undefined when the person backs out. */
	askTerm(): Promise<string | undefined>;
	pickResult(items: readonly SearchItem[]): Promise<string | undefined>;
	pickResultAction(name: string, installed: boolean): Promise<'info' | 'install' | undefined>;
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	/** Shows a message and returns at once; a follow-up button runs later, outside any flow's lock. */
	notify(level: 'info' | 'warn', message: string, followUp?: FollowUp): Promise<void>;
	showDocument(title: string, text: string): Promise<void>;
}

export interface PluginManagementDependencies {
	readonly source: PluginManagementSource;
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly ui: PluginManagementUi;
	readonly suggested: () => readonly string[];
	/** The existing install flow, with its own question. */
	readonly install: (name: string) => Promise<PluginResult>;
	/** Detects the Integrations view again. */
	readonly refresh: () => Promise<void>;
	/** The flag the install, run and management flows share. */
	readonly running?: { active: boolean };
}

export type PluginManagementResult =
	| 'shown'
	| 'done'
	| 'unchanged'
	| 'unconfirmed'
	| 'cancelled'
	| 'busy'
	| 'no-login'
	| 'unavailable'
	| 'refused'
	| 'failed'
	| 'installed';

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who this would run as. Sign in first.';

/** CLI text inside a notification: one line, no link syntax. */
function quoted(text: string, max = 200): string {
	return oneLine(neutraliseLinks(text), max);
}

/** Wraps a UI so every notification is link-neutral, whatever text reached it. */
export function withSafeNotifications(ui: PluginManagementUi): PluginManagementUi {
	return {
		confirm: prompt => ui.confirm(prompt),
		pickPlugin: (choices, title) => ui.pickPlugin(choices, title),
		askTerm: () => ui.askTerm(),
		pickResult: items => ui.pickResult(items),
		pickResultAction: (name, installed) => ui.pickResultAction(name, installed),
		withProgress: (title, work) => ui.withProgress(title, work),
		notify: (level, message, followUp) => ui.notify(level, neutraliseLinks(message), followUp ? { ...followUp, label: neutraliseLinks(followUp.label) } : undefined),
		showDocument: (title, text) => ui.showDocument(title, text),
	};
}

function exclusive<T extends PluginManagementResult | { readonly result: PluginManagementResult }>(
	deps: PluginManagementDependencies,
	work: () => Promise<T>,
	busy: T,
): Promise<T> {
	return exclusiveAction(deps.running, () => deps.ui.notify('warn', 'A plugin command is already running.'), busy, work);
}

/** The CLI's own help for the subcommand, or undefined after saying why it cannot be used. */
async function gate(deps: PluginManagementDependencies, subcommand: PluginSubcommand, what: string): Promise<string | undefined> {
	const check = await deps.source.check(subcommand);
	if (check.ok) {
		return check.raw;
	}
	const reason = check.kind === 'missing' ? describeMissingPluginSubcommand(subcommand) : check.detail;
	await deps.ui.notify('warn', `${what} is not available: ${reason}.`);
	return undefined;
}

async function actingOrWarn(deps: PluginManagementDependencies): Promise<AccountContext | undefined> {
	const acting = await deps.acting();
	if (!acting) {
		await deps.ui.notify('warn', NO_LOGIN);
	}
	return acting;
}

async function choosePlugin(deps: PluginManagementDependencies, title: string, managedOnly: boolean): Promise<string | undefined> {
	const listed = await deps.source.listing();
	const choices: PluginChoice[] = listed.ok ? listed.value.plugins.map(item => ({ name: item.name, detail: item.detail, installed: true })) : [];
	if (!managedOnly) {
		for (const name of deps.suggested()) {
			if (!choices.some(choice => choice.name === name)) {
				choices.push({ name, detail: 'not installed', installed: false });
			}
		}
	} else if (!listed.ok) {
		await deps.ui.notify('warn', `Plugins cannot be listed: ${listed.detail}. Nothing was run.`);
		return undefined;
	}
	const picked = await deps.ui.pickPlugin(choices, title);
	return picked?.trim();
}

/** Shows the index and install details of a plugin. Read-only: no question. */
export async function showPluginInfo(deps: PluginManagementDependencies, preset?: string): Promise<PluginManagementResult> {
	return exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			const name = preset ?? (await choosePlugin(deps, 'Plugin info', false));
			if (name === undefined || name.length === 0) {
				return 'cancelled';
			}
			const refused = await source.refuse(name);
			if (refused) {
				await ui.notify('warn', `Details for ${name} cannot be shown: ${refused}.`);
				return 'refused';
			}
			if (!(await gate(deps, 'info', 'Plugin info'))) {
				return 'unavailable';
			}
			const outcome = await ui.withProgress(`Reading the index entry for ${name}…`, signal => source.info(name, signal));
			if (outcome.kind === 'cancelled') {
				return 'cancelled';
			}
			const listed = await source.listing();
			let note: string | undefined;
			if (listed.ok && !listed.value.plugins.some(plugin => plugin.name === name) && (await source.availability(name)).kind === 'on-path') {
				note = describeUnmanagedPlugin(name, listed.value.directory);
			}
			const body = outcome.kind === 'done' ? outcome.text : `The index gave no details: ${outcome.detail}`;
			if (outcome.kind === 'failed' && note === undefined) {
				await ui.notify('warn', `Details for ${name} could not be read: ${quoted(outcome.detail, 300)}.`);
				return 'failed';
			}
			await ui.showDocument(`Plugin info: ${name}`, note ? `${note}\n\n${body}` : body);
			return 'shown';
		},
		'busy',
	);
}

/** Refreshes the plugin index after a question that names the login. */
export async function updatePluginIndex(deps: PluginManagementDependencies): Promise<PluginManagementResult> {
	return exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			if (!(await gate(deps, 'index update', 'Updating the plugin index'))) {
				return 'unavailable';
			}
			const acting = await actingOrWarn(deps);
			if (!acting) {
				return 'no-login';
			}
			if (!(await ui.confirm(confirmIndexUpdate(acting)))) {
				return 'cancelled';
			}
			const outcome = await ui.withProgress(`Refreshing the plugin index as ${acting.handle}…`, signal => source.updateIndex(acting, signal));
			switch (outcome.kind) {
				case 'done':
					await ui.notify(
						'info',
						'The plugin index was refreshed. The CLI does not report what changed, so there is nothing to read back.',
						outcome.text.length > 0 ? { label: 'Show CLI Text', run: () => ui.showDocument('Plugin index update', outcome.text) } : undefined,
					);
					return 'done';
				case 'cancelled':
					await ui.notify('info', 'The index refresh was cancelled. It was not retried, and the CLI may have finished part of it.');
					return 'cancelled';
				case 'failed':
					await ui.notify('warn', `The index was not refreshed: ${quoted(outcome.detail, 400)}.`);
					return 'failed';
			}
		},
		'busy',
	);
}

/** Searches the plugin index and offers Info or the existing install confirmation for a pick. */
export async function searchPluginIndex(deps: PluginManagementDependencies): Promise<PluginManagementResult> {
	const picked = await exclusive<{ readonly result: PluginManagementResult; readonly name?: string; readonly action?: 'info' | 'install' }>(
		deps,
		async () => {
			const { ui, source } = deps;
			if (!(await gate(deps, 'search', 'Searching the plugin index'))) {
				return { result: 'unavailable' };
			}
			const term = await ui.askTerm();
			if (term === undefined) {
				return { result: 'cancelled' };
			}
			const outcome = await ui.withProgress('Searching the plugin index…', signal => source.search(term, signal));
			switch (outcome.kind) {
				case 'cancelled':
					return { result: 'cancelled' };
				case 'failed':
					await ui.notify('warn', `The plugin index could not be searched: ${quoted(outcome.detail, 400)}.`, {
						label: 'Update Plugin Index',
						run: async () => void (await updatePluginIndex(deps)),
					});
					return { result: 'failed' };
				case 'empty':
					await ui.notify('info', 'The CLI printed nothing for that search.');
					return { result: 'shown' };
				case 'unreadable':
					await ui.showDocument('Plugin search', outcome.text);
					return { result: 'shown' };
				case 'found': {
					const listed = await source.listing();
					const refusals = await source.refuseAll(outcome.rows.map(row => row.name));
					const items: SearchItem[] = outcome.rows.map(row => ({
						...row,
						installed: listed.ok && listed.value.plugins.some(plugin => plugin.name === row.name),
						blocked: refusals.get(row.name),
					}));
					const name = await ui.pickResult(items);
					if (name === undefined) {
						return { result: 'cancelled' };
					}
					const item = items.find(candidate => candidate.name === name);
					if (item?.blocked) {
						await ui.notify('warn', `${name} cannot be installed: ${item.blocked}.`);
						return { result: 'refused' };
					}
					const action = await ui.pickResultAction(name, item?.installed ?? false);
					return action ? { result: 'shown', name, action } : { result: 'cancelled' };
				}
			}
		},
		{ result: 'busy' },
	);
	if (picked.name === undefined || picked.action === undefined) {
		return picked.result;
	}
	if (picked.action === 'info') {
		return showPluginInfo(deps, picked.name);
	}
	const refused = await deps.source.refuse(picked.name);
	if (refused) {
		await deps.ui.notify('warn', `${picked.name} cannot be installed: ${refused}.`);
		return 'refused';
	}
	const result = await deps.install(picked.name);
	await deps.refresh();
	return result === 'installed' ? 'installed' : result === 'cancelled' ? 'cancelled' : result === 'busy' ? 'busy' : result === 'no-login' ? 'no-login' : 'failed';
}

async function explainNotManaged(deps: PluginManagementDependencies, name: string, directory: string | undefined): Promise<void> {
	const onPath = (await deps.source.availability(name)).kind === 'on-path';
	await deps.ui.notify('warn', onPath ? describeUnmanagedPlugin(name, directory) : `${name} is not installed in the managed plugin directory, so nothing was run.`);
}

function changeLines(changes: readonly PluginChange[]): string[] {
	return changes.map(describePluginChange);
}

/** Upgrades one managed plugin after a question that names the download. */
export async function upgradePlugin(deps: PluginManagementDependencies, preset?: string): Promise<PluginManagementResult> {
	const result = await exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			const name = preset ?? (await choosePlugin(deps, 'Upgrade plugin', true));
			if (name === undefined || name.length === 0) {
				return 'cancelled';
			}
			const refused = await source.refuse(name);
			if (refused) {
				await ui.notify('warn', `${name} cannot be upgraded: ${refused}.`);
				return 'refused';
			}
			if (!(await gate(deps, 'upgrade', 'Upgrading a plugin'))) {
				return 'unavailable';
			}
			const before = await source.listing();
			if (!before.ok) {
				await ui.notify('warn', `Plugins cannot be listed: ${before.detail}. Nothing was run.`);
				return 'unavailable';
			}
			const row = before.value.plugins.find(plugin => plugin.name === name);
			if (!row) {
				await explainNotManaged(deps, name, before.value.directory);
				return 'refused';
			}
			const acting = await actingOrWarn(deps);
			if (!acting) {
				return 'no-login';
			}
			const from = versionOf(row.detail);
			if (!(await ui.confirm(confirmPluginUpgrade(name, from, before.value.directory, acting)))) {
				return 'cancelled';
			}
			const outcome = await ui.withProgress(`Upgrading the ${name} plugin as ${acting.handle}…`, signal => source.upgrade({ kind: 'one', name }, before.value.plugins, acting, signal));
			const own = outcome.kind === 'cancelled' ? undefined : outcome.changes.find(change => change.name === name);
			switch (outcome.kind) {
				case 'done':
					await ui.notify('info', `${name} upgraded from ${own?.from ?? 'an unknown version'} to ${own?.to ?? 'an unknown version'}. Read from a fresh plugin list.`);
					return 'done';
				case 'unchanged':
					await ui.notify(
						'info',
						`${name} is still at ${from ?? 'its installed version'}. The CLI skips pinned and linked plugins, and a plugin already on its newest tag stays.` +
							(outcome.text.length > 0 ? ` It said: "${quoted(outcome.text)}"` : ''),
					);
					return 'unchanged';
				case 'unconfirmed':
					await ui.notify('warn', `The upgrade of ${name} could not be confirmed: ${quoted(outcome.detail)}. Nothing was retried.`);
					return 'unconfirmed';
				case 'failed':
					await ui.notify('warn', `${name} was not upgraded: ${quoted(outcome.detail, 400)}.${own ? ` The fresh list says ${describePluginChange(own)}.` : ''}`);
					return 'failed';
				case 'cancelled':
					await ui.notify('info', `The upgrade of ${name} was cancelled. It was not retried; check the plugin list.`);
					return 'cancelled';
			}
		},
		'busy',
	);
	await deps.refresh();
	return result;
}

/** Upgrades every managed plugin after one question that lists them. */
export async function upgradeAllPlugins(deps: PluginManagementDependencies): Promise<PluginManagementResult> {
	const result = await exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			if (!(await gate(deps, 'upgrade', 'Upgrading plugins'))) {
				return 'unavailable';
			}
			const before = await source.listing();
			if (!before.ok) {
				await ui.notify('warn', `Plugins cannot be listed: ${before.detail}. Nothing was run.`);
				return 'unavailable';
			}
			if (before.value.plugins.length === 0) {
				await ui.notify('info', 'No plugins are installed in the managed directory, so there is nothing to upgrade.');
				return 'unchanged';
			}
			const acting = await actingOrWarn(deps);
			if (!acting) {
				return 'no-login';
			}
			if (!(await ui.confirm(confirmPluginUpgradeAll(before.value.plugins, before.value.directory, acting)))) {
				return 'cancelled';
			}
			const outcome = await ui.withProgress(`Upgrading all plugins as ${acting.handle}…`, signal => source.upgrade({ kind: 'all' }, before.value.plugins, acting, signal));
			if (outcome.kind === 'cancelled') {
				await ui.notify('info', 'The upgrade was cancelled. It was not retried; check the plugin list.');
				return 'cancelled';
			}
			const lines = changeLines(outcome.changes);
			const report = async (level: 'info' | 'warn', head: string): Promise<void> => {
				if (lines.length <= 3) {
					await ui.notify(level, [head, ...lines].join('\n'));
				} else {
					await ui.notify(level, head, { label: 'Open Details', run: () => ui.showDocument('Plugin upgrade', [head, ...lines].join('\n')) });
				}
			};
			switch (outcome.kind) {
				case 'done':
					await report('info', 'Plugins upgraded. Read from a fresh plugin list:');
					return 'done';
				case 'unchanged':
					await report('info', 'No plugin changed version. The CLI skips pinned and linked plugins.');
					return 'unchanged';
				case 'unconfirmed':
					await report('warn', `The upgrade could not be confirmed: ${quoted(outcome.detail)}.`);
					return 'unconfirmed';
				case 'failed':
					await report('warn', `The upgrade failed: ${quoted(outcome.detail, 400)}. The fresh list says:`);
					return 'failed';
			}
		},
		'busy',
	);
	await deps.refresh();
	return result;
}

/** Removes one managed plugin after a question that names the directory, and verifies it against a fresh list. */
export async function removePlugin(deps: PluginManagementDependencies, preset?: string): Promise<PluginManagementResult> {
	const result = await exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			const name = preset ?? (await choosePlugin(deps, 'Remove plugin', true));
			if (name === undefined || name.length === 0) {
				return 'cancelled';
			}
			const refused = await source.refuse(name);
			if (refused) {
				await ui.notify('warn', `${name} cannot be removed: ${refused}.`);
				return 'refused';
			}
			const help = await gate(deps, 'remove', 'Removing a plugin');
			if (help === undefined) {
				return 'unavailable';
			}
			const before = await source.listing();
			if (!before.ok) {
				await ui.notify('warn', `Plugins cannot be listed: ${before.detail}. Nothing was run.`);
				return 'unavailable';
			}
			const row = before.value.plugins.find(plugin => plugin.name === name);
			if (!row) {
				await explainNotManaged(deps, name, before.value.directory);
				return 'refused';
			}
			const acting = await actingOrWarn(deps);
			if (!acting) {
				return 'no-login';
			}
			if (!(await ui.confirm(confirmPluginRemove(name, before.value.directory, pluginPathOf(row.detail), acting)))) {
				return 'cancelled';
			}
			let outcome = await ui.withProgress(`Removing the ${name} plugin as ${acting.handle}…`, signal => source.remove(name, false, acting, signal));
			if (outcome.kind === 'refused-dependents') {
				const forceFlag = pickRemoveFlags(help);
				if (!forceFlag.ok || !forceFlag.flags.force) {
					await ui.notify('warn', `${name} was not removed: ${quoted(outcome.detail, 400)}. This version of the CLI does not describe a force flag, so there is no way to override it here.`);
					return 'refused';
				}
				if (!(await ui.confirm(confirmPluginRemoveForce(name, outcome.detail, acting)))) {
					await ui.notify('warn', `${name} was not removed: ${quoted(outcome.detail, 400)}.`);
					return 'cancelled';
				}
				outcome = await ui.withProgress(`Removing the ${name} plugin as ${acting.handle}…`, signal => source.remove(name, true, acting, signal));
			}
			switch (outcome.kind) {
				case 'done': {
					const stillThere = (await source.availability(name)).kind === 'on-path';
					await ui.notify(
						'info',
						`${name} was removed. It is no longer in the fresh plugin list.` +
							(stillThere ? ` Another copy of ${name} is on the PATH outside the managed directory; the CLI cannot remove it.` : ''),
					);
					return 'done';
				}
				case 'still-listed':
					await ui.notify('warn', `The CLI said it removed ${name}, but ${name} is still listed. Nothing more was run.`);
					return 'failed';
				case 'unconfirmed':
					await ui.notify('warn', `The removal of ${name} could not be confirmed: ${quoted(outcome.detail)}. Nothing was retried.`);
					return 'unconfirmed';
				case 'failed':
					await ui.notify(
						'warn',
						`${name} was not removed: ${quoted(outcome.detail, 400)}.` +
							(outcome.stillListed === true ? ` ${name} is still in the plugin list.` : outcome.stillListed === false ? ` ${name} is no longer in the plugin list.` : ''),
					);
					return 'failed';
				case 'refused-dependents':
					await ui.notify('warn', `${name} was not removed: ${quoted(outcome.detail, 400)}.`);
					return 'failed';
				case 'cancelled':
					await ui.notify('info', `The removal of ${name} was cancelled. It was not retried; check the plugin list.`);
					return 'cancelled';
			}
		},
		'busy',
	);
	await deps.refresh();
	return result;
}

/** Runs the CLI's plugin check. A failing check is a finding; the exit status is the verdict. */
export async function checkPlugins(deps: PluginManagementDependencies): Promise<PluginManagementResult> {
	return exclusive(
		deps,
		async () => {
			const { ui, source } = deps;
			if (!(await gate(deps, 'doctor', 'The plugin check'))) {
				return 'unavailable';
			}
			const outcome = await ui.withProgress('Checking plugins…', signal => source.runCheck(signal));
			const details = (text: string): FollowUp | undefined => (text.length > 0 ? { label: 'Open Details', run: () => ui.showDocument('Plugin check', text) } : undefined);
			switch (outcome.kind) {
				case 'healthy':
					await ui.notify('info', `Plugins: healthy.${outcome.text.length > 0 ? ` The CLI said: "${quoted(outcome.text, 120)}"` : ''}`, details(outcome.text));
					return 'done';
				case 'findings':
					await ui.notify('warn', 'Plugin check found problems.', details(outcome.text));
					return 'failed';
				case 'failed':
					await ui.notify('warn', `The plugin check could not run: ${quoted(outcome.detail, 400)}.`);
					return 'failed';
			}
		},
		'busy',
	);
}
