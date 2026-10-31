import {
	describeHelpFailure,
	diffVersions,
	isPluginName,
	failureDetail,
	parseInstalledPlugins,
	parseManagedDirectory,
	parseSearchResults,
	pickRemoveFlags,
	pickUpgradeFlags,
	pluginDoctorArguments,
	pluginIndexUpdateArguments,
	pluginInfoArguments,
	pluginRemoveArguments,
	pluginSearchArguments,
	pluginUpgradeArguments,
	refusedForDependents,
	staticEnvironment,
	stripTerminalCodes,
	withSignInHint,
	type AccountContext,
	type InstalledPlugin,
	type PluginChange,
	type PluginCheckReading,
	type PluginSubcommand,
	type SearchRow,
	type UpgradeTarget,
} from '../lib/entire';
import type { CliRunner } from './cli';
import type { Read } from './controlPlane';
import type { PluginAvailability, PluginService } from './plugins';

/** Whether the CLI has a plugin subcommand, and the help it described itself with. */
export type SubcommandCheck =
	| { readonly ok: true; readonly raw: string }
	| { readonly ok: false; readonly kind: 'no-cli' | 'missing' | 'failed'; readonly detail: string };

export interface PluginListing {
	readonly plugins: readonly InstalledPlugin[];
	readonly directory?: string;
}

