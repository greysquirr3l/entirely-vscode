import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SessionsProvider } from './providers/sessionsProvider';
import { StatusBar } from './services/statusBar';

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.window.createOutputChannel('Entirely'));

	const sessions = new SessionsProvider();
	context.subscriptions.push(sessions);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('entirely.sessions', sessions));

	const status = new StatusBar();
	context.subscriptions.push(status);

	registerCommands(context, { sessions, status });
}

export function deactivate(): void {}
