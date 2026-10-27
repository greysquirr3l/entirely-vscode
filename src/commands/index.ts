import * as vscode from 'vscode';
import type { SessionsProvider } from '../providers/sessionsProvider';
import type { StatusBar } from '../services/statusBar';

/** The surfaces the command handlers act on. */
export interface CommandDependencies {
	readonly sessions: SessionsProvider;
	readonly status: StatusBar;
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
		vscode.commands.registerCommand('entirely.refresh', () => {
			deps.status.refresh();
			deps.sessions.refresh();
		}),

		vscode.commands.registerCommand('entirely.showSessions', async () => {
			await vscode.commands.executeCommand('workbench.view.entirely');
			await vscode.commands.executeCommand('entirely.sessions.focus');
		}),

		vscode.commands.registerCommand('entirely.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
		}),
	);
}
