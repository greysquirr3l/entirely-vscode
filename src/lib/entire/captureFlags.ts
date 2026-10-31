import { pickFlags, readChoices, type FlagWant } from './controlPlaneFlags';
import { END_OF_OPTIONS } from './operand';
import { readFlagTable, type HelpFlag } from './search';
import { readCurrentRepo } from './workSearchFlags';
import { isSessionId } from './sessionInfo';

/** The four CLI commands that stop, change or clean capture, or set up runners. */
export type CaptureCommand = 'disable' | 'configure' | 'clean' | 'runner setup';

/**
 * What the extension needs from each command's flags, found by what the
 * CLI's help says about them. There is no fallback table: a help text with
 * no flag table gives no flags, and a flag the help does not list is never
 * passed.
 */
export const DISABLE_WANTS = {
	uninstall: { name: /uninstall/ },
	skipPrompt: { description: /\bskip\b.*\bconfirm/i },
	local: { name: /local$/ },
	project: { name: /project$/ },
} as const satisfies Record<string, FlagWant>;

export const CONFIGURE_WANTS = {
	telemetry: { name: /telemetry/ },
	absoluteHookPath: { name: /absolute/ },
	reinstallHook: { description: /\breinstall\b/i },
	checkpointRemote: { name: /remote/ },
	checkpointBackend: { name: /backend/ },
	skipPushSessions: { name: /push/ },
	summaryProvider: { name: /provider/ },
	summaryModel: { name: /model/ },
	summaryTimeout: { name: /timeout/ },
	local: { name: /local$/ },
	project: { name: /project$/ },
} as const satisfies Record<string, FlagWant>;

export const CLEAN_WANTS = {
	all: { name: /-all$/ },
	dryRun: { name: /dry-run/, description: /\bpreview\b/i },
	skipPrompt: { description: /\bskip\b.*\bconfirm/i },
	session: { name: /session$/ },
} as const satisfies Record<string, FlagWant>;

export const RUNNER_SETUP_WANTS = {
	defaultsOnly: { name: /defaults-only/ },
	printPrompt: { name: /print-prompt/ },
	dryRun: { name: /dry-run/ },
	yes: { name: /-yes$/, description: /\btailor\b.*\bin place\b/i },
	agent: { name: /-agent$/ },
	sources: { name: /sources/ },
} as const satisfies Record<string, FlagWant>;

type RolesOf<W> = keyof W & string;

/** Every role a flag can be picked for, across the four commands. */
export type CaptureRole =
	| RolesOf<typeof DISABLE_WANTS>
	| RolesOf<typeof CONFIGURE_WANTS>
	| RolesOf<typeof CLEAN_WANTS>
	| RolesOf<typeof RUNNER_SETUP_WANTS>;

/** The flags picked for a command, by role. A role the help did not describe is absent. */
export type CaptureFlags = Readonly<Partial<Record<CaptureRole, string>>>;

/** The flags a command's help offers, or the roles it lacks. */
export type CapturePlan =
	| {
			readonly ok: true;
			readonly flags: CaptureFlags;
			readonly table: readonly HelpFlag[];
			readonly repository: string | undefined;
	  }
	| { readonly ok: false; readonly missing: readonly string[]; readonly detail: string };

const WANTS: Readonly<Record<CaptureCommand, Readonly<Record<string, FlagWant>>>> = {
	disable: DISABLE_WANTS,
	configure: CONFIGURE_WANTS,
	clean: CLEAN_WANTS,
	'runner setup': RUNNER_SETUP_WANTS,
};

/** What a role is called in a message. No flag spelling appears here. */
export const ROLE_WORDS: Readonly<Record<CaptureRole, string>> = {
	uninstall: 'mode that removes Entire completely',
	skipPrompt: 'flag that skips the confirmation prompt',
	local: 'flag that writes this checkout only',
	project: 'flag that writes the shared settings file',
	telemetry: 'telemetry flag',
	absoluteHookPath: 'absolute git hook path flag',
	reinstallHook: 'flag that reinstalls the git hook',
	checkpointRemote: 'checkpoint remote flag',
	checkpointBackend: 'checkpoint backend flag',
	skipPushSessions: 'flag that stops pushing session logs',
	summaryProvider: 'summary provider flag',
	summaryModel: 'summary model flag',
	summaryTimeout: 'summary timeout flag',
	all: 'flag that cleans all session data',
	dryRun: 'preview flag',
	session: 'flag that names one session',
	defaultsOnly: 'flag that creates the default runners only',
	printPrompt: 'flag that prints the tailoring prompt',
	yes: 'flag that tailors the runners',
	agent: 'flag that names the agent for this run',
	sources: 'flag that names the data sources',
};

/**
 * Picks the flags of one command out of its help.
 *
 * Nothing is required here: whether a role is needed depends on the action
 * (a preview-less clean is allowed, a disable needs a target), so each
 * action asks `missingRoles` for what it cannot do without.
 */
