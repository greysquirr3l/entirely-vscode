import * as path from 'path';

import {
	NOT_A_REPOSITORY,
	SETTINGS_FILES,
	captureConfirmationFor,
	currentSettingValues,
	effectiveValue,
	describeCaptureOutcome,
	describeCannot,
	isCheckpointRemote,
	isCleanSessionId,
	isImportedSession,
	isRunnerName,
	missingForStep,
	nameSession,
	parseCleanScopes,
	parseUninstallList,
	readBackendChoices,
	readRemoteProviders,
	readSourceChoices,
	type AccountContext,
	type CaptureAction,
	type CaptureConfirmation,
	type CaptureFlags,
	type CaptureOutcome,
	type CleanScope,
	type ConfigureChange,
	type ConfigureKey,
	type ConfirmationFacts,
	type RunnerOptions,
	type SettingsTarget,
} from '../lib/entire';
import { liveSessionNames, type CaptureCheck, type CaptureControlService, type CaptureReading, type CaptureReady } from '../services/captureControl';

/** One entry of a list the person picks from. */
export interface CaptureChoice<T extends string> {
	readonly id: T;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
	/** Whether a multi-select starts with it ticked. */
	readonly picked?: boolean;
}

/** The questions the capture-control flows ask, so they can be run without an editor. */
export interface CaptureUi {
	/** Which of several workspace folders is meant. */
	chooseFolder(folders: readonly string[]): Promise<string | undefined>;
	choose<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<T | undefined>;
	pickMany<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<readonly T[] | undefined>;
	ask(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly validate: (value: string) => string | undefined;
	}): Promise<string | undefined>;
	/** A modal. True only when the person pressed the confirming button. */
	confirm(prompt: CaptureConfirmation): Promise<boolean>;
	/** Asks for text to be typed back. Resolves to what was typed, or undefined when dismissed. */
	typeToConfirm(expected: string): Promise<string | undefined>;
	/** Opens text in a read-only editor. The text is held in memory only. */
	showText(title: string, text: string): Promise<void>;
	/** Shows a message. Resolves to the action chosen once it is answered or dismissed. */
	notify(level: 'info' | 'warn', message: string, actions?: readonly string[]): Promise<string | undefined>;
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	openFile(file: string): Promise<void>;
	openUrl(url: string): Promise<void>;
}

/** What the flows need. */
export interface CaptureDependencies {
	readonly service: CaptureControlService;
	readonly ui: CaptureUi;
	/** The workspace folders, as paths. */
	readonly folders: () => readonly string[];
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	/** Re-reads what the views show. Each is called after the verifying read. */
	readonly refresh: {
		readonly status: () => Promise<void>;
		readonly account: () => Promise<void>;
		readonly sessions: () => Promise<void>;
	};
	/** The status bar's own set-up flow. */
	readonly setUpAgain: () => Promise<void>;
	/** Forgets what was learned about the installed agents. */
	readonly invalidateAgents: () => void;
	/** Shown when the CLI is missing. */
	readonly installCommand: string;
	readonly installDocs: string;
	readonly running?: { active: boolean };
}

const sharedRunning = { active: false };

const SET_UP_AGAIN = 'Set Up Again';
const OPEN_INSTALL = 'Open Install Instructions';

type Later = (step: () => Promise<unknown>) => void;

/**
 * Runs a flow unless one is already running, then the steps it deferred.
 *
 * A message with buttons settles only when it is answered or dismissed, so
 * a flow that waited for it would refuse every other capture command until
 * the person clicked it away.
 */
async function whileIdle(deps: CaptureDependencies, work: (later: Later) => Promise<CaptureOutcome>): Promise<CaptureOutcome> {
	const flag = deps.running ?? sharedRunning;
	if (flag.active) {
		void deps.ui.notify('warn', 'Another capture command is still running. Wait for it to finish, or cancel it.');
		return { kind: 'unchanged', detail: 'Another capture command is still running.' };
	}
	flag.active = true;
	const steps: (() => Promise<unknown>)[] = [];
	let outcome: CaptureOutcome;
	try {
		outcome = await work(step => void steps.push(step));
	} finally {
		flag.active = false;
	}
	for (const step of steps) {
		await step();
	}
	return outcome;
}

