import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	cleanArguments,
	cleanPreviewArguments,
	cleanCliText,
	configureArguments,
	decodeEntireSettings,
	decodeSessionList,
	decodeWorkspaceStatus,
	describeCannot,
	describeVerdicts,
	disableArguments,
	failureDetail,
	missingForStep,
	nameSession,
	isLive,
	parseAgentList,
	planCaptureFlags,
	runnerModeOf,
	runnerSetupArguments,
	sensitiveFlags,
	uninstallArguments,
	unwrap,
	verifyCleaned,
	verifyDisabled,
	verifySettings,
	verifyUninstalled,
	type AccountContext,
	type AgentEntry,
	type CaptureAction,
	type CaptureCommand,
	type CaptureFlags,
	type CaptureOutcome,
	type CaptureStep,
	type CleanScope,
	type EntireSettings,
	type HelpFlag,
	type Session,
	type SettingsLayerReading,
	type WorkspaceStatus,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { openRegularFile } from './openRegularFile';
import { scanHookConfig } from './hookConfigScan';
import { settingsLayers } from './settingsSource';

/** What the service needs to do its job. */
export interface CaptureControlOptions {
	readonly runner: CliRunner;
	/** How long, in seconds, a disable, uninstall, configure or clean (and a read) may take. */
	readonly timeoutSeconds: () => number;
	/** How long, in seconds, `runner setup` may take. */
	readonly runnerTimeoutSeconds: () => number;
	/** The user's home directory, where the lowest settings layer lives. */
	readonly homeDirectory?: () => string;
}

/** A command that can be used, with the flags its help describes. */
export interface CaptureReady {
	readonly ok: true;
	readonly flags: CaptureFlags;
	readonly help: string;
	readonly version: string;
	readonly table: readonly HelpFlag[];
}

/** Whether a command can be used here, and if not, why. */
export type CaptureCheck =
	| CaptureReady
	| { readonly ok: false; readonly reason: 'no-cli'; readonly detail: string }
	| { readonly ok: false; readonly reason: 'unsupported'; readonly detail: string }
	| { readonly ok: false; readonly reason: 'unavailable'; readonly detail: string }
	| { readonly ok: false; readonly reason: 'failed'; readonly detail: string };

/** What the workspace looks like right now. */
export interface CaptureReading {
	/** The workspace status. Undefined when it could not be read. */
	readonly status: WorkspaceStatus | undefined;
	/** The sessions the CLI lists. Undefined when they could not be read. */
	readonly sessions: readonly Session[] | undefined;
}

/** A runner definition file. */
export interface RunnerFile {
	/** The file name without its extension. */
	readonly name: string;
	readonly size: number;
}

