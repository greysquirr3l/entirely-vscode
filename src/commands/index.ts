import * as vscode from 'vscode';
import type { SessionDetailProvider } from '../providers/sessionDetailProvider';
import type { SessionItemNode, SessionsProvider } from '../providers/sessionsProvider';
import type { StatusController } from '../services/statusController';

/** The surfaces the command handlers act on. */
export interface CommandDependencies {
	readonly sessions: SessionsProvider;
	readonly sessionDetail: SessionDetailProvider;
	readonly statusController: StatusController;
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
		}),

		vscode.commands.registerCommand('entirely.showSessions', async () => {
			await vscode.commands.executeCommand('workbench.view.entirely');
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

		vscode.commands.registerCommand('entirely.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
		}),
	);
}
