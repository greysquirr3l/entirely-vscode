import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SessionsProvider } from './providers/sessionsProvider';
import { CliRunner } from './services/cli';
import { StatusBar } from './services/statusBar';
import { StatusController } from './services/statusController';

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Entirely');
	context.subscriptions.push(output);

	const sessions = new SessionsProvider();
	context.subscriptions.push(sessions);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('entirely.sessions', sessions));

	const status = new StatusBar();
	context.subscriptions.push(status);

	const runner = new CliRunner();
	const statusController = new StatusController({ statusBar: status, runner, output });
	context.subscriptions.push(statusController);

	registerCommands(context, { sessions, statusController });

	void statusController.refresh();
}

export function deactivate(): void {}
