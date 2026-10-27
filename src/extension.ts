import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SessionDetailProvider } from './providers/sessionDetailProvider';
import { SessionsProvider } from './providers/sessionsProvider';
import { CliRunner } from './services/cli';
import { createSessionSource } from './services/sessionSource';
import { StatusBar } from './services/statusBar';
import { StatusController } from './services/statusController';

/** The workspace folder the CLI is run in. */
function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export function activate(context: vscode.ExtensionContext): void {
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

	registerCommands(context, { sessions, sessionDetail, statusController });

	void statusController.refresh();
	void sessions.refresh();
}

export function deactivate(): void {}
