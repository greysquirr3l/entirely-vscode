import * as vscode from 'vscode';

import { readLogLevel, type LogLevel } from './logger';

/** The extension's own settings. */
export interface ExtensionSettings {
	/** The path the user gave for the CLI, when they gave one. */
	readonly cliPath?: string;
	/** How often, in seconds, the extension re-reads the CLI. */
	readonly refreshInterval: number;
	/** Whether the sessions tree is also shown in the Explorer. */
	readonly showSessionsInExplorer: boolean;
	/** How much the extension says. */
	readonly logLevel: LogLevel;
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

	return {
		cliPath: cliPath.length > 0 ? cliPath : undefined,
		refreshInterval: configuration.get<number>('refreshInterval', 30),
		showSessionsInExplorer: configuration.get<boolean>('showSessionsInExplorer', false),
		logLevel: readLogLevel(configuration.get<string>('logLevel', 'info')),
	};
}