/** What a flow starts from once the CLI and the folder are settled. */
interface Started {
	readonly folder: string;
	readonly check: CaptureReady;
	readonly before: CaptureReading;
	readonly acting: AccountContext | undefined;
}

async function chooseFolder(deps: CaptureDependencies): Promise<string | undefined> {
	const folders = deps.folders();
	if (folders.length === 0) {
		void deps.ui.notify('warn', 'Open a folder first. Entire works on a git repository in a workspace folder.');
		return undefined;
	}
	return folders.length === 1 ? folders[0] : deps.ui.chooseFolder(folders);
}

function reportCheck(deps: CaptureDependencies, later: Later, check: Exclude<CaptureCheck, { ok: true }>): CaptureOutcome {
	switch (check.reason) {
		case 'no-cli':
			later(async () => {
				const picked = await deps.ui.notify('warn', `${check.detail} Install it with: ${deps.installCommand}`, [OPEN_INSTALL]);
				if (picked === OPEN_INSTALL) {
					await deps.ui.openUrl(deps.installDocs);
				}
			});
			return { kind: 'no-cli', detail: check.detail };
		case 'unsupported':
		case 'unavailable':
			void deps.ui.notify('warn', check.detail);
			return { kind: 'unsupported', detail: check.detail };
		case 'failed':
			void deps.ui.notify('warn', check.detail);
			return { kind: 'failed', detail: check.detail, lines: [] };
	}
}

/**
 * Settles the folder and the command, and takes the reading the question is
 * built from. Nothing here changes anything.
 */
async function start(
	deps: CaptureDependencies,
	later: Later,
	command: 'disable' | 'configure' | 'clean' | 'runner setup',
): Promise<Started | CaptureOutcome> {
	const folder = await chooseFolder(deps);
	if (folder === undefined) {
		return { kind: 'cancelled' };
	}
	const check = await deps.service.check(command, folder);
	if (!check.ok) {
		return reportCheck(deps, later, check);
	}
	const before = await deps.service.read(folder);
	if (before.status?.kind === 'not-a-repository') {
		void deps.ui.notify('warn', NOT_A_REPOSITORY);
		return { kind: 'unsupported', detail: NOT_A_REPOSITORY };
	}
	return { folder, check, before, acting: await deps.acting() };
}

function isStarted(value: Started | CaptureOutcome): value is Started {
	return 'folder' in value;
}

/** The modal, then the typed name when the question needs one. True only when both were given. */
async function confirmed(deps: CaptureDependencies, prompt: CaptureConfirmation): Promise<boolean> {
	if (!(await deps.ui.confirm(prompt))) {
		return false;
	}
	if (prompt.requireTyped === undefined) {
		return true;
	}
	return (await deps.ui.typeToConfirm(prompt.requireTyped))?.trim() === prompt.requireTyped;
}

/** Re-reads the views from the state the verifying read left. Called after the change, never before. */
async function refreshViews(deps: CaptureDependencies): Promise<void> {
	await deps.refresh.status();
	await deps.refresh.account();
	await deps.refresh.sessions();
}

function declined(deps: CaptureDependencies): CaptureOutcome {
	void deps.ui.notify('info', describeCaptureOutcome({ kind: 'cancelled' }));
	return { kind: 'cancelled' };
}

/** Says how a change ended, with the actions that make sense for it. */
function announce(deps: CaptureDependencies, later: Later, outcome: CaptureOutcome, actions: readonly string[], onAction: (picked: string) => Promise<void>): void {
	const level = outcome.kind === 'done' ? 'info' : 'warn';
	later(async () => {
		const picked = await deps.ui.notify(level, describeCaptureOutcome(outcome), outcome.kind === 'no-cli' || outcome.kind === 'unsupported' ? [] : actions);
		if (picked !== undefined) {
			await onAction(picked);
		}
	});
}