/** What a clean's preview came to. */
export type CleanPreview =
	| { readonly kind: 'preview'; readonly text: string }
	| { readonly kind: 'empty' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

/** What one change came to, with the text the CLI printed when the caller may show it. */
export interface CaptureResult {
	readonly outcome: CaptureOutcome;
	/** The CLI's text for a runner preview or prompt. Held in memory by the caller; never logged. */
	readonly output?: string;
}

/** What `perform` is given. */
export interface PerformContext {
	readonly folder: string;
	/** The login the change was confirmed as. */
	readonly acting: AccountContext | undefined;
	readonly check: CaptureReady;
	/** The reading taken just before the confirmation. */
	readonly before: CaptureReading;
	readonly signal?: AbortSignal;
}

/** The longest preview kept, in characters. */
export const MAX_PREVIEW_CHARACTERS = 20_000;
const MAX_RUNNER_FILES = 200;
const MAX_SETTINGS_BYTES = 1024 * 1024;

const COMMAND_PURPOSE: Readonly<Record<CaptureCommand, string>> = {
	disable: 'turn capture off or remove Entire',
	configure: 'change Entire settings',
	clean: 'clean session data',
	'runner setup': 'set up trail runners',
};

/** The names of the live sessions in a scope, from a reading. */
export function liveSessionNames(reading: CaptureReading, scope: CleanScope | undefined): readonly string[] | undefined {
	if (reading.status === undefined && reading.sessions === undefined) {
		return undefined;
	}
	const live = new Map<string, string>();
	if (reading.status?.kind === 'tracked') {
		for (const session of reading.status.activeSessions) {
			live.set(session.sessionId, nameSession({ id: session.sessionId, agent: session.agent, branch: session.branch }));
		}
	}
	for (const session of reading.sessions ?? []) {
		if (isLive(session)) {
			live.set(session.id, nameSession(session));
		}
	}
	if (scope?.kind === 'session') {
		const only = live.get(scope.id);
		return only === undefined ? [] : [only];
	}
	return [...live.values()];
}

/**
 * Turns capture off, removes Entire, writes settings, cleans session data
 * and sets up runners.
 *
 * Every flag is picked from the CLI's own help for that call, never kept. A
 * change runs once, as the login that was confirmed, with no retry, and the
 * CLI's text stays out of the invocation record. The result is judged by a
 * fresh read, never by the exit status alone.
 */
export class CaptureControlService {
	constructor(private readonly options: CaptureControlOptions) {}

	private timeoutMs(): number {
		return this.options.timeoutSeconds() * 1000;
	}

	/** Whether a command exists on this CLI and which of its flags the help describes. */
	async check(command: CaptureCommand, folder: string): Promise<CaptureCheck> {
		const discovery = await this.options.runner.discover();
		if (discovery.state === 'absent') {
			return { ok: false, reason: 'no-cli', detail: 'The Entire CLI is not installed.' };
		}
		if (discovery.state === 'broken') {
			return { ok: false, reason: 'no-cli', detail: `The Entire CLI is not usable: ${discovery.detail}` };
		}

		const read = { cwd: folder, timeoutMs: this.timeoutMs(), withholdBodies: true } as const;
		// The runner group is not in `agent-help`, so its flags come from its own help.
		let usage = command === 'runner setup' ? await this.options.runner.help(command, read) : await this.options.runner.usage(command, read);
		if (!usage.ok && usage.reason === 'exit-code' && command !== 'runner setup') {
			usage = await this.options.runner.help(command, read);
		}
		if (!usage.ok) {
			// A help that exits non-zero is how this CLI says it has no such command.
			if (usage.reason === 'exit-code') {
				return { ok: false, reason: 'unsupported', detail: describeCannot(COMMAND_PURPOSE[command], command, discovery.version, []) };
			}
			return { ok: false, reason: 'failed', detail: `Could not read the help for 'entire ${command}': ${failureDetail(usage.stderr, '', usage.detail)}` };
		}

		const plan = planCaptureFlags(command, usage.value.raw);
		if (!plan.ok) {
			return { ok: false, reason: 'unavailable', detail: describeCannot(COMMAND_PURPOSE[command], command, discovery.version, plan.missing) };
		}
		return { ok: true, flags: plan.flags, help: usage.value.raw, version: discovery.version, table: plan.table };
	}

	/** Reads the status and the session list, as the CLI reports them now. */
	async read(folder: string): Promise<CaptureReading> {
		const options = { cwd: folder, timeoutMs: this.timeoutMs(), withholdBodies: true } as const;
		const [status, sessions] = await Promise.all([
			this.options.runner.runJson(['status', '--json'], value => unwrap(decodeWorkspaceStatus(value)), options),
			this.options.runner.runJson(['session', 'list', '--json'], value => unwrap(decodeSessionList(value)), options),
		]);
		return { status: status.ok ? status.value : undefined, sessions: sessions.ok ? sessions.value : undefined };
	}

	/** The agents the CLI lists, installed ones first. Empty when the list cannot be read. */
	async agents(folder: string): Promise<readonly AgentEntry[]> {
		const result = await this.options.runner.run(['agent', 'list'], { cwd: folder, timeoutMs: this.timeoutMs(), withholdBodies: true });
		if (!result.ok) {
			return [];
		}
		const listed = parseAgentList(result.stdout) ?? [];
		return [...listed].sort((a, b) => Number(b.installed) - Number(a.installed));
	}

	/** The files in the workspace that call `entire hooks`. */
	async hookFiles(folder: string): Promise<readonly string[]> {
		return (await scanHookConfig(folder)).map(file => file.file);
	}

	/** The files in `.entire/runners`, by name and size, read without following links. */
	async runnerFiles(folder: string): Promise<readonly RunnerFile[]> {
		const directory = path.join(folder, '.entire', 'runners');
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(directory, { withFileTypes: true });
		} catch {
			return [];
		}
		const files: RunnerFile[] = [];
		for (const entry of entries.slice(0, MAX_RUNNER_FILES)) {
			if (!entry.isFile() || !entry.name.endsWith('.json')) {
				continue;
			}
			try {
				const info = await fs.promises.lstat(path.join(directory, entry.name));
				files.push({ name: entry.name.slice(0, -'.json'.length), size: info.size });
			} catch {
				// A file that went away between the listing and the size is not listed.
			}
		}
		return files.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** The three layers of Entire's settings, highest priority first, as they are now. */
	async settingsLayers(folder: string): Promise<readonly SettingsLayerReading[]> {
		const home = this.options.homeDirectory?.() ?? os.homedir();
		const files = settingsLayers(folder, home);
		const readings: SettingsLayerReading[] = [];
		for (const [index, file] of files.entries()) {
			const shown = index < 2 ? path.relative(folder, file).split(path.sep).join('/') : file;
			const target = index === 0 ? 'local' : index === 1 ? 'project' : undefined;
			readings.push({ file: shown, target, settings: await readSettingsFile(file) });
		}
		return readings;
	}

	/** Asks the CLI what a clean would delete. Nothing is deleted and nothing is asked. */
	async previewClean(check: CaptureReady, folder: string, scope: CleanScope, acting: AccountContext | undefined, signal?: AbortSignal): Promise<CleanPreview> {
		const args = cleanPreviewArguments(check.flags, scope);
		if (args === undefined) {
			return { kind: 'failed', detail: 'this version of the Entire CLI does not describe a preview for this scope' };
		}
		const result = await this.options.runner.run(args, {
			cwd: folder,
			timeoutMs: this.timeoutMs(),
			context: acting?.name,
			withholdBodies: true,
			signal,
		});
		if (!result.ok) {
			return result.reason === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		const text = cleanCliText(result.stdout.trim().length > 0 ? result.stdout : result.stderr, MAX_PREVIEW_CHARACTERS);
		return text.length === 0 ? { kind: 'empty' } : { kind: 'preview', text };
	}

	/**
	 * Makes one change, once, as the confirmed login, and judges it by a
	 * fresh read. A step whose flags the help does not describe is not run.
	 */
	async perform(action: CaptureAction, context: PerformContext): Promise<CaptureResult> {
		const missing = missingForStep(action, context.check.flags);
		const args = missing.length === 0 ? this.argumentsFor(action, context.check.flags) : undefined;
		if (args === undefined) {
			const command: CaptureCommand = action.kind.startsWith('runner') ? 'runner setup' : action.kind === 'configure' ? 'configure' : action.kind === 'clean' ? 'clean' : 'disable';
			return { outcome: { kind: 'unsupported', detail: describeCannot(COMMAND_PURPOSE[command], command, context.check.version, missing) } };
		}

		const isRunner = action.kind.startsWith('runner');
		const filesBefore = isRunner ? await this.runnerFiles(context.folder) : [];
		const result = await this.options.runner.run(args, {
			cwd: context.folder,
			timeoutMs: (isRunner ? this.options.runnerTimeoutSeconds() : this.options.timeoutSeconds()) * 1000,
			context: context.acting?.name,
			withholdBodies: true,
			redactFlags: sensitiveFlags(context.check.flags),
			redactOperands: true,
			signal: context.signal,
		});

		if (!result.ok) {
			return this.afterFailure(action, context, result, filesBefore);
		}
		return this.afterSuccess(action, context, result.stdout, filesBefore);
	}

	private argumentsFor(action: CaptureAction, flags: CaptureFlags): readonly string[] | undefined {
		switch (action.kind) {
			case 'disable':
				return disableArguments(flags, action.target);
			case 'uninstall':
				return uninstallArguments(flags);
			case 'configure':
				return configureArguments(flags, action.changes, action.target);
			case 'clean':
				return cleanArguments(flags, action.scope);
			case 'runner-defaults':
			case 'runner-print-prompt':
			case 'runner-dry-run':
			case 'runner-tailor':
				return runnerSetupArguments(flags, runnerModeOf(action), action.options);
		}
	}

	private async afterFailure(
		action: CaptureAction,
		context: PerformContext,
		result: { readonly reason: string; readonly detail: string; readonly stdout: string; readonly stderr: string },
		filesBefore: readonly RunnerFile[],
	): Promise<CaptureResult> {
		if (result.reason === 'absent' || result.reason === 'broken') {
			return { outcome: { kind: 'no-cli', detail: result.detail } };
		}
		const partial = 'It was not run again. Some of it may already have happened, so the workspace was read again.';
		if (result.reason === 'cancelled') {
			return { outcome: { kind: 'failed', detail: `The command was cancelled. ${partial}`, lines: await this.remainder(action, context, filesBefore) } };
		}
		const said = result.reason === 'exit-code' ? failureDetail(result.stderr, result.stdout, result.detail) : result.detail;
		const detail = result.reason === 'timeout' ? `${said}; raise the timeout setting if it needs longer. ${partial}` : `${said}. ${partial}`;
		return { outcome: { kind: 'failed', detail, lines: await this.remainder(action, context, filesBefore) } };
	}

	/** What a fresh read says is left after a command that did not finish cleanly. */
	private async remainder(action: CaptureAction, context: PerformContext, filesBefore: readonly RunnerFile[]): Promise<readonly string[]> {
		switch (action.kind) {
			case 'uninstall': {
				const verdict = await this.uninstallVerdict(context.folder);
				return verdict.remaining.length > 0 ? verdict.remaining.map(line => `left: ${line}`) : ['Nothing was left behind that Entirely can see.'];
			}
			case 'runner-defaults':
			case 'runner-print-prompt':
			case 'runner-dry-run':
			case 'runner-tailor':
				return describeFileChanges(filesBefore, await this.runnerFiles(context.folder));
			default:
				return [];
		}
	}

	private async uninstallVerdict(folder: string): Promise<ReturnType<typeof verifyUninstalled>> {
		const reading = await this.read(folder);
		const entireDirectoryPresent = await directoryPresent(path.join(folder, '.entire'));
		return verifyUninstalled(reading.status, { entireDirectoryPresent, hookFilesLeft: await this.hookFiles(folder) });
	}

	private async afterSuccess(action: CaptureAction, context: PerformContext, stdout: string, filesBefore: readonly RunnerFile[]): Promise<CaptureResult> {
		const { folder } = context;
		switch (action.kind) {
			case 'disable': {
				const after = await this.read(folder);
				const verdict = verifyDisabled(context.before.status, after.status);
				switch (verdict.kind) {
					case 'verified':
					case 'unchanged':
						return { outcome: { kind: 'done', summary: `Capture is off in ${folder}. A fresh status reports Entire as disabled.`, lines: [] } };
					case 'still-enabled':
						return {
							outcome: {
								kind: 'unconfirmed',
								detail:
									'The CLI finished but status still reports Entire as enabled. Another settings layer may override this one; run Doctor: Copy a Diagnostic Report.',
								lines: [],
							},
						};
					case 'unreadable':
						return { outcome: { kind: 'unconfirmed', detail: 'The CLI finished but the workspace status could not be read afterwards, so Entirely cannot say capture is off.', lines: [] } };
				}
				break;
			}

			case 'uninstall': {
				const verdict = await this.uninstallVerdict(folder);
				return verdict.complete
					? { outcome: { kind: 'done', summary: `Entire is removed from ${folder}. A fresh read finds status disabled, no .entire directory and no hook files that call the CLI.`, lines: [] } }
					: { outcome: { kind: 'unconfirmed', detail: 'The CLI finished but a fresh read finds Entire not fully removed.', lines: verdict.remaining.map(line => `left: ${line}`) } };
			}

			case 'clean': {
				const after = await this.read(folder);
				const verdict = verifyCleaned(context.before.sessions?.map(session => session.id), after.sessions?.map(session => session.id), action.scope);
				const lines = [
					verdict.gone.length > 0 ? `sessions no longer listed: ${verdict.gone.join(', ')}` : 'no listed session went away',
					...(verdict.remaining.length > 0 ? [`still listed: ${verdict.remaining.join(', ')}`] : []),
					"The preview is the CLI's own text and the session lists are Entirely's reading of `session list`; they are worded differently.",
				];
				return verdict.kind === 'done'
					? { outcome: { kind: 'done', summary: `Session data was cleaned in ${folder}. A fresh session list no longer shows ${verdict.gone.join(', ')}.`, lines } }
					: { outcome: { kind: 'unconfirmed', detail: `The CLI finished but ${verdict.detail}.`, lines } };
			}

			case 'configure': {
				const layers = await this.settingsLayers(folder);
				const verdicts = verifySettings(action.changes, layers, action.target);
				const lines = describeVerdicts(verdicts);
				if (verdicts.some(verdict => verdict.status === 'mismatch')) {
					return { outcome: { kind: 'unconfirmed', detail: 'The CLI finished but the settings files do not show what was chosen.', lines } };
				}
				const readable = verdicts.filter(verdict => verdict.status === 'verified').length;
				const summary =
					readable === verdicts.length
						? 'Settings were written and read back from the settings files.'
						: readable > 0
							? 'Settings were written. Those the editor can read were checked against the settings files.'
							: 'Settings were written. The editor cannot read these settings back, so none could be verified.';
				return { outcome: { kind: 'done', summary, lines } };
			}

			case 'runner-defaults':
			case 'runner-print-prompt':
			case 'runner-dry-run':
			case 'runner-tailor': {
				const filesAfter = await this.runnerFiles(folder);
				const changes = describeFileChanges(filesBefore, filesAfter);
				const changed = changes.length > 0;
				const output = cleanCliText(stdout, MAX_PREVIEW_CHARACTERS);
				if (action.kind === 'runner-dry-run') {
					return changed
						? { outcome: { kind: 'unconfirmed', detail: 'The preview was meant to write nothing, but the runner files changed.', lines: changes }, output }
						: { outcome: { kind: 'done', summary: 'The tailoring preview is open. No runner file changed.', lines: [`${filesAfter.length} runner files, unchanged`] }, output };
				}
				if (!changed && (action.kind === 'runner-tailor' || filesAfter.length === 0)) {
					return {
						outcome: {
							kind: 'unconfirmed',
							detail: filesAfter.length === 0 ? 'The CLI finished but no runner file exists under .entire/runners.' : 'The CLI finished but no runner file changed.',
							lines: [],
						},
						output,
					};
				}
				const lines = changed ? changes : [`${filesAfter.length} default runner files already exist; nothing was created`];
				return { outcome: { kind: 'done', summary: action.kind === 'runner-tailor' ? 'The runners were tailored. Review the change with git diff .entire/runners.' : 'The runner files are in place.', lines }, output };
			}
		}
		return { outcome: { kind: 'unconfirmed', detail: 'The result could not be checked.', lines: [] } };
	}
}

/** The difference between two listings of the runner files, one line each. */
export function describeFileChanges(before: readonly RunnerFile[], after: readonly RunnerFile[]): readonly string[] {
	const lines: string[] = [];
	for (const file of after) {
		const was = before.find(other => other.name === file.name);
		if (!was) {
			lines.push(`created ${file.name} (${file.size} bytes)`);
		} else if (was.size !== file.size) {
			lines.push(`changed ${file.name} (${was.size} -> ${file.size} bytes)`);
		}
	}
	for (const file of before) {
		if (!after.some(other => other.name === file.name)) {
			lines.push(`removed ${file.name}`);
		}
	}
	return lines;
}

async function directoryPresent(directory: string): Promise<boolean | undefined> {
	try {
		await fs.promises.lstat(directory);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : undefined;
	}
}

/** Reads one settings file through a single handle that refuses links. */
async function readSettingsFile(file: string): Promise<EntireSettings | undefined> {
	const opened = await openRegularFile(file);
	if (opened.kind !== 'ok') {
		return undefined;
	}
	try {
		if (opened.info.size > MAX_SETTINGS_BYTES) {
			return undefined;
		}
		const text = await opened.handle.readFile({ encoding: 'utf8' });
		const decoded = decodeEntireSettings(JSON.parse(text) as unknown);
		return decoded.ok ? decoded.value : undefined;
	} catch {
		return undefined;
	} finally {
		await opened.handle.close().catch(() => undefined);
	}
}
