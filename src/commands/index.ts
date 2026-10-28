import * as vscode from 'vscode';
import { doctor } from './doctor';
import { dumpCliOutput } from './dumpCliOutput';
import { openCheckpointFile } from './openCheckpoint';
import { repairTerminalPath } from './terminalPath';
import { explainCheckpoint, whyThisLine } from './whyThisLine';
import type { CheckpointFileNode, CheckpointsProvider } from '../providers/checkpointsProvider';
import type { SessionDetailProvider } from '../providers/sessionDetailProvider';
import type { SessionItemNode, SessionsProvider } from '../providers/sessionsProvider';
import type { CheckpointDetail } from '../lib/entire';
import type { GitService } from '../services/gitService';
import type { StatusController } from '../services/statusController';
import type { CliRunner } from '../services/cli';
import type { CliInvocationRecorder } from '../services/cli/recorder';
import type { WhyService } from '../services/whyService';

/** The surfaces the command handlers act on. */
export interface CommandDependencies {
	readonly sessions: SessionsProvider;
	readonly sessionDetail: SessionDetailProvider;
	readonly checkpoints: CheckpointsProvider;
	readonly statusController: StatusController;
	readonly git: GitService | undefined;
	readonly workspaceFolder: () => vscode.Uri | undefined;
	readonly why: WhyService;
	/** The CLI the extension talks to. */
	readonly runner: CliRunner;
	/** Reads one checkpoint's story. */
	readonly checkpointDetail: (id: string) => Promise<CheckpointDetail | undefined>;
	/** What the CLI has been asked to do so far. */
	readonly recorder: CliInvocationRecorder;
	/** Where the extension's one log is written. */
	readonly output: vscode.OutputChannel;
}

const EXTENSION_ID = 'greysquirr3l.entirely';

/**
 * Registers every command the manifest contributes.
 *
 * The manifest and this list must agree: the smoke test asserts that every
 * contributed command is registered, so a command added to `package.json`
 * without a handler here fails the suite.
 */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDependencies): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.refresh', async () => {
			await deps.statusController.refresh();
			await deps.sessions.refresh();
			await deps.checkpoints.refresh();
		}),

		// The view container is registered by VS Code under
		// `workbench.view.extension.<id>`. The plain `workbench.view.<id>`
		// form is not a command, and asking for it fails with
		// "command not found".
		vscode.commands.registerCommand('entirely.showSessions', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.entirely');
			await vscode.commands.executeCommand('entirely.sessions.focus');
		}),

		// The status bar item's own command. It routes on the current state
		// rather than doing one thing, so it is hidden from the palette and
		// reached by clicking the item.
		vscode.commands.registerCommand('entirely.statusBar', async () => {
			await deps.statusController.handleClick();
		}),

		vscode.commands.registerCommand('entirely.setUp', async () => {
			await deps.statusController.offerToSetUp();
		}),

		vscode.commands.registerCommand('entirely.selectSession', (element: SessionItemNode) => {
			deps.sessions.select(element);
			deps.sessionDetail.show(element?.session);
		}),

		vscode.commands.registerCommand('entirely.openCheckpointFile', async (element: CheckpointFileNode) => {
			await openCheckpointFile(element, deps.git, deps.workspaceFolder());
		}),

		vscode.commands.registerCommand('entirely.repairTerminalPath', async () => {
			await repairTerminalPath({ runner: deps.runner });
		}),

		vscode.commands.registerCommand('entirely.whyThisLine', async () => {
			await whyThisLine({
				why: deps.why,
				checkpointDetail: deps.checkpointDetail,
			});
		}),

		// The drill-down from a line that a checkpoint owns. It is reached
		// from the panel, so it is not in the palette.
		vscode.commands.registerCommand('entirely.explainCheckpoint', async (id: string) => {
			await explainCheckpoint(
				{
					why: deps.why,
					checkpointDetail: deps.checkpointDetail,
				},
				id,
			);
		}),

		vscode.commands.registerCommand('entirely.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
		}),

		// The report a user pastes into an issue when something is not
		// working. It is a command rather than a view because it is
		// something to copy, not something to look at.
		vscode.commands.registerCommand('entirely.doctor', async () => {
			await doctor({
				runner: deps.runner,
				recorder: deps.recorder,
				workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				output: deps.output,
			});
		}),

		// The full output of the last CLI invocation. It is behind an
		// explicit command because it is the user's own content.
		vscode.commands.registerCommand('entirely.dumpCliOutput', async () => {
			await dumpCliOutput({
				recorder: deps.recorder,
				output: deps.output,
			});
		}),
	);
}