async function targetFor(deps: CaptureDependencies, flags: CaptureFlags, title: string): Promise<SettingsTarget | undefined | 'none'> {
	const offered: CaptureChoice<SettingsTarget>[] = [];
	if (flags.local !== undefined) {
		offered.push({ id: 'local', label: 'This checkout only', description: SETTINGS_FILES.local });
	}
	if (flags.project !== undefined) {
		offered.push({ id: 'project', label: 'Shared with the team', description: `${SETTINGS_FILES.project}, usually committed` });
	}
	if (offered.length === 0) {
		return 'none';
	}
	return offered.length === 1 ? offered[0].id : deps.ui.choose(title, offered);
}

function noTarget(deps: CaptureDependencies, command: 'disable' | 'configure', version: string): CaptureOutcome {
	const detail = describeCannot(command === 'disable' ? 'turn capture off' : 'change settings', command, version, [
		'flag that writes this checkout only',
		'flag that writes the shared settings file',
	]);
	void deps.ui.notify('warn', detail);
	return { kind: 'unsupported', detail };
}

function stepMissing(deps: CaptureDependencies, started: Started, action: CaptureAction, command: 'disable' | 'configure' | 'clean' | 'runner setup'): CaptureOutcome | undefined {
	const missing = missingForStep(action, started.check.flags);
	if (missing.length === 0) {
		return undefined;
	}
	const purpose = command === 'clean' ? 'clean session data' : command === 'runner setup' ? 'set up trail runners' : command === 'configure' ? 'change those settings' : 'do that';
	const detail = describeCannot(purpose, command, started.check.version, missing);
	void deps.ui.notify('warn', detail);
	return { kind: 'unsupported', detail };
}

/**
 * Turns Entire off in the repository, leaving everything installed.
 *
 * The person picks the settings file and confirms a question that names the
 * folder, the file, the live sessions and the login. The CLI runs once, and
 * a fresh status decides whether the result is called done.
 */
export function disableCapture(deps: CaptureDependencies): Promise<CaptureOutcome> {
	return whileIdle(deps, async later => {
		const started = await start(deps, later, 'disable');
		if (!isStarted(started)) {
			return started;
		}
		if (started.before.status !== undefined && started.before.status.kind !== 'tracked') {
			const detail = `Entire already reports itself as off in ${started.folder}. Nothing was changed.`;
			void deps.ui.notify('info', detail);
			return { kind: 'unchanged', detail };
		}

		const target = await targetFor(deps, started.check.flags, 'Turn Entire off for which settings file?');
		if (target === 'none') {
			return noTarget(deps, 'disable', started.check.version);
		}
		if (target === undefined) {
			return { kind: 'cancelled' };
		}
		const action: CaptureAction = { kind: 'disable', target };
		const blocked = stepMissing(deps, started, action, 'disable');
		if (blocked) {
			return blocked;
		}

		const prompt = captureConfirmationFor(action, {
			folder: started.folder,
			acting: started.acting,
			liveSessions: liveSessionNames(started.before, undefined),
			settingsFile: SETTINGS_FILES[target],
		});
		if (!(await confirmed(deps, prompt))) {
			return declined(deps);
		}

		const { outcome } = await deps.ui.withProgress('Turning Entire off…', signal =>
			deps.service.perform(action, { folder: started.folder, acting: started.acting, check: started.check, before: started.before, signal }),
		);
		await refreshViews(deps);
		announce(deps, later, outcome, outcome.kind === 'done' ? [SET_UP_AGAIN, `Open ${SETTINGS_FILES[target]}`] : [], async picked => {
			if (picked === SET_UP_AGAIN) {
				await deps.setUpAgain();
			} else if (picked.startsWith('Open ')) {
				await deps.ui.openFile(path.join(started.folder, SETTINGS_FILES[target]));
			}
		});
		return outcome;
	});
}