export function planCaptureFlags(command: CaptureCommand, help: string): CapturePlan {
	const picked = pickFlags(command, help, [], WANTS[command]);
	if (!picked.ok) {
		return { ok: false, missing: [], detail: picked.detail };
	}
	if (readFlagTable(help).length === 0) {
		return {
			ok: false,
			missing: [],
			detail: `the help of 'entire ${command}' on this CLI lists no flags that Entirely can read; update the CLI`,
		};
	}
	return { ok: true, flags: picked.flags as CaptureFlags, table: picked.table, repository: readCurrentRepo(help) };
}

/** Where a settings change is written: this checkout only, or the shared file. */
export type SettingsTarget = 'local' | 'project';

/** The repository settings files, relative to the folder. User-level settings are not written by any flag. */
export const SETTINGS_FILES: Readonly<Record<SettingsTarget, string>> = {
	local: '.entire/settings.local.json',
	project: '.entire/settings.json',
};

/** One setting the person chose in `configure`. */
export type ConfigureChange =
	| { readonly key: 'telemetry' | 'absoluteHookPath' | 'skipPushSessions'; readonly value: boolean }
	| { readonly key: 'checkpointBackend' | 'checkpointRemote' | 'summaryProvider' | 'summaryModel'; readonly value: string }
	| { readonly key: 'summaryTimeout'; readonly value: number }
	| { readonly key: 'reinstallHook' };

export type ConfigureKey = ConfigureChange['key'];

/** Which scope of session data a clean covers. */
export type CleanScope =
	| { readonly kind: 'head' }
	| { readonly kind: 'all' }
	| { readonly kind: 'session'; readonly id: string };

/** The four forms of `runner setup` the editor offers. */
export type RunnerMode = 'defaults' | 'print-prompt' | 'dry-run' | 'tailor';

/** Options of a run that tailors. */
export interface RunnerOptions {
	/** A runner to tune, by the name of its file. */
	readonly runner?: string;
	/** The agent to tailor with, for this run only. */
	readonly agent?: string;
	readonly sources?: readonly string[];
}

/** The roles of an action that the picked flags do not cover, in words. */
export function missingRoles(needed: readonly CaptureRole[], flags: CaptureFlags): readonly string[] {
	return needed.filter(role => flags[role] === undefined).map(role => ROLE_WORDS[role]);
}

function flagFor(flags: CaptureFlags, role: CaptureRole): string | undefined {
	return flags[role];
}

function withValue(flag: string, value: string | number | boolean): string {
	return `${flag}=${String(value)}`;
}

/** `entire disable`, writing the chosen file. Undefined when the help had no such target flag. */
export function disableArguments(flags: CaptureFlags, target: SettingsTarget): readonly string[] | undefined {
	const flag = flagFor(flags, target);
	return flag === undefined ? undefined : ['disable', flag];
}

/**
 * `entire disable` in the mode that removes Entire, past the CLI's prompt.
 * Built only after the person has typed the folder's name.
 */
export function uninstallArguments(flags: CaptureFlags): readonly string[] | undefined {
	const { uninstall, skipPrompt } = flags;
	return uninstall === undefined || skipPrompt === undefined ? undefined : ['disable', uninstall, skipPrompt];
}

/**
 * `entire configure` with exactly the settings that were chosen and the
 * file they go to. Values go in the `flag=value` form, which is also how a
 * boolean is switched off.
 */
export function configureArguments(flags: CaptureFlags, changes: readonly ConfigureChange[], target: SettingsTarget): readonly string[] | undefined {
	const targetFlag = flagFor(flags, target);
	if (targetFlag === undefined || changes.length === 0) {
		return undefined;
	}
	const args: string[] = ['configure'];
	const seen = new Set<ConfigureKey>();
	for (const change of changes) {
		const flag = flagFor(flags, change.key);
		if (flag === undefined || seen.has(change.key)) {
			return undefined;
		}
		seen.add(change.key);
		if (!('value' in change)) {
			args.push(flag);
		} else if (change.key === 'checkpointRemote' || change.key === 'summaryModel') {
			// A typed value is its own argument, so the recorder can hide it.
			args.push(flag, change.value);
		} else {
			args.push(withValue(flag, change.value));
		}
	}
	args.push(targetFlag);
	return args;
}

/** Whether a string can be handed to the CLI as the id of one session. */
export function isCleanSessionId(value: string): boolean {
	return isSessionId(value);
}

function cleanScopeArguments(flags: CaptureFlags, scope: CleanScope): readonly string[] | undefined {
	switch (scope.kind) {
		case 'head':
			return [];
		case 'all': {
			const flag = flagFor(flags, 'all');
			return flag === undefined ? undefined : [flag];
		}
		case 'session': {
			const flag = flagFor(flags, 'session');
			return flag === undefined || !isCleanSessionId(scope.id) ? undefined : [withValue(flag, scope.id)];
		}
	}
}

