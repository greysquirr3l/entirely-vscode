import * as vscode from 'vscode';

import { DEFAULT_MINIMUM_CLI_VERSION } from '../lib/entire';
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
	/** How often, in seconds, the extension re-reads the CLI. */
	readonly refreshInterval: number;
	/** How long, in seconds, the CLI may take to hand over a session transcript. */
	readonly transcriptTimeout: number;
	/** How long, in milliseconds, the checkpoint filter waits after typing before it searches. */
	readonly searchDebounce: number;
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

	return {
		cliPath: cliPath.length > 0 ? cliPath : undefined,
		cliContext: cliContext.length > 0 ? cliContext : undefined,
		refreshInterval: clampRefreshInterval(configuration.get<number>('refreshInterval', 30)),
		transcriptTimeout: clampTranscriptTimeout(configuration.get<number>('transcriptTimeout', 60)),
		searchDebounce: clampSearchDebounce(configuration.get<number>('searchDebounce', 400)),
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