/**
 * Removes Entire from the repository completely.
 *
 * The CLI offers no preview, so the question says so, lists what the CLI's
 * help says is removed and the hook files found here, and needs the
 * folder's name typed. The skip-confirmation flag is passed only after that.
 */
export function uninstallEntire(deps: CaptureDependencies): Promise<CaptureOutcome> {
	return whileIdle(deps, async later => {
		const started = await start(deps, later, 'disable');
		if (!isStarted(started)) {
			return started;
		}
		const action: CaptureAction = { kind: 'uninstall' };
		const blocked = stepMissing(deps, started, action, 'disable');
		if (blocked) {
			return blocked;
		}

		const prompt = captureConfirmationFor(action, {
			folder: started.folder,
			acting: started.acting,
			liveSessions: liveSessionNames(started.before, undefined),
			uninstallList: parseUninstallList(started.check.help),
			hookFiles: await deps.service.hookFiles(started.folder),
		});
		if (!(await confirmed(deps, prompt))) {
			return declined(deps);
		}

		const { outcome } = await deps.ui.withProgress('Removing Entire…', signal =>
			deps.service.perform(action, { folder: started.folder, acting: started.acting, check: started.check, before: started.before, signal }),
		);
		deps.invalidateAgents();
		await refreshViews(deps);
		announce(deps, later, outcome, outcome.kind === 'done' ? [SET_UP_AGAIN] : [], async picked => {
			if (picked === SET_UP_AGAIN) {
				await deps.setUpAgain();
			}
		});
		return outcome;
	});
}

const SCOPE_ITEMS: readonly CaptureChoice<'head' | 'all' | 'session'>[] = [
	{ id: 'head', label: 'This HEAD', description: 'the default: session state for the current commit' },
	{ id: 'all', label: 'All session data', description: 'every session in this repository; needs the folder name typed' },
	{ id: 'session', label: 'One session…', description: 'choose a session' },
];

async function chooseScope(deps: CaptureDependencies, before: CaptureReading, given: string | undefined): Promise<CleanScope | undefined> {
	if (given !== undefined) {
		return { kind: 'session', id: given };
	}
	const kind = await deps.ui.choose('Clean which session data?', SCOPE_ITEMS);
	if (kind === undefined) {
		return undefined;
	}
	if (kind !== 'session') {
		return { kind };
	}
	const candidates = (before.sessions ?? []).filter(session => !isImportedSession(session));
	if (candidates.length === 0) {
		void deps.ui.notify('info', 'The CLI lists no session that has state to clean.');
		return undefined;
	}
	const id = await deps.ui.choose(
		'Clean which session?',
		candidates.map(session => ({ id: session.id, label: nameSession(session), description: session.status })),
	);
	return id === undefined ? undefined : { kind: 'session', id };
}

/** The first line of the CLI's preview, shortened, with how long the preview is. */
function summarisePreview(text: string): string {
	const lines = text.split('\n').filter(line => line.trim().length > 0);
	const first = (lines[0] ?? '').trim();
	const shown = first.length > 120 ? `${first.slice(0, 119)}…` : first;
	return lines.length > 1 ? `${shown} (${lines.length} lines)` : shown;
}

/**
 * Cleans session data, after showing what the CLI says it would delete.
 *
 * The preview is the CLI's own dry run and deletes nothing. The question
 * names live sessions in the scope and has a "Delete anyway" button when
 * there are any, because the skip-confirmation flag also overrides the
 * CLI's own live-session guard.
 */
