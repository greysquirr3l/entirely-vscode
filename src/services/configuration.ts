import * as vscode from 'vscode';

import { DEFAULT_EDITOR_HOOK_AGENT, DEFAULT_MINIMUM_CLI_VERSION } from '../lib/entire';
import { readLogLevel, shouldLog, type LogLevel } from './logger';

/** The extension's own settings. */
export interface ExtensionSettings {
	/** The path the user gave for the CLI, when they gave one. */
	readonly cliPath?: string;
	/**
	 * The saved login the extension acts as, when the user chose one.
	 *
	 * The name is the one the CLI saved the login under, not the handle:
	 * a context is named after its login server's host, and a second
	 * identity on a host that already has one is saved as `HANDLE@HOST`.
	 */
	readonly cliContext?: string;
	/**
	 * The agent integration whose hook payload layout matches the editor's.
	 *
	 * The hook bridge forwards the editor's own agent events to this agent
	 * and to no other.
	 */
	readonly editorHookAgent: string;
	/** How long, in seconds, the agent integration lookup stays cached. */
	readonly agentLookupCacheSeconds: number;
	/** How often, in seconds, the extension re-reads the CLI. */
	readonly refreshInterval: number;
	/** How long, in seconds, the CLI may take to hand over a session transcript. */
	readonly transcriptTimeout: number;
	/** How long, in seconds, a session lifecycle command (stop, attach, adopt) may take. */
	readonly lifecycleActionTimeout: number;
	/** How long, in seconds, `entire doctor` may take when the doctor report asks it. */
	readonly cliDoctorTimeout: number;
	/** How long, in seconds, a control plane call (a listing, a change, an API call) may take. */
	readonly controlPlaneTimeout: number;
	/** How long, in seconds, `entire activity` and `entire recap` may take. */
	readonly activityTimeout: number;
	/** How long, in seconds, a dispatch may take to generate. */
	readonly dispatchTimeout: number;
	/** How long, in seconds, a history import (and its preview) may take. */
	readonly importTimeout: number;
	/** How long, in seconds, to watch for a resumed session to become active. */
	readonly resumeWatchTimeout: number;
	/** How long, in milliseconds, the checkpoint filter waits after typing before it searches. */
	readonly searchDebounce: number;
	/** Whether editor search covers the current repository or every repository the login can see. */
	readonly searchScope: SearchScopeSetting;
	/** The most lines of a file that blame is drawn on in the editor. */
	readonly blameMaxDecoratedLines: number;
	/** Whether the sessions tree is also shown in the Explorer. */
	readonly showSessionsInExplorer: boolean;
	/** How much the extension says. */
	readonly logLevel: LogLevel;
	/** Whether the extension says more than it otherwise would. */
	readonly debug: boolean;
	/**
	 * The oldest Entire CLI whose payloads the extension reads.
	 *
	 * The extension still works with an older CLI; it warns that some of
	 * what it reads may be missing. The setting is here so that the
	 * warning can be turned off for a version that turns out to report
	 * everything, without waiting for a release.
	 */
	readonly minimumCliVersion: string;
}

/**
 * The bounds of the refresh interval.
 *
 * Node's timers take a millisecond count, and a count past 2^31 wraps
 * around to 1 ms. A poll on a 1 ms timer spawns a CLI process as fast as
 * the event loop allows, so the interval is clamped rather than trusted.
 *
 * The upper bound is the point past which polling stops being useful
 * anyway: the trees are for watching work happen, not for watching it
 * happen in the millisecond.
 */
export const MIN_REFRESH_INTERVAL_SECONDS = 1;
export const MAX_REFRESH_INTERVAL_SECONDS = 3600;

/**
 * Puts a refresh interval inside the range the extension can poll at.
 *
 * A value of zero still means "do not poll", because that is a thing a
 * user may reasonably want.
 */
export const MIN_TRANSCRIPT_TIMEOUT_SECONDS = 5;
export const MAX_TRANSCRIPT_TIMEOUT_SECONDS = 600;
export const DEFAULT_AGENT_LOOKUP_CACHE_SECONDS = 30;
export const MIN_AGENT_LOOKUP_CACHE_SECONDS = 5;
export const MAX_AGENT_LOOKUP_CACHE_SECONDS = 600;

/** Puts the agent lookup cache lifetime inside a useful range. */
export function clampAgentLookupCacheSeconds(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return DEFAULT_AGENT_LOOKUP_CACHE_SECONDS;
	}
	return Math.min(MAX_AGENT_LOOKUP_CACHE_SECONDS, Math.max(MIN_AGENT_LOOKUP_CACHE_SECONDS, Math.floor(seconds)));
}

