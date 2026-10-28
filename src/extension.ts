import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { decodeWorkspaceStatus, unwrap, type WorkspaceStatus } from './lib/entire';
import { CheckpointsProvider } from './providers/checkpointsProvider';
import { SessionDetailProvider } from './providers/sessionDetailProvider';
import { SessionsProvider } from './providers/sessionsProvider';
import { CliInvocationRecorder, CliRunner } from './services/cli';
import { readExtensionSettings, effectiveLogLevel } from './services/configuration';
import {
	createCheckpointDetailSource,
	createCheckpointSource,
} from './services/checkpointSource';
import { CliInvocationLogger } from './services/cliLogging';
import { GitService } from './services/gitService';
import { HookBridge } from './services/hookBridge';
import {
	INSTALL_COMMAND,
	INSTALL_DOCS,
	OnboardingPrompt,
	detectFault,
	type OnboardingAction,
	type WorkspaceFault,
} from './services/onboarding';
import { isGitRepository } from './services/repository';
import { enableEntire } from './services/setup';
import { createSessionSource } from './services/sessionSource';
import { createLogger } from './services/logger';
import { StatusBar } from './services/statusBar';
import { StatusController } from './services/statusController';
import { onTerminalPath } from './services/terminalPath';
import { WhyService } from './services/whyService';

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

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// One channel for everything the extension says: what it asked the CLI
	// to do, what came back, and what went wrong.
	const output = vscode.window.createOutputChannel('Entire');
	context.subscriptions.push(output);

	const runner = new CliRunner();

	// The path the user gave for the CLI is applied before anything is
	// read, so the very first look uses the binary they chose.
	runner.setConfiguredPath(readExtensionSettings().cliPath);

	const log = createLogger(output, () => effectiveLogLevel(readExtensionSettings()));

	// Every CLI invocation is reported to the channel, and remembered, so
	// that the doctor can say what went wrong even when the failure was
	// swallowed by the tree that could not be filled.
	const recorder = new CliInvocationRecorder();
	runner.setSink(new CliInvocationLogger(log, recorder));

	const status = new StatusBar();
	context.subscriptions.push(status);

	const hooks = new HookBridge({
		runner,
		workspaceRoot,
		log: line => log.debug(`hook ${line}`),
	});

	const statusController = new StatusController({ statusBar: status, runner, output, hooks });
	context.subscriptions.push(statusController);

	const sessions = new SessionsProvider(createSessionSource(runner, workspaceRoot), () =>
		readExtensionSettings().refreshInterval,
	);
	context.subscriptions.push(sessions);

	const sessionDetail = new SessionDetailProvider();
	context.subscriptions.push(sessionDetail);

	const checkpoints = new CheckpointsProvider(
		createCheckpointSource(runner, workspaceRoot),
		createCheckpointDetailSource(runner, workspaceRoot),
		() => readExtensionSettings().refreshInterval,
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

	// The same session tree, shown in the Explorer as well, for the users
	// who want to see it next to the source control views.
	const explorerSessionsView = vscode.window.createTreeView('entirely.explorerSessions', {
		treeDataProvider: sessions,
	});
	context.subscriptions.push(explorerSessionsView);

	// The tree view shows a message in place of the sessions when there is
	// a reason the tree is empty.
	context.subscriptions.push(
		sessions.onDidChangeTreeData(() => {
			sessionsView.message = sessions.emptyReason;
			explorerSessionsView.message = sessions.emptyReason;
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
				onTerminalPath:
					discovery.state === 'available'
						? onTerminalPath(discovery.directory, process.platform)
						: true,
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
					await enableEntire(runner, folder);
					await statusController.refresh();
					return;

				case 'repair-path':
					await vscode.commands.executeCommand('entirely.repairTerminalPath');
					return;
			}
		},
	});
	context.subscriptions.push({ dispose: () => void onboarding });

	void onboarding.offer();

	const why = new WhyService({ runner, workspaceRoot });

	registerCommands(context, {
		sessions,
		sessionDetail,
		checkpoints,
		statusController,
		git,
		workspaceFolder,
		why,
		runner,
		checkpointDetail: createCheckpointDetailSource(runner, workspaceRoot),
		recorder,
		output,
	});

	// A setting that changes takes effect at once, without a window reload.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('entirely.refreshInterval')) {
				sessions.reschedule();
				checkpoints.reschedule();
			}

			if (event.affectsConfiguration('entirely.cliPath')) {
				runner.setConfiguredPath(readExtensionSettings().cliPath);
				void statusController.refresh();
				void sessions.refresh();
				void checkpoints.refresh();
			}
		}),
	);

	void statusController.refresh();
	void sessions.refresh();
	void checkpoints.refresh();
}

export function deactivate(): void {}
