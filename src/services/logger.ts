import * as vscode from 'vscode';

/** How much the extension says. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** The levels, from quietest to loudest. */
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

/** How loud a message is. */
const LEVEL_RANK: Record<LogLevel, number> = {
	error: 1,
	warn: 2,
	info: 3,
	debug: 4,
	trace: 5,
};

/** Whether a message is said at a level. */
export function shouldLog(level: LogLevel, messageLevel: LogLevel): boolean {
	return LEVEL_RANK[messageLevel] <= LEVEL_RANK[level];
}

/** Where the extension's own words go. */
export interface Logger {
	error(message: string): void;
	warn(message: string): void;
	info(message: string): void;
	debug(message: string): void;
	trace(message: string): void;
}

/**
 * Builds a logger that writes to the extension's output channel.
 *
 * The level is read every time a message is said, so a change to the
 * setting takes effect at once and without a window reload.
 */
export function createLogger(
	channel: vscode.OutputChannel,
	level: () => LogLevel,
): Logger {
	const say = (messageLevel: LogLevel, message: string): void => {
		if (!shouldLog(level(), messageLevel)) {
			return;
		}
		channel.appendLine(`[${messageLevel}] ${message}`);
	};

	return {
		error: message => say('error', message),
		warn: message => say('warn', message),
		info: message => say('info', message),
		debug: message => say('debug', message),
		trace: message => say('trace', message),
	};
}

/**
 * Reads the log level out of a configuration value.
 *
 * A value the extension does not recognise is read as the quietest
 * setting that still says something, rather than as a reason to fail.
 */
export function readLogLevel(value: unknown): LogLevel {
	if (typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)) {
		return value as LogLevel;
	}
	return 'info';
}