/** Puts the transcript timeout inside the range the extension will wait for. */
export function clampTranscriptTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 60;
	}
	return Math.min(
		MAX_TRANSCRIPT_TIMEOUT_SECONDS,
		Math.max(MIN_TRANSCRIPT_TIMEOUT_SECONDS, Math.floor(seconds)),
	);
}

/** The bounds of the time a lifecycle command may take, in seconds. */
export const MIN_LIFECYCLE_TIMEOUT_SECONDS = 5;
export const MAX_LIFECYCLE_TIMEOUT_SECONDS = 600;

/** Puts the lifecycle command timeout inside the range the extension will wait for. */
export function clampLifecycleTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 60;
	}
	return Math.min(
		MAX_LIFECYCLE_TIMEOUT_SECONDS,
		Math.max(MIN_LIFECYCLE_TIMEOUT_SECONDS, Math.floor(seconds)),
	);
}

/** The bounds of the time `entire doctor` may take, in seconds. */
export const MIN_CLI_DOCTOR_TIMEOUT_SECONDS = 5;
export const MAX_CLI_DOCTOR_TIMEOUT_SECONDS = 300;

/** Puts the CLI doctor timeout inside the range the extension will wait for. */
export function clampCliDoctorTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 30;
	}
	return Math.min(
		MAX_CLI_DOCTOR_TIMEOUT_SECONDS,
		Math.max(MIN_CLI_DOCTOR_TIMEOUT_SECONDS, Math.floor(seconds)),
	);
}

/** The bounds of the time a control plane call may take, in seconds. A cascade delete waits for the mirrors to go. */
export const MIN_CONTROL_PLANE_TIMEOUT_SECONDS = 5;
export const MAX_CONTROL_PLANE_TIMEOUT_SECONDS = 900;

/** Puts the control plane timeout inside the range the extension will wait for. */
export function clampControlPlaneTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 60;
	}
	return Math.min(MAX_CONTROL_PLANE_TIMEOUT_SECONDS, Math.max(MIN_CONTROL_PLANE_TIMEOUT_SECONDS, Math.floor(seconds)));
}

/** The bounds of the time the activity and recap reads may take, in seconds. */
export const MIN_ACTIVITY_TIMEOUT_SECONDS = 5;
export const MAX_ACTIVITY_TIMEOUT_SECONDS = 300;

/** Puts the activity timeout inside the range the extension will wait for. */
export function clampActivityTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 30;
	}
	return Math.min(MAX_ACTIVITY_TIMEOUT_SECONDS, Math.max(MIN_ACTIVITY_TIMEOUT_SECONDS, Math.floor(seconds)));
}

/** The bounds of the time a dispatch may take, in seconds. A local agent writes it, which can be slow. */
export const MIN_DISPATCH_TIMEOUT_SECONDS = 10;
export const MAX_DISPATCH_TIMEOUT_SECONDS = 1800;

/** Puts the dispatch timeout inside the range the extension will wait for. */
export function clampDispatchTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 180;
	}
	return Math.min(MAX_DISPATCH_TIMEOUT_SECONDS, Math.max(MIN_DISPATCH_TIMEOUT_SECONDS, Math.floor(seconds)));
}

/** The bounds of the time an import may take, in seconds. Imports read a month of transcripts. */
export const MIN_IMPORT_TIMEOUT_SECONDS = 10;
export const MAX_IMPORT_TIMEOUT_SECONDS = 3600;

/** Puts the import timeout inside the range the extension will wait for. */
export function clampImportTimeout(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 300;
	}
	return Math.min(MAX_IMPORT_TIMEOUT_SECONDS, Math.max(MIN_IMPORT_TIMEOUT_SECONDS, Math.floor(seconds)));
}

/** The bounds of the time spent watching for a resumed session, in seconds. */
export const MIN_RESUME_WATCH_SECONDS = 5;
export const MAX_RESUME_WATCH_SECONDS = 600;

/** Puts the resume watch inside a range that is neither pointless nor endless. */
export function clampResumeWatch(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 60;
	}
	return Math.min(MAX_RESUME_WATCH_SECONDS, Math.max(MIN_RESUME_WATCH_SECONDS, Math.floor(seconds)));
}

/** The smallest and largest debounce the filter will use, in milliseconds. */
export const MIN_SEARCH_DEBOUNCE_MS = 100;
export const MAX_SEARCH_DEBOUNCE_MS = 3000;

/** Puts the debounce inside the range that still feels like typing. */
export function clampSearchDebounce(milliseconds: number): number {
	if (!Number.isFinite(milliseconds)) {
		return 400;
	}
	return Math.min(MAX_SEARCH_DEBOUNCE_MS, Math.max(MIN_SEARCH_DEBOUNCE_MS, Math.floor(milliseconds)));
}

