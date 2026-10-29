import * as vscode from 'vscode';

import {
	decodeWorkspaceStatus,
	summariseSettings,
	unwrap,
	type WorkspaceStatus,
} from '../lib/entire';
import type { CliRunner } from '../services/cli';
import type { CliInvocationRecorder } from '../services/cli/recorder';
import type { AccountContextReading, AccountContextService } from '../services/accountContext';
import {
	inspectCheckpointDestination,
	type CheckpointDestinationReport,
} from '../services/checkpointDestination';
import { readExtensionSettings } from '../services/configuration';
import { renderDoctorReport, type DoctorFacts } from '../services/doctorReport';
import { isGitRepository } from '../services/repository';
import { readEntireSettings } from '../services/settingsSource';

/** The id the extension is published under. */
const EXTENSION_ID = 'greysquirr3l.entirely';

/**
 * How the acting login reaches the CLI.
 *
 * The flag is inherited by the CLI's own commands, and the environment
 * variable is what reaches the plugin commands and the processes the CLI
 * spawns, so both are set.
 */
const CONTEXT_MECHANISM =
	'--context flag on CLI commands, ENTIRE_CONTEXT environment variable for hooks and plugin commands';

/** Where the report is written. */
export interface ReportSink {
	appendLine(line: string): void;
	show(preserveFocus?: boolean): void;
}

/** What the doctor command needs to do its job. */
export interface DoctorDependencies {
	/** The CLI the extension talks to. */
	readonly runner: CliRunner;
	/** Which login the CLI is acting as. */
	readonly accounts: AccountContextService;
	/** What the CLI has been asked to do so far. */
	readonly recorder: CliInvocationRecorder;
	/** The folder the workspace is in. */
	readonly workspaceRoot: () => string | undefined;
	/** Where the report is written. */
	readonly output: ReportSink;
	/** How the user is told that the report is ready. */
	readonly notify?: (message: string, actions: string[]) => Promise<string | undefined>;
	/** How the report is copied to the clipboard. */
	readonly copy?: (text: string) => Promise<void>;
}

/** The version of the extension, when the editor can say. */
function extensionVersion(): string | undefined {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);

	if (!extension) {
		return undefined;
	}

	const manifest = extension.packageJSON as { version?: unknown };

	return typeof manifest.version === 'string' ? manifest.version : undefined;
}

/**
 * Gathers what the report is made of.
 *
 * Every reading here is allowed to fail: a CLI that is missing, a
 * workspace that cannot be read and a status that cannot be decoded are
 * all facts about the user's setup, and the report says so rather than
 * falling over.
 */
async function collectFacts(deps: DoctorDependencies): Promise<DoctorFacts> {
	const root = deps.workspaceRoot();
	const discovery = await deps.runner.discover();

	let status: WorkspaceStatus | undefined;
	let statusError: string | undefined;
	let accountContext: AccountContextReading | undefined;

	if (discovery.state === 'available') {
		// The login is read first, because every command after this has
		// to act as the right one.
		accountContext = await deps.accounts.refresh(root);

		const result = await deps.runner.runJson(
			['status', '--json'],
			value => unwrap(decodeWorkspaceStatus(value)),
			{ cwd: root },
		);

		if (result.ok) {
			status = result.value;
		} else {
			statusError = result.detail;
		}
	}

	const settings = readExtensionSettings();
	const failure = deps.recorder.lastFailure();
	const entireSettings = readEntireSettings(root);

	let checkpointDestination: CheckpointDestinationReport | undefined;
	if (status && status.kind === 'tracked') {
		checkpointDestination = await inspectCheckpointDestination(
			deps.runner,
			root,
			status,
			entireSettings,
		);
	}

	return {
		generatedAt: new Date(),
		extensionVersion: extensionVersion(),
		editorVersion: vscode.version,
		platform: `${process.platform} (${process.arch})`,
		discovery,
		status,
		statusError,
		isRepository: isGitRepository(root),
		workspaceRoot: root,
		settings: summariseSettings(entireSettings),
		logLevel: settings.logLevel,
		debug: settings.debug,
		configuredPath: settings.cliPath,
		minimumCliVersion: settings.minimumCliVersion,
		failure,
		checkpointDestination,
		accountContext,
		contextMechanism: CONTEXT_MECHANISM,
	};
}

/**
 * Answers "why is this not working?".
 *
 * The report is written to the channel and offered for copying, because a
 * user who is asking this question is usually about to paste the answer
 * into an issue.
 */
export async function doctor(deps: DoctorDependencies): Promise<void> {
	const facts = await collectFacts(deps);
	const report = renderDoctorReport(facts);

	deps.output.appendLine('');
	deps.output.appendLine(report);
	deps.output.show(true);

	const notify =
		deps.notify ??
		(async (message: string, actions: string[]): Promise<string | undefined> =>
			vscode.window.showInformationMessage(message, ...actions));

	const choice = await notify('The Entirely doctor report is ready.', ['Copy to Clipboard']);

	if (choice !== 'Copy to Clipboard') {
		return;
	}

	const copy =
		deps.copy ??
		(async (text: string): Promise<void> => {
			await vscode.env.clipboard.writeText(text);
		});

	await copy(report);
	await notify('The Entirely doctor report was copied to the clipboard.', []);
}