export function cleanSessionData(deps: CaptureDependencies, sessionId?: string): Promise<CaptureOutcome> {
	return whileIdle(deps, async later => {
		if (sessionId !== undefined && !isCleanSessionId(sessionId)) {
			const detail = 'That session id is not one the CLI can be given.';
			void deps.ui.notify('warn', detail);
			return { kind: 'unsupported', detail };
		}
		const started = await start(deps, later, 'clean');
		if (!isStarted(started)) {
			return started;
		}
		const scope = await chooseScope(deps, started.before, sessionId);
		if (scope === undefined) {
			return { kind: 'cancelled' };
		}
		const action: CaptureAction = { kind: 'clean', scope };
		const blocked = stepMissing(deps, started, action, 'clean');
		if (blocked) {
			return blocked;
		}

		let previewSummary: string | undefined;
		const hasPreview = started.check.flags.dryRun !== undefined;
		if (hasPreview) {
			const preview = await deps.ui.withProgress('Asking the CLI what a clean would delete…', signal =>
				deps.service.previewClean(started.check, started.folder, scope, started.acting, signal),
			);
			switch (preview.kind) {
				case 'cancelled':
					return declined(deps);
				case 'failed': {
					const detail = `The preview failed, so nothing was cleaned: ${preview.detail}`;
					void deps.ui.notify('warn', detail);
					return { kind: 'failed', detail, lines: [] };
				}
				case 'empty': {
					const detail = "The CLI's preview printed nothing, so there is nothing to clean. Nothing was changed.";
					void deps.ui.notify('info', detail);
					return { kind: 'unchanged', detail };
				}
				case 'preview':
					await deps.ui.showText('Clean preview', preview.text);
					previewSummary = summarisePreview(preview.text);
			}
		}

		// The live sessions are read again here, after the preview and just before the question.
		const fresh = await deps.service.read(started.folder);
		const lists = parseCleanScopes(started.check.help);
		const facts: ConfirmationFacts = {
			folder: started.folder,
			acting: started.acting,
			liveSessions: liveSessionNames(fresh, scope),
			cleanList: scope.kind === 'all' ? lists.all : scope.kind === 'head' ? lists.head : [],
			hasPreview,
			previewSummary,
		};
		if (!(await confirmed(deps, captureConfirmationFor(action, facts)))) {
			return declined(deps);
		}

		const { outcome } = await deps.ui.withProgress('Cleaning session data…', signal =>
			deps.service.perform(action, { folder: started.folder, acting: started.acting, check: started.check, before: fresh, signal }),
		);
		await refreshViews(deps);
		announce(deps, later, outcome, [], async () => undefined);
		return outcome;
	});
}

interface SettingItem {
	readonly key: ConfigureKey;
	readonly label: string;
}

const SETTING_ITEMS: readonly SettingItem[] = [
	{ key: 'telemetry', label: 'Telemetry' },
	{ key: 'absoluteHookPath', label: 'Absolute git hook path' },
	{ key: 'skipPushSessions', label: 'Skip pushing session logs' },
	{ key: 'checkpointBackend', label: 'Checkpoint backend' },
	{ key: 'checkpointRemote', label: 'Checkpoint remote' },
	{ key: 'summaryProvider', label: 'Summary provider' },
	{ key: 'summaryModel', label: 'Summary model' },
	{ key: 'summaryTimeout', label: 'Summary timeout' },
	{ key: 'reinstallHook', label: 'Reinstall the git hook' },
];

/** The reason a typed timeout is not acceptable, or undefined. */
export function validateSummaryTimeout(value: string): string | undefined {
	return /^\d{1,6}$/.test(value.trim()) ? undefined : 'Enter a whole number of seconds, 0 or more. 0 clears the deadline.';
}

/** The reason a typed model hint is not acceptable, or undefined. */
export function validateSummaryModel(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 200 && !trimmed.startsWith('-') && !/[\u0000-\u001f]/.test(trimmed)
		? undefined
		: 'Enter a model hint on one line, up to 200 characters, not starting with a dash.';
}

