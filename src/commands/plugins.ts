import {
	confirmPluginInstall,
	confirmPluginRun,
	describeMissingPlugin,
	invalidPluginArguments,
	isPluginName,
	splitWords,
	type AccountContext,
	type ControlConfirmation,
} from '../lib/entire';
import type { HelpFlag } from '../lib/entire/search';
import type { PluginSource } from '../services/plugins';

/** One plugin in the picker. */
export interface PluginChoice {
	readonly name: string;
	readonly detail: string;
	readonly installed: boolean;
}

/** The questions and answers of the plugin commands. */
export interface PluginUi {
	pickPlugin(choices: readonly PluginChoice[]): Promise<string | undefined>;
	pickSubcommand(plugin: string, subcommands: readonly string[]): Promise<string | undefined>;
	/** Asks for the arguments; the flags are the plugin's own, read from its help. */
	askArguments(plugin: string, flags: readonly HelpFlag[], validate: (text: string) => string | undefined): Promise<string | undefined>;
	/** True only when the person chose to go ahead. */
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	warn(message: string): Promise<void>;
	/** Offers to install a plugin that is missing. True when the person accepts. */
	offerInstall(message: string, name: string): Promise<boolean>;
	showOutput(plugin: string, text: string): Promise<void>;
	inform(message: string): Promise<void>;
}

export interface PluginDependencies {
	readonly source: PluginSource;
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly ui: PluginUi;
	/** The plugin names offered when none is picked, from the user's setting. */
	readonly suggested: () => readonly string[];
	readonly running?: { active: boolean };
}

export type PluginResult = 'shown' | 'cancelled' | 'busy' | 'no-login' | 'missing' | 'unavailable' | 'failed' | 'installed';

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who the plugin would run as. Sign in first.';
const sharedRunning = { active: false };

async function exclusive(deps: PluginDependencies, work: () => Promise<PluginResult>): Promise<PluginResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.warn('A plugin command is already running.');
		return 'busy';
	}
	running.active = true;
	try {
		return await work();
	} finally {
		running.active = false;
	}
}

async function choosePlugin(deps: PluginDependencies, installOnly: boolean): Promise<string | undefined | 'failed'> {
	const listed = await deps.source.installed();
	if (!listed.ok) {
		await deps.ui.warn(`Plugins cannot be listed: ${listed.detail}.`);
		return 'failed';
	}
	const choices: PluginChoice[] = listed.value.map(item => ({ name: item.name, detail: item.detail, installed: true }));
	for (const name of deps.suggested()) {
		if (!choices.some(choice => choice.name === name)) {
			choices.push({ name, detail: 'not installed', installed: false });
		}
	}
	const picked = await deps.ui.pickPlugin(installOnly ? choices.filter(choice => !choice.installed) : choices);
	return picked === undefined ? undefined : picked.trim();
}

async function offerInstall(deps: PluginDependencies, name: string): Promise<PluginResult> {
	if (await deps.ui.offerInstall(describeMissingPlugin(name), name)) {
		return installPlugin(deps, name);
	}
	return 'missing';
}

/**
 * Asks which plugin and which arguments, confirms, runs the plugin as the
 * acting login, and opens its output.
 *
 * What a plugin accepts is read from its own help: its subcommands are
 * offered as a list and its flags are shown while the arguments are
 * typed. A plugin that is not installed is named, and installing it is
 * offered rather than reported as a command failure.
 */
export async function runPluginCommand(deps: PluginDependencies, preset?: string): Promise<PluginResult> {
	return exclusive(deps, async () => {
		const { ui, source } = deps;
		const name = preset ?? (await choosePlugin(deps, false));
		if (name === undefined) {
			return 'cancelled';
		}
		if (name === 'failed') {
			return 'unavailable';
		}
		if (!isPluginName(name)) {
			await ui.warn('That is not a plugin name. Use letters, digits, dashes and underscores.');
			return 'failed';
		}

		const usage = await source.usage(name);
		if (!usage.ok) {
			if ('missing' in usage) {
				return offerInstall(deps, name);
			}
			await ui.warn(`The ${name} plugin cannot be run: ${usage.detail}.`);
			return 'unavailable';
		}

		const words: string[] = [];
		if (usage.value.subcommands.length > 0) {
			const sub = await ui.pickSubcommand(name, usage.value.subcommands);
			if (sub === undefined) {
				return 'cancelled';
			}
			if (sub.length > 0) {
				words.push(sub);
			}
		}
		const typed = await ui.askArguments(name, usage.value.flags, text => invalidPluginArguments(splitWords(text)));
		if (typed === undefined) {
			return 'cancelled';
		}
		words.push(...splitWords(typed));

		const acting = await deps.acting();
		if (!acting) {
			await ui.warn(NO_LOGIN);
			return 'no-login';
		}
		if (!(await ui.confirm(confirmPluginRun(name, words, acting)))) {
			return 'cancelled';
		}

		const outcome = await ui.withProgress(`Running the ${name} plugin as ${acting.handle}…`, signal => source.run(name, words, acting, signal));
		switch (outcome.kind) {
			case 'done':
				await ui.showOutput(name, outcome.text);
				return 'shown';
			case 'empty':
				await ui.inform(`The ${name} plugin finished and printed nothing.`);
				return 'shown';
			case 'missing':
				return offerInstall(deps, name);
			case 'cancelled':
				return 'cancelled';
			case 'failed':
				await ui.warn(`The ${name} plugin failed: ${outcome.detail}.`);
				return 'failed';
		}
	});
}

async function installPlugin(deps: PluginDependencies, name: string): Promise<PluginResult> {
	const { ui, source } = deps;
	const acting = await deps.acting();
	if (!acting) {
		await ui.warn(NO_LOGIN);
		return 'no-login';
	}
	if (!(await ui.confirm(confirmPluginInstall(name, acting)))) {
		return 'cancelled';
	}
	const outcome = await ui.withProgress(`Installing the ${name} plugin…`, signal => source.install(name, acting, signal));
	switch (outcome.kind) {
		case 'installed':
			await ui.inform(`The ${name} plugin is installed. Run it with Entirely: Run Plugin Command.`);
			return 'installed';
		case 'cancelled':
			return 'cancelled';
		case 'failed':
			await ui.warn(`The ${name} plugin could not be installed: ${outcome.detail}.`);
			return 'failed';
	}
}

/** Installs a plugin from the plugin index, after a question that names what will be downloaded. */
export async function installPluginCommand(deps: PluginDependencies, preset?: string): Promise<PluginResult> {
	return exclusive(deps, async () => {
		const name = preset ?? (await choosePlugin(deps, true));
		if (name === undefined) {
			return 'cancelled';
		}
		if (name === 'failed') {
			return 'unavailable';
		}
		if (!isPluginName(name)) {
			await deps.ui.warn('That is not a plugin name. Use letters, digits, dashes and underscores.');
			return 'failed';
		}
		return installPlugin(deps, name);
	});
}
