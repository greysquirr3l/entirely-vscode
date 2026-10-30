import * as vscode from 'vscode';

import type { ActivityProvider } from '../providers/activityProvider';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import { copyGenerated, generateDispatch, type DispatchDependencies } from './dispatch';
import { showRecap, type RecapDependencies } from './recap';

export interface ActivityCommandDependencies {
	readonly activity: ActivityProvider;
	readonly documents: GeneratedDocuments;
	readonly dispatch: DispatchDependencies;
	readonly recap: RecapDependencies;
}

/**
 * Registers the activity, dispatch and recap commands.
 *
 * The Activity view only reads. Generating a dispatch starts work, so it
 * is reached only by the person choosing the command, and it asks first.
 */
export function registerActivityCommands(context: vscode.ExtensionContext, deps: ActivityCommandDependencies): void {
	const showing = (listing: 'sessions' | 'commits'): Promise<void> => {
		void vscode.commands.executeCommand('setContext', 'entirely.activityListing', listing);
		return deps.activity.show(listing);
	};
	void vscode.commands.executeCommand('setContext', 'entirely.activityListing', deps.activity.listing);

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.openActivity', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.entirely');
			await vscode.commands.executeCommand('entirely.activity.focus');
			await deps.activity.refresh();
		}),
		vscode.commands.registerCommand('entirely.refreshActivity', () => deps.activity.refresh()),
		vscode.commands.registerCommand('entirely.showActivitySessions', () => showing('sessions')),
		vscode.commands.registerCommand('entirely.showActivityCommits', () => showing('commits')),
		vscode.commands.registerCommand('entirely.generateDispatch', async () => {
			await generateDispatch(deps.dispatch);
		}),
		vscode.commands.registerCommand('entirely.copyDispatch', async (target?: unknown) => {
			const uri = target instanceof vscode.Uri ? target : vscode.window.activeTextEditor?.document.uri;
			const text = (uri ? deps.documents.textOf(uri) : undefined) ?? deps.documents.latest('dispatch');
			await copyGenerated(
				text,
				'dispatch',
				{ write: value => Promise.resolve(vscode.env.clipboard.writeText(value)) },
				async message => {
					void vscode.window.showInformationMessage(message);
				},
			);
		}),
		vscode.commands.registerCommand('entirely.showRecap', async () => {
			await showRecap(deps.recap);
		}),
	);
}
