import type { AccountContext } from './accountContext';
import {
	missingRoles,
	type CaptureFlags,
	type CaptureRole,
	type CleanScope,
	type ConfigureChange,
	type ConfigureKey,
	type RunnerMode,
	type RunnerOptions,
	type SettingsTarget,
} from './captureFlags';
import { describeActingLogin } from './controlPlaneActions';

/** One change the capture-control commands can make. */
export type CaptureAction =
	| { readonly kind: 'disable'; readonly target: SettingsTarget }
	| { readonly kind: 'uninstall' }
	| { readonly kind: 'configure'; readonly changes: readonly ConfigureChange[]; readonly target: SettingsTarget }
	| { readonly kind: 'clean'; readonly scope: CleanScope }
	| { readonly kind: 'runner-defaults'; readonly options: RunnerOptions }
	| { readonly kind: 'runner-print-prompt'; readonly options: RunnerOptions }
	| { readonly kind: 'runner-dry-run'; readonly options: RunnerOptions }
	| { readonly kind: 'runner-tailor'; readonly options: RunnerOptions };

/** Everything that is asked of the CLI: the actions, and the clean preview that changes nothing. */
export type CaptureStep = CaptureAction | { readonly kind: 'clean-preview'; readonly scope: CleanScope };

/** The runner form an action is. */
export function runnerModeOf(action: Extract<CaptureAction, { kind: `runner-${string}` }>): RunnerMode {
	switch (action.kind) {
		case 'runner-defaults':
			return 'defaults';
		case 'runner-print-prompt':
			return 'print-prompt';
		case 'runner-dry-run':
			return 'dry-run';
		case 'runner-tailor':
			return 'tailor';
	}
}

const RUNNER_MODE_ROLE: Readonly<Record<RunnerMode, CaptureRole>> = {
	defaults: 'defaultsOnly',
	'print-prompt': 'printPrompt',
	'dry-run': 'dryRun',
	tailor: 'yes',
};

function scopeRoles(scope: CleanScope): readonly CaptureRole[] {
	return scope.kind === 'all' ? ['all'] : scope.kind === 'session' ? ['session'] : [];
}

/** What a step cannot be run without. */
export function rolesNeeded(step: CaptureStep): readonly CaptureRole[] {
	switch (step.kind) {
		case 'disable':
			return [step.target];
		case 'uninstall':
			return ['uninstall', 'skipPrompt'];
		case 'configure':
			return [...new Set<CaptureRole>([step.target, ...step.changes.map(change => change.key)])];
		case 'clean':
			return ['skipPrompt', ...scopeRoles(step.scope)];
		case 'clean-preview':
			return ['dryRun', ...scopeRoles(step.scope)];
		case 'runner-defaults':
		case 'runner-print-prompt':
		case 'runner-dry-run':
		case 'runner-tailor': {
			const mode = runnerModeOf(step);
			const tailors = mode === 'dry-run' || mode === 'tailor';
			return [
				RUNNER_MODE_ROLE[mode],
				...(tailors && step.options.agent !== undefined ? (['agent'] as const) : []),
				...(tailors && (step.options.sources?.length ?? 0) > 0 ? (['sources'] as const) : []),
			];
		}
	}
}

/** The roles of a step the picked flags do not cover. Empty means it can be run. */
export function missingForStep(step: CaptureStep, flags: CaptureFlags): readonly string[] {
	return missingRoles(rolesNeeded(step), flags);
}

/** What a person is asked to agree to. */
export interface CaptureConfirmation {
	readonly message: string;
	readonly detail: string;
	/** The label of the button that goes ahead. */
	readonly action: string;
	/** The text the person must type before the button works. */
	readonly requireTyped?: string;
}

/** What a confirmation names. All of it is read from the workspace or the CLI at the time. */
export interface ConfirmationFacts {
	/** The repository folder, as a path. */
	readonly folder: string;
	/** The login the command will run as, when the CLI has one. */
	readonly acting?: Pick<AccountContext, 'handle' | 'name'>;
	/** The live sessions, named. Undefined when they could not be read. */
	readonly liveSessions?: readonly string[];
	/** The settings file a disable or configure writes, relative to the folder. */
	readonly settingsFile?: string;
	/** What the CLI's help says the uninstall removes. */
	readonly uninstallList?: readonly string[];
	/** The hook files found in the workspace. */
	readonly hookFiles?: readonly string[];
	/** What the CLI's help says a clean deletes in the chosen scope. */
	readonly cleanList?: readonly string[];
	/** Whether the CLI offers a preview of a clean. */
	readonly hasPreview?: boolean;
	/** One line of the preview, in the CLI's words. */
	readonly previewSummary?: string;
	/** The current value of each setting being changed, as it is shown. */
	readonly currentValues?: Readonly<Partial<Record<ConfigureKey, string>>>;
	/** The agent a tailoring run will use, when one was picked. */
	readonly agent?: string;
	/** The data sources a tailoring run will gather. */
	readonly sources?: readonly string[];
}