export type InfoOutcome =
	| { readonly kind: 'done'; readonly text: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

export type SearchOutcome =
	| { readonly kind: 'found'; readonly rows: readonly SearchRow[]; readonly text: string }
	/** Exit 0 and text, but no row could be read. The CLI's words are shown instead of "no results". */
	| { readonly kind: 'unreadable'; readonly text: string }
	| { readonly kind: 'empty' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

export type CheckOutcome =
	| { readonly kind: 'healthy'; readonly text: string }
	/** A non-zero exit is the verdict; the text is shown, not judged. */
	| { readonly kind: 'findings'; readonly text: string }
	| { readonly kind: 'failed'; readonly detail: string };

export type IndexOutcome =
	| { readonly kind: 'done'; readonly text: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

export type UpgradeOutcome =
	| { readonly kind: 'done'; readonly changes: readonly PluginChange[]; readonly text: string }
	| { readonly kind: 'unchanged'; readonly changes: readonly PluginChange[]; readonly text: string }
	| { readonly kind: 'unconfirmed'; readonly changes: readonly PluginChange[]; readonly text: string; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string; readonly changes: readonly PluginChange[] }
	| { readonly kind: 'cancelled' };

export type RemoveOutcome =
	| { readonly kind: 'done'; readonly after: readonly InstalledPlugin[] }
	| { readonly kind: 'still-listed'; readonly text: string }
	| { readonly kind: 'refused-dependents'; readonly detail: string }
	| { readonly kind: 'unconfirmed'; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string; readonly stillListed: boolean | undefined }
	| { readonly kind: 'cancelled' };

/** What the plugin management flows ask of the CLI. */
export interface PluginManagementSource {
	check(subcommand: PluginSubcommand): Promise<SubcommandCheck>;
	listing(): Promise<Read<PluginListing>>;
	/** Why a name cannot be acted on as a plugin, or undefined. */
	refuse(name: string): Promise<string | undefined>;
	availability(name: string): Promise<PluginAvailability>;
	info(name: string, signal?: AbortSignal): Promise<InfoOutcome>;
	search(term: string, signal?: AbortSignal): Promise<SearchOutcome>;
	runCheck(signal?: AbortSignal): Promise<CheckOutcome>;
	updateIndex(acting: AccountContext, signal?: AbortSignal): Promise<IndexOutcome>;
	upgrade(target: { readonly kind: 'one'; readonly name: string } | { readonly kind: 'all' }, before: readonly InstalledPlugin[], acting: AccountContext, signal?: AbortSignal): Promise<UpgradeOutcome>;
	remove(name: string, force: boolean, acting: AccountContext, signal?: AbortSignal): Promise<RemoveOutcome>;
	/** Reasons, by name, that a search hit cannot be installed: not a plugin name, or a command of the CLI itself. */
	refuseAll(names: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface PluginManagementOptions {
	readonly runner: CliRunner;
	readonly plugins: PluginService;
	readonly workspaceRoot: () => string | undefined;
	readonly timeoutSeconds: () => number;
}

type Executed =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly cancelled: boolean; readonly detail: string; readonly text: string };

/**
 * Runs `entire plugin info|search|index update|upgrade|remove|doctor`.
 *
 * Every mutating command runs once, as the login that was confirmed, and
 * is never retried. Upgrade and remove read `plugin list` again afterwards
 * and declare a change only when the fresh list shows one. Output stays out
 * of the invocation record, and the typed search term is redacted.
 */
export class PluginManagementService implements PluginManagementSource {
	constructor(private readonly options: PluginManagementOptions) {}

	private get cwd(): string | undefined {
		return this.options.workspaceRoot();
	}

	private get timeoutMs(): number {
		return this.options.timeoutSeconds() * 1000;
	}

	async check(subcommand: PluginSubcommand): Promise<SubcommandCheck> {
		const usage = await this.options.runner.usage(`plugin ${subcommand}`, { cwd: this.cwd, timeoutMs: this.timeoutMs, withholdBodies: true });
		if (usage.ok) {
			return { ok: true, raw: usage.value.raw };
		}
		const detail = describeHelpFailure(`plugin ${subcommand}`, `use plugin ${subcommand}`, usage.reason, failureDetail(usage.stderr, '', usage.detail));
		if (usage.reason === 'absent' || usage.reason === 'broken') {
			return { ok: false, kind: 'no-cli', detail };
		}
		return { ok: false, kind: usage.reason === 'exit-code' ? 'missing' : 'failed', detail };
	}

	async listing(): Promise<Read<PluginListing>> {
		const result = await this.options.runner.run(['plugin', 'list'], { cwd: this.cwd, timeoutMs: this.timeoutMs, withholdBodies: true });
		if (!result.ok) {
			const said = failureDetail(result.stderr, result.stdout, result.detail);
			return { ok: false, detail: result.reason === 'absent' || result.reason === 'broken' ? describeHelpFailure('plugin', 'list plugins', result.reason, said) : `plugin list failed: ${said}` };
		}
		const text = stripTerminalCodes(result.stdout);
		return { ok: true, value: { plugins: parseInstalledPlugins(text), directory: parseManagedDirectory(text) } };
	}

	refuse(name: string): Promise<string | undefined> {
		return this.options.plugins.refuseBuiltin(name);
	}

	async refuseAll(names: readonly string[]): Promise<ReadonlyMap<string, string>> {
		const reasons = new Map<string, string>();
		const builtins = await this.options.plugins.builtinNames();
		for (const name of names) {
			if (!isPluginName(name)) {
				reasons.set(name, 'that is not a plugin name');
			} else if (builtins.ok && builtins.value.has(name.toLowerCase())) {
				reasons.set(name, `"${name}" is a command of the Entire CLI itself, not a plugin`);
			}
		}
		return reasons;
	}

	async availability(name: string): Promise<PluginAvailability> {
		return (await this.options.plugins.availability([name])).get(name) ?? { kind: 'unknown', detail: 'the CLI gave no answer' };
	}

	private async execute(args: readonly string[], extra: { acting?: AccountContext; signal?: AbortSignal; redactOperands?: boolean }): Promise<Executed> {
		const result = await this.options.runner.run(args, {
			cwd: this.cwd,
			timeoutMs: this.timeoutMs,
			context: extra.acting?.name,
			env: staticEnvironment(),
			withholdBodies: true,
			redactOperands: extra.redactOperands,
			signal: extra.signal,
		});
		const text = stripTerminalCodes(result.stdout).trim();
		if (result.ok) {
			return { ok: true, text };
		}
		const said = withSignInHint(failureDetail(result.stderr, result.stdout, result.detail));
		const detail = result.reason === 'timeout' ? `${said}; raise entirely.pluginTimeout if the command needs longer` : said;
		return { ok: false, cancelled: result.reason === 'cancelled', detail, text: `${stripTerminalCodes(result.stdout)}${stripTerminalCodes(result.stderr)}`.trim() };
	}

	async info(name: string, signal?: AbortSignal): Promise<InfoOutcome> {
		const done = await this.execute(pluginInfoArguments(name), { signal });
		if (done.ok) {
			return { kind: 'done', text: done.text };
		}
		return done.cancelled ? { kind: 'cancelled' } : { kind: 'failed', detail: done.detail };
	}

	async search(term: string, signal?: AbortSignal): Promise<SearchOutcome> {
		const done = await this.execute(pluginSearchArguments(term), { signal, redactOperands: true });
		if (!done.ok) {
			return done.cancelled ? { kind: 'cancelled' } : { kind: 'failed', detail: done.detail };
		}
		if (done.text.length === 0) {
			return { kind: 'empty' };
		}
		const rows = parseSearchResults(done.text);
		return rows.length > 0 ? { kind: 'found', rows, text: done.text } : { kind: 'unreadable', text: done.text };
	}

	async runCheck(signal?: AbortSignal): Promise<CheckOutcome> {
		const result = await this.options.runner.run(pluginDoctorArguments(), {
			cwd: this.cwd,
			timeoutMs: this.timeoutMs,
			env: staticEnvironment(),
			withholdBodies: true,
			signal,
		});
		if (result.ok) {
			return { kind: 'healthy', text: stripTerminalCodes(result.stdout).trim() };
		}
		if (result.reason === 'exit-code') {
			const text = `${stripTerminalCodes(result.stdout)}${stripTerminalCodes(result.stderr)}`.trim();
			return { kind: 'findings', text: text.length > 0 ? text : result.detail };
		}
		return { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
	}

	async updateIndex(acting: AccountContext, signal?: AbortSignal): Promise<IndexOutcome> {
		const done = await this.execute(pluginIndexUpdateArguments(), { acting, signal });
		if (done.ok) {
			return { kind: 'done', text: done.text };
		}
		return done.cancelled ? { kind: 'cancelled' } : { kind: 'failed', detail: done.detail };
	}

	async upgrade(
		target: { readonly kind: 'one'; readonly name: string } | { readonly kind: 'all' },
		before: readonly InstalledPlugin[],
		acting: AccountContext,
		signal?: AbortSignal,
	): Promise<UpgradeOutcome> {
		const check = await this.check('upgrade');
		if (!check.ok) {
			return { kind: 'failed', detail: check.detail, changes: [] };
		}
		let resolved: UpgradeTarget;
		if (target.kind === 'one') {
			resolved = target;
		} else {
			const picked = pickUpgradeFlags(check.raw);
			if (!picked.ok || !picked.flags.all) {
				return { kind: 'failed', detail: 'this version of the Entire CLI does not describe an upgrade-all flag; update the CLI', changes: [] };
			}
			resolved = { kind: 'all', flag: picked.flags.all };
		}
		const done = await this.execute(pluginUpgradeArguments(resolved), { acting, signal });
		if (!done.ok && done.cancelled) {
			return { kind: 'cancelled' };
		}
		const fresh = await this.listing();
		const changes = fresh.ok ? diffVersions(before, fresh.value.plugins) : [];
		if (!done.ok) {
			return { kind: 'failed', detail: done.detail, changes };
		}
		if (!fresh.ok) {
			return { kind: 'unconfirmed', changes: [], text: done.text, detail: `the list could not be read again: ${fresh.detail}` };
		}
		const relevant = target.kind === 'one' ? changes.filter(change => change.name === target.name) : changes;
		if (relevant.some(change => change.kind === 'changed')) {
			return { kind: 'done', changes, text: done.text };
		}
		if (relevant.length === 0 || relevant.some(change => change.kind !== 'unchanged')) {
			return { kind: 'unconfirmed', changes, text: done.text, detail: 'the fresh list does not show a version to compare' };
		}
		return { kind: 'unchanged', changes, text: done.text };
	}

	async remove(name: string, force: boolean, acting: AccountContext, signal?: AbortSignal): Promise<RemoveOutcome> {
		const check = await this.check('remove');
		if (!check.ok) {
			return { kind: 'failed', detail: check.detail, stillListed: undefined };
		}
		let forceFlag: string | undefined;
		if (force) {
			const picked = pickRemoveFlags(check.raw);
			forceFlag = picked.ok ? picked.flags.force : undefined;
			if (!forceFlag) {
				return { kind: 'failed', detail: 'this version of the Entire CLI does not describe a force flag for plugin remove; update the CLI', stillListed: undefined };
			}
		}
		const done = await this.execute(pluginRemoveArguments(name, forceFlag), { acting, signal });
		if (!done.ok && done.cancelled) {
			return { kind: 'cancelled' };
		}
		const fresh = await this.listing();
		const listed = fresh.ok ? fresh.value.plugins.some(plugin => plugin.name === name) : undefined;
		if (!done.ok) {
			if (!force && refusedForDependents(`${done.detail}\n${done.text}`)) {
				return { kind: 'refused-dependents', detail: done.detail };
			}
			return { kind: 'failed', detail: done.detail, stillListed: listed };
		}
		if (!fresh.ok) {
			return { kind: 'unconfirmed', detail: `the list could not be read again: ${fresh.detail}` };
		}
		return listed ? { kind: 'still-listed', text: done.text } : { kind: 'done', after: fresh.value.plugins };
	}
}

/** Runs the plugin check for the doctor report. A CLI without `plugin doctor` is reported as such, never as a failure. */
export async function readPluginCheck(source: PluginManagementSource): Promise<PluginCheckReading> {
	const check = await source.check('doctor');
	if (!check.ok) {
		return check.kind === 'no-cli' ? { kind: 'no-cli', detail: check.detail } : check.kind === 'missing' ? { kind: 'unsupported', detail: check.detail } : { kind: 'failed', detail: check.detail };
	}
	const outcome = await source.runCheck();
	return outcome.kind === 'healthy' ? { kind: 'healthy' } : outcome.kind === 'findings' ? { kind: 'problems' } : { kind: 'failed', detail: outcome.detail };
}