/** `entire clean` as a preview: nothing is deleted and nothing is asked. */
export function cleanPreviewArguments(flags: CaptureFlags, scope: CleanScope): readonly string[] | undefined {
	const preview = flagFor(flags, 'dryRun');
	const scoped = cleanScopeArguments(flags, scope);
	return preview === undefined || scoped === undefined ? undefined : ['clean', preview, ...scoped];
}

/**
 * `entire clean` past the CLI's prompt and its live-session guard. Built
 * only after the person has confirmed in the editor.
 */
export function cleanArguments(flags: CaptureFlags, scope: CleanScope): readonly string[] | undefined {
	const skip = flagFor(flags, 'skipPrompt');
	const scoped = cleanScopeArguments(flags, scope);
	return skip === undefined || scoped === undefined ? undefined : ['clean', skip, ...scoped];
}

/** Whether a runner name can be handed to the CLI as an operand. */
export function isRunnerName(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

/** Whether an agent name can be handed to the CLI. */
function isAgentValue(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

/** The data sources a tailoring run may gather, as the help lists them. */
export function readSourceChoices(table: readonly HelpFlag[], flag: string | undefined): readonly string[] {
	const description = table.find(row => row.name === flag)?.description ?? '';
	return readChoices(description);
}

/**
 * `entire runner setup` in one of its four forms.
 *
 * The debug-directory flag is not one of the roles, so it cannot be passed.
 * The runner name is the one operand, after the end of options.
 */
export function runnerSetupArguments(flags: CaptureFlags, mode: RunnerMode, options: RunnerOptions = {}): readonly string[] | undefined {
	const modeFlag = flagFor(flags, { defaults: 'defaultsOnly', 'print-prompt': 'printPrompt', 'dry-run': 'dryRun', tailor: 'yes' }[mode] as CaptureRole);
	if (modeFlag === undefined) {
		return undefined;
	}
	const args: string[] = ['runner', 'setup', modeFlag];
	const tailors = mode === 'dry-run' || mode === 'tailor';
	if (tailors && options.agent !== undefined) {
		const flag = flagFor(flags, 'agent');
		if (flag === undefined || !isAgentValue(options.agent)) {
			return undefined;
		}
		args.push(withValue(flag, options.agent));
	}
	if (tailors && options.sources !== undefined && options.sources.length > 0) {
		const flag = flagFor(flags, 'sources');
		if (flag === undefined || !options.sources.every(isAgentValue)) {
			return undefined;
		}
		args.push(withValue(flag, options.sources.join(',')));
	}
	if (options.runner !== undefined) {
		if (!isRunnerName(options.runner)) {
			return undefined;
		}
		args.push(END_OF_OPTIONS, options.runner);
	}
	return args;
}

/** The flags whose typed values must not appear in the recorded command line. */
export function sensitiveFlags(flags: CaptureFlags): readonly string[] {
	return [flags.checkpointRemote, flags.summaryModel].filter((flag): flag is string => flag !== undefined);
}

/**
 * The values a backend flag's help line offers, such as `refs` and `branch`
 * in "refs (default; ...) or branch (legacy ...)". A line that names none
 * gives none, and the caller says so rather than guessing.
 */
export function readBackendChoices(description: string): readonly string[] {
	const colon = description.indexOf(':');
	if (colon < 0) {
		return readChoices(description);
	}
	const found: string[] = [];
	const rest = description.slice(colon + 1);
	// Each alternative is a word, then an optional parenthesised note.
	const first = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(\([^)]*\))?/;
	const later = /^\s*(?:,\s*(?:or\s+)?|or\s+)([A-Za-z][A-Za-z0-9-]*)\s*(\([^)]*\))?/;
	let remaining = rest;
	for (;;) {
		const match = (found.length === 0 ? first : later).exec(remaining);
		if (!match) {
			break;
		}
		found.push(match[1]);
		remaining = remaining.slice(match[0].length);
	}
	return found.length >= 2 ? found : readChoices(description);
}

/** The providers a checkpoint remote may name, as the help line lists them ("providers: a, b"). */
export function readRemoteProviders(description: string): readonly string[] {
	const match = /\bproviders:\s*([A-Za-z][A-Za-z0-9-]*(?:\s*,\s*[A-Za-z][A-Za-z0-9-]*)*)/i.exec(description);
	return match ? match[1].split(/\s*,\s*/) : [];
}

/** Whether a value has the `provider:owner/repo` form, with a provider from the list (any provider when the help names none). */
export function isCheckpointRemote(value: string, providers: readonly string[]): boolean {
	const match = /^([A-Za-z][A-Za-z0-9-]*):([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
	return match !== null && (providers.length === 0 || providers.includes(match[1].toLowerCase())) && match[2] !== '.' && match[2] !== '..' && match[3] !== '.' && match[3] !== '..';
}