export type SearchScopeSetting = 'repository' | 'all-repositories';

/** Reads the search scope, falling back to the narrower one for a value that is not recognised. */
export function readSearchScope(value: string): SearchScopeSetting {
	return value === 'all-repositories' ? 'all-repositories' : 'repository';
}

/** The smallest and largest line limit for drawing blame. */
export const MIN_BLAME_LINES = 100;
export const MAX_BLAME_LINES = 100_000;

/** Puts the blame line limit inside the range the editor can draw cheaply. */
export function clampBlameMaxLines(lines: number): number {
	if (!Number.isFinite(lines)) {
		return 5000;
	}
	return Math.min(MAX_BLAME_LINES, Math.max(MIN_BLAME_LINES, Math.floor(lines)));
}

export function clampRefreshInterval(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return 30;
	}

	if (seconds === 0) {
		return 0;
	}

	return Math.min(
		MAX_REFRESH_INTERVAL_SECONDS,
		Math.max(MIN_REFRESH_INTERVAL_SECONDS, Math.floor(seconds)),
	);
}

/**
 * Reads the extension's settings.
 *
 * Every setting is read here so that there is one place that knows what
 * the settings are called and what they mean. A setting the user has not
 * touched reads as the default the manifest declares.
 */
export function readExtensionSettings(): ExtensionSettings {
	const configuration = vscode.workspace.getConfiguration('entirely');

	const cliPath = configuration.get<string>('cliPath', '').trim();

	const cliContext = configuration.get<string>('cliContext', '').trim();

	const minimumCliVersion = configuration
		.get<string>('minimumCliVersion', DEFAULT_MINIMUM_CLI_VERSION)
		.trim();

	const editorHookAgentValue = configuration.get<unknown>('editorHookAgent', DEFAULT_EDITOR_HOOK_AGENT);
	const editorHookAgent = typeof editorHookAgentValue === 'string' ? editorHookAgentValue.trim() : '';

	return {
		editorHookAgent,
		agentLookupCacheSeconds: clampAgentLookupCacheSeconds(
			configuration.get<number>('agentLookupCacheSeconds', DEFAULT_AGENT_LOOKUP_CACHE_SECONDS),
		),
		cliPath: cliPath.length > 0 ? cliPath : undefined,
		cliContext: cliContext.length > 0 ? cliContext : undefined,
		refreshInterval: clampRefreshInterval(configuration.get<number>('refreshInterval', 30)),
		transcriptTimeout: clampTranscriptTimeout(configuration.get<number>('transcriptTimeout', 60)),
		lifecycleActionTimeout: clampLifecycleTimeout(configuration.get<number>('lifecycleActionTimeout', 60)),
		cliDoctorTimeout: clampCliDoctorTimeout(configuration.get<number>('cliDoctorTimeout', 30)),
		controlPlaneTimeout: clampControlPlaneTimeout(configuration.get<number>('controlPlaneTimeout', 60)),
		activityTimeout: clampActivityTimeout(configuration.get<number>('activityTimeout', 30)),
		dispatchTimeout: clampDispatchTimeout(configuration.get<number>('dispatchTimeout', 180)),
		importTimeout: clampImportTimeout(configuration.get<number>('importTimeout', 300)),
		resumeWatchTimeout: clampResumeWatch(configuration.get<number>('resumeWatchTimeout', 60)),
		searchDebounce: clampSearchDebounce(configuration.get<number>('searchDebounce', 400)),
		searchScope: readSearchScope(configuration.get<string>('searchScope', 'repository')),
		blameMaxDecoratedLines: clampBlameMaxLines(configuration.get<number>('blameMaxDecoratedLines', 5000)),
		showSessionsInExplorer: configuration.get<boolean>('showSessionsInExplorer', false),
		logLevel: readLogLevel(configuration.get<string>('logLevel', 'info')),
		debug: configuration.get<boolean>('debug', false),
		minimumCliVersion:
			minimumCliVersion.length > 0 ? minimumCliVersion : DEFAULT_MINIMUM_CLI_VERSION,
	};
}

/**
 * The verbosity the extension actually logs at.
 *
 * The debug setting turns the volume up without opening a second channel:
 * there is one place for everything the extension says, and asking for
 * more of it should not mean finding it somewhere else.
 */
export function effectiveLogLevel(settings: ExtensionSettings): LogLevel {
	if (settings.debug && !shouldLog(settings.logLevel, 'debug')) {
		return 'debug';
	}

	return settings.logLevel;
}
