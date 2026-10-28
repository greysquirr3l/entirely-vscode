import * as vscode from 'vscode';

import { decodeWorkspaceStatus, describeDestination, unwrap } from '../lib/entire';
import {
	inspectCheckpointDestination,
	renderCheckpointDestination,
	type CheckpointDestinationReport,
} from '../services/checkpointDestination';
import type { CliRunner } from '../services/cli';
import { readEntireSettings } from '../services/settingsSource';
import type { ReportSink } from './doctor';

/** Where the user can change which repositories the Entire GitHub App can reach. */
const APP_SETTINGS_URL = 'https://github.com/settings/installations';

/** Where the documentation explains the App's access. */
const APP_ACCESS_DOCS_URL = 'https://docs.entire.com/guides/repositories/github-app-access';

/** What the command needs to do its job. */
export interface CheckpointDestinationDependencies {
	/** The CLI the extension talks to. */
	readonly runner: CliRunner;
	/** The folder the workspace is in. */
	readonly workspaceRoot: () => string | undefined;
	/** Where the report is written. */
	readonly output: ReportSink;
	/** How the user is told what was found. */
	readonly notify?: (message: string, actions: string[]) => Promise<string | undefined>;
	/** How a warning is shown to the user. */
	readonly warn?: (message: string, actions: string[]) => Promise<string | undefined>;
	/** How a page is opened in the browser. */
	readonly openExternal?: (url: string) => Promise<boolean>;
}

/**
 * Reports where checkpoints are going, and whether Entire can reach them.
 *
 * The report is written to the channel in full, and the message says the
 * one thing that matters: whether the checkpoints this workspace records
 * can be seen by Entire at all.
 */
export async function checkpointDestination(
	deps: CheckpointDestinationDependencies,
): Promise<void> {
	const root = deps.workspaceRoot();

	const status = await deps.runner.runJson(
		['status', '--json'],
		value => unwrap(decodeWorkspaceStatus(value)),
		{ cwd: root },
	);

	if (!status.ok) {
		await vscode.window.showErrorMessage(
			`Entirely could not read the Entire CLI's status: ${status.detail}`,
		);
		return;
	}

	if (status.value.kind !== 'tracked') {
		await vscode.window.showInformationMessage(
			'Entire is not set up for this workspace, so there are no checkpoints to place.',
		);
		return;
	}

	const report = await inspectCheckpointDestination(
		deps.runner,
		root,
		status.value,
		readEntireSettings(root),
	);

	deps.output.appendLine('');
	deps.output.appendLine(renderCheckpointDestination(report));
	deps.output.show(true);

	await reportFindings(deps, report);
}

/**
 * Tells the user what was found, and offers what can be done about it.
 *
 * The offer depends on what was found: a repository the App cannot reach
 * is fixed in GitHub's own settings, and a repository that is only on this
 * machine is fixed in the settings file.
 */
async function reportFindings(
	deps: CheckpointDestinationDependencies,
	report: CheckpointDestinationReport,
): Promise<void> {
	const notify =
		deps.notify ??
		(async (message: string, actions: string[]): Promise<string | undefined> =>
			vscode.window.showInformationMessage(message, ...actions));

	const warn =
		deps.warn ??
		(async (message: string, actions: string[]): Promise<string | undefined> =>
			vscode.window.showWarningMessage(message, ...actions));

	const openExternal =
		deps.openExternal ??
		(async (url: string): Promise<boolean> => vscode.env.openExternal(vscode.Uri.parse(url)));

	if (report.checkpointRepoVisible === false) {
		const choice = await warn(report.problem ?? 'Entire cannot reach the checkpoint repository.', [
			'Open GitHub App Settings',
			'Read the Docs',
		]);

		if (choice === 'Open GitHub App Settings') {
			await openExternal(APP_SETTINGS_URL);
			return;
		}

		if (choice === 'Read the Docs') {
			await openExternal(APP_ACCESS_DOCS_URL);
		}
		return;
	}

	if (report.problem) {
		await warn(report.problem, []);
		return;
	}

	await notify(`Checkpoints are going to ${describeDestination(report.destination)}.`, []);
}
