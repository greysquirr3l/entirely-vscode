import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { decodeWorkspaceStatus, unwrap, type WorkspaceStatus } from './lib/entire';
import { CheckpointsProvider } from './providers/checkpointsProvider';
import { SessionDetailProvider } from './providers/sessionDetailProvider';
import { SessionsProvider } from './providers/sessionsProvider';
import { CliRunner } from './services/cli';
import {
	createCheckpointDetailSource,
	createCheckpointSource,
} from './services/checkpointSource';
import { GitService } from './services/gitService';
import {
	INSTALL_COMMAND,
	INSTALL_DOCS,
	OnboardingPrompt,
	detectFault,
	type OnboardingAction,
	type WorkspaceFault,
} from './services/onboarding';
import { enableEntire } from './services/setup';
import { createSessionSource } from './services/sessionSource';
import { StatusBar } from './services/statusBar';
import { StatusController } from './services/statusController';

/** The workspace folder the CLI is run in. */
function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The workspace folder the git repository is found in. */
function workspaceFolder(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Reads the workspace's tracking state, when the CLI can be asked. */
async function readWorkspaceStatus(
	runner: CliRunner,
	folder: string,
): Promise<WorkspaceStatus | undefined> {
	const result = await runner.runJson(
		['status', '--json'],
		value => unwrap(decodeWorkspaceStatus(value)),
		{ cwd: folder },
	);

	return result.ok ? result.value : undefined;
}

/** Whether a folder is a git repository. */
function isGitRepository(folder: string | undefined): boolean {
	if (!folder) {
		return false;
	}

	try {
		return fs.existsSync(path.join(folder, '.git'));
	} catch {
		return false;
	}
}

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('Entirely');
	context.subscriptions.push(output);

	const runner = new CliRunner();

	const status = new StatusBar();
	context.subscriptions.push(status);

	const statusController = new StatusController({ statusBar: status, runner, output });
	context.subscriptions.push(statusController);

	const sessions = new SessionsProvider(createSessionSource(runner, workspaceRoot), () =>
		vscode.workspace.getConfiguration('entirely').get<number>('refreshInterval', 30),
	);
	context.subscriptions.push(sessions);

	const sessionDetail = new SessionDetailProvider();
	context.subscriptions.push(sessionDetail);

	const checkpoints = new CheckpointsProvider(
		createCheckpointSource(runner, workspaceRoot),
		createCheckpointDetailSource(runner, workspaceRoot),
		() => vscode.workspace.getConfiguration('entirely').get<number>('refreshInterval', 30),
	);
	context.subscriptions.push(checkpoints);

	const checkpointsView = vscode.window.createTreeView('entirely.checkpoints', {
		treeDataProvider: checkpoints,
	});
	context.subscriptions.push(checkpointsView);

	const sessionsView = vscode.window.createTreeView('entirely.sessions', {
		treeDataProvider: sessions,
	});
	context.subscriptions.push(sessionsView);

	const detailView = vscode.window.createTreeView('entirely.sessionDetail', {
		treeDataProvider: sessionDetail,
	});
	context.subscriptions.push(detailView);

	// The tree view shows a message in place of the sessions when there is
	// a reason the tree is empty.
	context.subscriptions.push(
		sessions.onDidChangeTreeData(() => {
			sessionsView.message = sessions.emptyReason;
		}),
	);

	context.subscriptions.push(
		checkpoints.onDidChangeTreeData(() => {
			checkpointsView.message = checkpoints.emptyReason;
		}),
	);

	const git = await GitService.create();

	const onboarding = new OnboardingPrompt({
		state: context.globalState,
		folders: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
		detect: async (folder: string): Promise<WorkspaceFault> => {
			const discovery = await runner.discover();
			const status = await readWorkspaceStatus(runner, folder);
			return detectFault({
				cli: discovery,
				status,
				isRepository: isGitRepository(folder),
			});
		},
		run: async (action: OnboardingAction, folder: string): Promise<void> => {
			switch (action.kind) {
				case 'install':
					await vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOCS));
					await vscode.window.showInformationMessage(
						`Install the Entire CLI with: ${INSTALL_COMMAND}`,
					);
					return;

				case 'enable':
					await enableEntire(runner, folder, output);
					await statusController.refresh();
					return;

				case 'repair-path':
					await vscode.commands.executeCommand(
						'workbench.action.openSettings',
						'terminal.integrated.env',
					);
					return;
			}
		},
	});
	context.subscriptions.push({ dispose: () => void onboarding });

	void onboarding.offer();

	registerCommands(context, {
		sessions,
		sessionDetail,
		checkpoints,
		statusController,
		git,
		workspaceFolder,
	});

	void statusController.refresh();
	void sessions.refresh();
	void checkpoints.refresh();
}

export function deactivate(): void {}
