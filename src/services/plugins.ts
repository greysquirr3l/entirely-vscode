import {
	describeHelpFailure,
	failureDetail,
	invalidPluginArguments,
	isPluginName,
	isMissingPlugin,
	parseInstalledPlugins,
	pickInstallFlags,
	pluginArguments,
	pluginInstallArguments,
	readBuiltinCommands,
	readPluginFlags,
	readSubcommands,
	staticEnvironment,
	stripTerminalCodes,
	withSignInHint,
	type AccountContext,
	type InstalledPlugin,
} from '../lib/entire';
import type { HelpFlag } from '../lib/entire/search';
import type { CliRunner } from './cli';
import type { Read } from './controlPlane';

/** What a plugin's own help says it accepts. */
export interface PluginUsage {
	readonly subcommands: readonly string[];
	readonly flags: readonly HelpFlag[];
}

export type PluginRunOutcome =
	| { readonly kind: 'done'; readonly text: string }
	| { readonly kind: 'empty' }
	| { readonly kind: 'missing'; readonly name: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

export type PluginInstallOutcome =
	| { readonly kind: 'installed'; readonly text: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where plugins are listed, described, run and installed. */
export interface PluginSource {
	installed(): Promise<Read<readonly InstalledPlugin[]>>;
	/** Reads the plugin's subcommands and flags from its help. A plugin that is not installed comes back as `missing`. */
	usage(name: string): Promise<Read<PluginUsage> | { readonly ok: false; readonly missing: true; readonly detail: string }>;
	run(name: string, words: readonly string[], acting: AccountContext, signal?: AbortSignal): Promise<PluginRunOutcome>;
	install(name: string, acting: AccountContext, signal?: AbortSignal): Promise<PluginInstallOutcome>;
}

export interface PluginOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	readonly timeoutSeconds: () => number;
}

/**
 * Runs `entire plugin ...` and the plugin commands themselves.
 *
 * The saved login reaches a plugin only through `ENTIRE_CONTEXT`, which
 * the runner sets for a command given a login, so every run here passes
 * the login that was confirmed. A name that is one of the CLI's own
 * commands is refused: the plugin flow must not become a way to run a
 * built-in command without its own confirmation. Plugin output can carry
 * the user's work, so it stays out of the invocation record.
 */
export class PluginService implements PluginSource {
	constructor(private readonly options: PluginOptions) {}

	private get cwd(): string | undefined {
		return this.options.workspaceRoot();
	}

	async installed(): Promise<Read<readonly InstalledPlugin[]>> {
		const result = await this.options.runner.run(['plugin', 'list'], { cwd: this.cwd, timeoutMs: this.options.timeoutSeconds() * 1000 });
		if (!result.ok) {
			return { ok: false, detail: describeHelpFailure('plugin', 'list plugins', result.reason, failureDetail(result.stderr, result.stdout, result.detail)) };
		}
		return { ok: true, value: parseInstalledPlugins(stripTerminalCodes(result.stdout)) };
	}

	/** The CLI's own command names, or why they could not be read. */
	private async builtins(): Promise<Read<ReadonlySet<string>>> {
		const options = { cwd: this.cwd };
		const [guide, top] = await Promise.all([this.options.runner.usage('', options), this.options.runner.help('', options)]);
		if (!guide.ok && !top.ok) {
			return { ok: false, detail: describeHelpFailure('entire', 'run plugins', guide.reason, guide.detail) };
		}
		return {
			ok: true,
			value: readBuiltinCommands(guide.ok ? guide.value.raw : '', top.ok ? top.value.raw : ''),
		};
	}

	private async refuseBuiltin(name: string): Promise<string | undefined> {
		if (!isPluginName(name)) {
			return 'that is not a plugin name; use letters, digits, dashes and underscores';
		}
		const builtins = await this.builtins();
		if (!builtins.ok) {
			return builtins.detail;
		}
		const itself = `"${name}" is a command of the Entire CLI itself, not a plugin`;
		if (builtins.value.has(name.toLowerCase())) {
			return itself;
		}
		// Hidden commands (mcp, completion) are in no listing, but the CLI
		// answers their --help. A name it answers that no installed plugin
		// holds is one of its own commands.
		const answered = await this.options.runner.help(name, { cwd: this.cwd });
		if (!answered.ok) {
			return undefined;
		}
		const installed = await this.installed();
		if (!installed.ok) {
			return `${itself}, or cannot be checked: ${installed.detail}`;
		}
		return installed.value.some(plugin => plugin.name.toLowerCase() === name.toLowerCase()) ? undefined : itself;
	}

	async usage(name: string): Promise<Read<PluginUsage> | { readonly ok: false; readonly missing: true; readonly detail: string }> {
		const refused = await this.refuseBuiltin(name);
		if (refused) {
			return { ok: false, detail: refused };
		}
		const options = { cwd: this.cwd };
		const guide = await this.options.runner.usage(name, options);
		const read = guide.ok ? guide : await this.options.runner.help(name, options);
		if (!read.ok) {
			if (!guide.ok && isMissingPlugin(`${guide.stderr}\n${guide.stdout}`, name)) {
				return { ok: false, missing: true, detail: `the ${name} plugin is not installed` };
			}
			if (isMissingPlugin(`${read.stderr}\n${read.stdout}`, name)) {
				return { ok: false, missing: true, detail: `the ${name} plugin is not installed` };
			}
			return { ok: false, detail: describeHelpFailure(name, `read the ${name} plugin's help`, read.reason, failureDetail(read.stderr, read.stdout, read.detail)) };
		}
		const raw = read.value.raw;
		return { ok: true, value: { subcommands: readSubcommands(raw), flags: readPluginFlags(raw) } };
	}

	async run(name: string, words: readonly string[], acting: AccountContext, signal?: AbortSignal): Promise<PluginRunOutcome> {
		const refused = (await this.refuseBuiltin(name)) ?? invalidPluginArguments(words);
		if (refused) {
			return { kind: 'failed', detail: refused };
		}
		const result = await this.options.runner.run(pluginArguments(name, words), {
			cwd: this.cwd,
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: acting.name,
			env: staticEnvironment(),
			withholdBodies: true,
			// Everything after the plugin name is what the person typed: a prompt, a query.
			// The name stays visible so the record still says which plugin ran.
			redactFrom: 1,
			signal,
		});
		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled' };
			}
			if (isMissingPlugin(`${result.stderr}\n${result.stdout}`, name)) {
				return { kind: 'missing', name };
			}
			if (result.reason === 'timeout') {
				return { kind: 'failed', detail: `${result.detail}; raise entirely.pluginTimeout if the plugin needs longer` };
			}
			return { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
		}
		const text = stripTerminalCodes(result.stdout).trim();
		return text.length > 0 ? { kind: 'done', text } : { kind: 'empty' };
	}

	async install(name: string, acting: AccountContext, signal?: AbortSignal): Promise<PluginInstallOutcome> {
		if (!isPluginName(name)) {
			return { kind: 'failed', detail: 'that is not a plugin name; use letters, digits, dashes and underscores' };
		}
		const usage = await this.options.runner.usage('plugin install', { cwd: this.cwd });
		if (!usage.ok) {
			return { kind: 'failed', detail: describeHelpFailure('plugin install', 'install a plugin', usage.reason, usage.detail) };
		}
		const picked = pickInstallFlags(usage.value.raw, usage.value.flags);
		if (!picked.ok || !picked.flags.skipPrompt) {
			return { kind: 'failed', detail: 'this version of the Entire CLI cannot install a plugin without a prompt; update the CLI' };
		}
		const result = await this.options.runner.run(pluginInstallArguments(name, picked.flags.skipPrompt), {
			cwd: this.cwd,
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: acting.name,
			env: staticEnvironment(),
			signal,
		});
		if (!result.ok) {
			return result.reason === 'cancelled'
				? { kind: 'cancelled' }
				: { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
		}
		return { kind: 'installed', text: stripTerminalCodes(result.stdout).trim() };
	}
}