async function askValue(
	deps: CaptureDependencies,
	started: Started,
	key: ConfigureKey,
	agents: readonly string[],
): Promise<ConfigureChange | undefined | 'cannot'> {
	const { ui } = deps;
	const flag = (role: ConfigureKey): string | undefined => started.check.flags[role];
	const descriptionOf = (role: ConfigureKey): string => started.check.table.find(row => row.name === flag(role))?.description ?? '';
	switch (key) {
		case 'telemetry':
		case 'absoluteHookPath':
		case 'skipPushSessions': {
			const label = SETTING_ITEMS.find(item => item.key === key)?.label ?? key;
			const picked = await ui.choose(`${label}: on or off?`, [
				{ id: 'true', label: 'On' },
				{ id: 'false', label: 'Off' },
			]);
			return picked === undefined ? undefined : { key, value: picked === 'true' };
		}
		case 'checkpointBackend': {
			const choices = readBackendChoices(descriptionOf(key));
			if (choices.length === 0) {
				void ui.notify('warn', "The CLI's help does not list the checkpoint backends it accepts, so Entirely will not guess one.");
				return 'cannot';
			}
			const picked = await ui.choose(
				'Checkpoint backend',
				choices.map(id => ({ id, label: id, detail: descriptionOf(key) })),
			);
			return picked === undefined ? undefined : { key, value: picked };
		}
		case 'checkpointRemote': {
			const providers = readRemoteProviders(descriptionOf(key));
			const typed = await ui.ask({
				title: 'Checkpoint remote',
				prompt: `Enter provider:owner/repo${providers.length > 0 ? `, with a provider from: ${providers.join(', ')}` : ''}`,
				validate: value => (isCheckpointRemote(value.trim(), providers) ? undefined : 'Use the form provider:owner/repo.'),
			});
			return typed === undefined ? undefined : { key, value: typed.trim() };
		}
		case 'summaryProvider': {
			if (agents.length > 0) {
				const picked = await ui.choose(
					'Summary provider',
					agents.map(id => ({ id, label: id })),
				);
				return picked === undefined ? undefined : { key, value: picked };
			}
			const typed = await ui.ask({
				title: 'Summary provider',
				prompt: 'The CLI lists no agents. Enter the name of the agent to use.',
				validate: value => (isRunnerName(value.trim()) ? undefined : 'Enter an agent name.'),
			});
			return typed === undefined ? undefined : { key, value: typed.trim() };
		}
		case 'summaryModel': {
			const typed = await ui.ask({ title: 'Summary model', prompt: 'Enter the model hint, exactly as the provider expects it.', validate: validateSummaryModel });
			return typed === undefined ? undefined : { key, value: typed.trim() };
		}
		case 'summaryTimeout': {
			const typed = await ui.ask({ title: 'Summary timeout', prompt: 'Seconds before summary generation is stopped. 0 clears the deadline.', validate: validateSummaryTimeout });
			return typed === undefined ? undefined : { key, value: Number.parseInt(typed.trim(), 10) };
		}
		case 'reinstallHook':
			return { key };
	}
}

/**
 * Edits the repository's Entire settings.
 *
 * Only the settings the person ticks are passed, with the settings file
 * they chose. The result is read back from the files: a setting the editor
 * can read is verified, one it cannot is said to be written, and a value
 * that is not there, or is overridden, makes the result unconfirmed.
 */