/** What is said of a folder that is not a git repository. The status bar says the same. */
export const NOT_A_REPOSITORY = 'This workspace is not a git repository, so Entire cannot track it.';

/** The sentence used when the CLI's help lists nothing under the uninstall. */
export const NO_UNINSTALL_LIST = 'The CLI did not list what it removes.';

/** The folder's own name, which is what a person types to confirm. */
export function folderName(folder: string): string {
	const trimmed = folder.replace(/[\\/]+$/, '');
	const name = trimmed.split(/[\\/]/).pop();
	return name !== undefined && name.length > 0 ? name : folder;
}

function indentedList(lines: readonly string[]): string {
	return lines.map(line => `- ${line}`).join('\n');
}

/**
 * The bullets of a list the help introduces with a line ending in a colon.
 *
 * A bullet may continue on the lines indented under it. A blank line ends
 * the list.
 */
function readBullets(lines: readonly string[], from: number): { readonly bullets: readonly string[]; readonly next: number } {
	const bullets: string[] = [];
	let index = from;
	for (; index < lines.length; index += 1) {
		const line = lines[index];
		const bullet = /^\s*[-*]\s+(\S.*)$/.exec(line);
		if (bullet) {
			bullets.push(bullet[1].trim());
		} else if (bullets.length > 0 && /^\s{3,}\S/.test(line)) {
			bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line.trim()}`;
		} else {
			break;
		}
	}
	return { bullets, next: index };
}

/** The bullets the help lists under the line that introduces the complete removal. Empty when there are none. */
export function parseUninstallList(help: string): readonly string[] {
	const lines = help.split('\n');
	const start = lines.findIndex(line => /\bcompletely remove\b/i.test(line) && /:\s*$/.test(line));
	return start < 0 ? [] : readBullets(lines, start + 1).bullets;
}

/** What the help says the uninstall removes, or the plain statement that it does not say. */
export function describeUninstallList(help: string): string {
	const list = parseUninstallList(help);
	return list.length > 0 ? indentedList(list) : NO_UNINSTALL_LIST;
}

/** What the help lists a clean as deleting, for the default scope and for everything. */
export interface CleanScopeLists {
	readonly head: readonly string[];
	readonly all: readonly string[];
}

/** Reads the two lists a clean's help gives: the default scope and the whole repository. */
export function parseCleanScopes(help: string): CleanScopeLists {
	const lines = help.split('\n');
	let head: readonly string[] = [];
	let all: readonly string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!/:\s*$/.test(line)) {
			continue;
		}
		if (/^by default\b/i.test(line.trim()) && head.length === 0) {
			head = readBullets(lines, index + 1).bullets;
		} else if (/\bto clean all\b/i.test(line) && all.length === 0) {
			all = readBullets(lines, index + 1).bullets;
		}
	}
	return { head, all };
}

/** Whether every line of a list is about session state, shadow branches or temporary files. */
export function isSessionDataList(list: readonly string[]): boolean {
	return list.length > 0 && list.every(line => /session|shadow|temporary|\btmp\b/i.test(line));
}

function login(facts: ConfirmationFacts): string {
	return facts.acting ? describeActingLogin(facts.acting) : 'no saved login (the CLI runs without one)';
}

function liveSentence(facts: ConfirmationFacts, tail: string): string | undefined {
	if (facts.liveSessions === undefined) {
		return 'Entirely could not read which sessions are live, so it cannot name them here.';
	}
	if (facts.liveSessions.length === 0) {
		return undefined;
	}
	const count = facts.liveSessions.length;
	return `${count} ${count === 1 ? 'session is' : 'sessions are'} live: ${facts.liveSessions.join(', ')}. ${tail}`;
}

function join(parts: readonly (string | undefined)[]): string {
	return parts.filter((part): part is string => part !== undefined && part.length > 0).join('\n\n');
}

const SETTING_LABELS: Readonly<Record<ConfigureKey, string>> = {
	telemetry: 'telemetry',
	absoluteHookPath: 'absolute git hook path',
	skipPushSessions: 'skip pushing session logs',
	checkpointBackend: 'checkpoint backend',
	checkpointRemote: 'checkpoint remote',
	summaryProvider: 'summary provider',
	summaryModel: 'summary model',
	summaryTimeout: 'summary timeout (seconds)',
	reinstallHook: 'git hook',
};

/** The label a setting is shown under. */
export function settingLabel(key: ConfigureKey): string {
	return SETTING_LABELS[key];
}

/** A value as it is shown in a message: booleans as on and off. */
export function showValue(value: string | number | boolean): string {
	return typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
}

/** The line that says what one chosen setting changes. */
export function describeChange(change: ConfigureChange, facts: Pick<ConfirmationFacts, 'currentValues' | 'settingsFile'>): string {
	const file = facts.settingsFile ?? 'the chosen settings file';
	if (change.key === 'reinstallHook') {
		return "git hook: reinstalled (Entire rewrites the hook it manages in this checkout's .git/hooks)";
	}
	const before = facts.currentValues?.[change.key] ?? 'not set';
	const after = showValue(change.value);
	const note = change.key === 'checkpointBackend' ? '; this migrates storage for the repository and is not offered as a one-click undo' : '';
	return `${SETTING_LABELS[change.key]}: ${before} -> ${after} in ${file}${note}`;
}

const SIGNALS =
	'its docs and structure, merged pull requests and issues, checkpoint hotspots and past trail findings';

/**
 * The question asked before a change.
 *
 * Every question names the folder, what it changes and the login it runs
 * as, and says the change is to this checkout on this machine. A question
 * about a removal or a deletion with no way back also asks for the folder's
 * name to be typed.
 */
export function confirmationFor(action: CaptureAction, facts: ConfirmationFacts): CaptureConfirmation {
	const name = folderName(facts.folder);
	const local = 'This changes this checkout on this machine only.';
	const runs = (verb: string): string => `Entirely will run \`entire ${verb}\` as ${login(facts)} in ${facts.folder}.`;
	const file = facts.settingsFile ?? 'the settings file you chose';
	// Live sessions that could not be read are not the same as none, so that case asks for the name too.
	const unreadable = facts.liveSessions === undefined;

	switch (action.kind) {
		case 'disable':
			return {
				message: `Turn Entire off in ${name}?`,
				detail: join([
					'Capture stops: hooks exit silently and Entire commands report that it is disabled. Nothing is removed.',
					`${runs('disable')} It writes ${file}.`,
					liveSentence(facts, 'They will stop being recorded.'),
					local,
					unreadable ? `Type the folder name ${name} to continue.` : undefined,
				]),
				action: 'Turn Off',
				requireTyped: unreadable ? name : undefined,
			};

		case 'uninstall': {
			const list = facts.uninstallList ?? [];
			const mentionsCheckpoints = list.some(line => /checkpoint/i.test(line));
			const hooks = facts.hookFiles ?? [];
			return {
				message: `Completely remove Entire from ${name}?`,
				detail: join([
					list.length > 0 ? `The CLI's help says this removes:\n${indentedList(list)}` : NO_UNINSTALL_LIST,
					'The Entire CLI has no preview for this, so Entirely cannot show you the exact files before it runs.',
					hooks.length > 0
						? `Hook files Entirely found in this workspace: ${hooks.join(', ')}.`
						: 'Entirely found no hook files in this workspace.',
					"This cannot be undone by Entirely. Entire's own .entire/ directory, including local settings and logs, is deleted." +
						(mentionsCheckpoints ? '' : ' Commits and checkpoints already pushed are not touched.'),
					liveSentence(facts, 'They will stop being recorded.'),
					`${runs('disable')} ${local}`,
					`Type the folder name ${name} to continue.`,
				]),
				action: 'Remove Entire',
				requireTyped: name,
			};
		}

		case 'clean': {
			const scope = action.scope;
			const what =
				scope.kind === 'all'
					? 'all session data in this repository'
					: scope.kind === 'session'
						? `the data of session ${scope.id}`
						: 'session data for the current HEAD';
			const list = facts.cleanList ?? [];
			const live = facts.liveSessions ?? [];
			const preview = facts.hasPreview
				? `Preview, in the CLI's own words (the full text is open in an editor): ${facts.previewSummary ?? 'it printed nothing'}`
				: 'This version of the CLI has no preview, so Entirely cannot show what will be deleted.';
			return {
				message: `Delete ${what} in ${name}?`,
				detail: join([
					list.length > 0
						? `The CLI's help says this deletes:\n${indentedList(list)}\nIt does not delete your working tree.${isSessionDataList(list) ? ' Checkpoints already recorded are not on that list.' : ''}`
						: 'It deletes session state in this checkout. It does not delete your working tree.',
					preview,
					liveSentence(facts, 'Cleaning removes their state and they stop being recorded.'),
					"Once you confirm here, Entirely passes the CLI's skip-confirmation flag, which also overrides its own live-session guard. This message is the guard.",
					`${runs('clean')} ${local}`,
					scope.kind === 'all' || !facts.hasPreview || unreadable ? `Type the folder name ${name} to continue.` : undefined,
				]),
				action: live.length > 0 ? 'Delete anyway' : 'Delete',
				requireTyped: scope.kind === 'all' || !facts.hasPreview || unreadable ? name : undefined,
			};
		}

		case 'configure':
			return {
				message: `Change Entire's settings in ${name}?`,
				detail: join([
					`These changes are written to ${file}:\n${indentedList(action.changes.map(change => describeChange(change, facts)))}`,
					`Nothing else is written. ${runs('configure')} ${local}`,
				]),
				action: 'Write Settings',
			};

		case 'runner-defaults':
			return {
				message: `Create the default runners in ${name}?`,
				detail: join([
					'Writes the generic default runner files under .entire/runners. No summary provider is called and nothing leaves this machine.',
					`${runs('runner setup')} ${local}`,
				]),
				action: 'Create Defaults',
			};

		case 'runner-print-prompt':
			return {
				message: `Print the tailoring prompt for ${name}?`,
				detail: join([
					'Creates the default runner files under .entire/runners if they are missing, then prints the tailoring prompt for you to give to your own agent. Entire calls no summary provider for this.',
					`${runs('runner setup')} ${local}`,
				]),
				action: 'Print Prompt',
			};

		case 'runner-dry-run':
		case 'runner-tailor': {
			const writes = action.kind === 'runner-tailor';
			const provider = facts.agent
				? `the summary provider Entire is configured with (for this run only, the agent ${facts.agent})`
				: 'the summary provider Entire is configured with';
			return {
				message: writes ? `Tailor the runners to ${name}?` : `Preview tailoring the runners in ${name}?`,
				detail: join([
					`Tailoring sends signals about this repository (${SIGNALS}) to ${provider}. ${
						writes ? 'Tailoring rewrites .entire/runners/*.json; review the result with git diff.' : 'The preview writes nothing.'
					}`,
					facts.sources && facts.sources.length > 0 ? `Data sources: ${facts.sources.join(', ')}.` : undefined,
					action.options.runner ? `Only the runner ${action.options.runner} is tuned.` : undefined,
					`${runs('runner setup')} ${local}`,
				]),
				action: writes ? 'Send and Tailor' : 'Send and Preview',
			};
		}
	}
}

/** How a capture-control command ended. */
export type CaptureOutcome =
	/** The change ran and a fresh read confirms it. `lines` are the facts the read confirmed. */
	| { readonly kind: 'done'; readonly summary: string; readonly lines: readonly string[] }
	/** The command finished but a fresh read does not confirm the change. */
	| { readonly kind: 'unconfirmed'; readonly detail: string; readonly lines: readonly string[] }
	| { readonly kind: 'failed'; readonly detail: string; readonly lines: readonly string[] }
	/** The change would not make a difference: it is already as asked. */
	| { readonly kind: 'unchanged'; readonly detail: string }
	/** The CLI is there but cannot do this. Nothing ran. */
	| { readonly kind: 'unsupported'; readonly detail: string }
	| { readonly kind: 'no-cli'; readonly detail: string }
	| { readonly kind: 'cancelled' };

/** The words a command ends in. */
export function describeCaptureOutcome(outcome: CaptureOutcome): string {
	const lines = 'lines' in outcome && outcome.lines.length > 0 ? `\n${outcome.lines.map(line => `- ${line}`).join('\n')}` : '';
	switch (outcome.kind) {
		case 'done':
			return `${outcome.summary}${lines}`;
		case 'unconfirmed':
			return `Unconfirmed: ${outcome.detail}${lines}`;
		case 'failed':
			return `Failed: ${outcome.detail}${lines}`;
		case 'unchanged':
			return outcome.detail;
		case 'unsupported':
		case 'no-cli':
			return outcome.detail;
		case 'cancelled':
			return 'Cancelled. Nothing was changed.';
	}
}

/** The message for a CLI that lacks a command or a flag the action needs. */
export function describeCannot(what: string, command: string, version: string | undefined, missing: readonly string[]): string {
	const old = version ? ` (${version})` : '';
	const lacks = missing.length > 0 ? ` Its help does not describe the ${missing.join(', ')}.` : '';
	return `This version of the Entire CLI${old} cannot ${what} from the editor.${lacks} Update the CLI, or run \`entire ${command} --help\` in a terminal.`;
}