export function configureEntire(deps: CaptureDependencies): Promise<CaptureOutcome> {
	return whileIdle(deps, async later => {
		const started = await start(deps, later, 'configure');
		if (!isStarted(started)) {
			return started;
		}
		const layers = await deps.service.settingsLayers(started.folder);
		const current = currentSettingValues(layers);
		const flags = started.check.flags;

		const offered = SETTING_ITEMS.filter(item => flags[item.key] !== undefined);
		if (offered.length === 0) {
			const detail = describeCannot('change settings', 'configure', started.check.version, ['setting flags']);
			void deps.ui.notify('warn', detail);
			return { kind: 'unsupported', detail };
		}
		const ticked = await deps.ui.pickMany(
			'Which Entire settings do you want to change?',
			offered.map(item => {
				const now = effectiveValue(layers, item.key);
				return {
					id: item.key,
					label: item.label,
					description: now ? `now: ${now.value} (${now.file})` : undefined,
					detail: started.check.table.find(row => row.name === flags[item.key])?.description,
				};
			}),
		);
		if (ticked === undefined || ticked.length === 0) {
			return { kind: 'cancelled' };
		}

		const agents = ticked.includes('summaryProvider') ? (await deps.service.agents(started.folder)).map(agent => agent.name) : [];
		const changes: ConfigureChange[] = [];
		for (const key of ticked) {
			const change = await askValue(deps, started, key, agents);
			if (change === undefined) {
				return { kind: 'cancelled' };
			}
			if (change === 'cannot') {
				return { kind: 'unsupported', detail: 'A value could not be offered.' };
			}
			changes.push(change);
		}

		const target = await targetFor(deps, flags, 'Write the settings to which file?');
		if (target === 'none') {
			return noTarget(deps, 'configure', started.check.version);
		}
		if (target === undefined) {
			return { kind: 'cancelled' };
		}
		const action: CaptureAction = { kind: 'configure', changes, target };
		const blocked = stepMissing(deps, started, action, 'configure');
		if (blocked) {
			return blocked;
		}

		const prompt = captureConfirmationFor(action, {
			folder: started.folder,
			acting: started.acting,
			settingsFile: SETTINGS_FILES[target],
			currentValues: current,
		});
		if (!(await confirmed(deps, prompt))) {
			return declined(deps);
		}

		const { outcome } = await deps.ui.withProgress('Writing Entire settings…', signal =>
			deps.service.perform(action, { folder: started.folder, acting: started.acting, check: started.check, before: started.before, signal }),
		);
		await refreshViews(deps);
		const open = `Open ${SETTINGS_FILES[target]}`;
		announce(deps, later, outcome, outcome.kind === 'no-cli' ? [] : [open], async picked => {
			if (picked === open) {
				await deps.ui.openFile(path.join(started.folder, SETTINGS_FILES[target]));
			}
		});
		return outcome;
	});
}

type RunnerChoice = 'defaults' | 'print-prompt' | 'dry-run' | 'tailor';

function runnerAction(mode: RunnerChoice, options: RunnerOptions): CaptureAction {
	switch (mode) {
		case 'defaults':
			return { kind: 'runner-defaults', options };
		case 'print-prompt':
			return { kind: 'runner-print-prompt', options };
		case 'dry-run':
			return { kind: 'runner-dry-run', options };
		case 'tailor':
			return { kind: 'runner-tailor', options };
	}
}

/**
 * Creates the trail runners, or tailors them to the repository.
 *
 * Creating the defaults calls no provider. Printing the prompt calls none
 * either, but writes the default files if they are missing. A preview and a
 * tailoring send signals about the repository to the summary provider, so
 * each is a separate question that says so.
 */
export function setUpRunners(deps: CaptureDependencies): Promise<CaptureOutcome> {
	return whileIdle(deps, async later => {
		const started = await start(deps, later, 'runner setup');
		if (!isStarted(started)) {
			return started;
		}
		const flags = started.check.flags;
		const offered: CaptureChoice<RunnerChoice>[] = [];
		if (flags.defaultsOnly !== undefined) {
			offered.push({ id: 'defaults', label: 'Create default runners', description: 'generic runners; no summary provider is called' });
		}
		if (flags.printPrompt !== undefined) {
			offered.push({ id: 'print-prompt', label: 'Show the tailoring prompt', description: 'for your own agent; creates the default files if they are missing' });
		}
		if (flags.dryRun !== undefined) {
			offered.push({ id: 'dry-run', label: 'Preview tailoring', description: 'sends repository signals to the summary provider; writes nothing' });
		}
		if (flags.yes !== undefined) {
			offered.push({ id: 'tailor', label: 'Tailor runners to this repository', description: 'sends repository signals to the summary provider; rewrites .entire/runners' });
		}
		if (offered.length === 0) {
			const detail = describeCannot('set up trail runners', 'runner setup', started.check.version, ['forms of the setup']);
			void deps.ui.notify('warn', detail);
			return { kind: 'unsupported', detail };
		}
		const mode = await deps.ui.choose('Set up trail runners', offered);
		if (mode === undefined) {
			return { kind: 'cancelled' };
		}

		const options = await chooseRunnerOptions(deps, started, mode);
		if (options === undefined) {
			return { kind: 'cancelled' };
		}
		const action = runnerAction(mode, options);
		const blocked = stepMissing(deps, started, action, 'runner setup');
		if (blocked) {
			return blocked;
		}

		const prompt = captureConfirmationFor(action, {
			folder: started.folder,
			acting: started.acting,
			agent: options.agent,
			sources: options.sources,
		});
		if (!(await confirmed(deps, prompt))) {
			return declined(deps);
		}

		const performed = await deps.ui.withProgress('Running runner setup…', signal =>
			deps.service.perform(action, { folder: started.folder, acting: started.acting, check: started.check, before: started.before, signal }),
		);
		const { output } = performed;
		// With no summary provider configured the CLI cannot choose one without a terminal. It is not run again.
		const outcome: CaptureOutcome =
			performed.outcome.kind === 'failed' && (mode === 'dry-run' || mode === 'tailor') && options.agent === undefined
				? { ...performed.outcome, lines: [...performed.outcome.lines, 'If no summary provider is configured, start again and pick an agent for this run.'] }
				: performed.outcome;
		await refreshViews(deps);
		if (output !== undefined && output.length > 0 && (mode === 'dry-run' || mode === 'print-prompt')) {
			await deps.ui.showText(mode === 'dry-run' ? 'Runner tailoring preview' : 'Runner tailoring prompt', output);
		}
		announce(deps, later, outcome, [], async () => undefined);
		return outcome;
	});
}

async function chooseRunnerOptions(deps: CaptureDependencies, started: Started, mode: RunnerChoice): Promise<RunnerOptions | undefined> {
	if (mode === 'defaults') {
		return {};
	}
	let runner: string | undefined;
	const files = await deps.service.runnerFiles(started.folder);
	if (files.length > 0) {
		const picked = await deps.ui.choose<string>('Tune which runner?', [
			{ id: '', label: 'All runners', description: 'the default' },
			...files.map(file => ({ id: file.name, label: file.name, description: `${file.size} bytes` })),
		]);
		if (picked === undefined) {
			return undefined;
		}
		runner = picked === '' ? undefined : picked;
	}
	if (mode === 'print-prompt') {
		return { runner };
	}

	let sources: readonly string[] | undefined;
	const choices = readSourceChoices(started.check.table, started.check.flags.sources);
	if (choices.length > 0) {
		const picked = await deps.ui.pickMany(
			'Which data sources should be gathered?',
			choices.map(id => ({ id, label: id, picked: true })),
		);
		if (picked === undefined || picked.length === 0) {
			return undefined;
		}
		sources = picked.length === choices.length ? undefined : picked;
	}

	let agent: string | undefined;
	if (started.check.flags.agent !== undefined) {
		const agents = await deps.service.agents(started.folder);
		if (agents.length > 0) {
			const picked = await deps.ui.choose<string>('Which agent should tailor?', [
				{ id: '', label: 'The summary provider Entire is configured with', description: 'the default' },
				...agents.map(entry => ({ id: entry.name, label: entry.name, description: entry.installed ? 'installed; used for this run only' : 'used for this run only' })),
			]);
			if (picked === undefined) {
				return undefined;
			}
			agent = picked === '' ? undefined : picked;
		}
	}
	return { runner, sources, agent };
}
