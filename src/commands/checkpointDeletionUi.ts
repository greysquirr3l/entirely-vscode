import * as vscode from 'vscode';

import type { DeleteScope, DeletionConfirmation } from '../lib/entire/checkpointDeletion';
import type { Checkpoint } from '../lib/entire/types';
import { describeCheckpoint } from '../providers/checkpointsProvider';
import type { CheckpointDeletionUi, ScopeChoice } from './checkpointDeletion';

/** The choices a person is offered, as the picker shows them. */
interface ScopePick extends vscode.QuickPickItem {
	readonly scope: DeleteScope;
}

/**
 * The deletion command's questions, asked in the editor.
 *
 * The scope picker has no item picked to begin with: the two choices reach
 * different places, so one of them being the default would be a default
 * the user never made.
 */
export class EditorCheckpointDeletionUi implements CheckpointDeletionUi {
	async confirm(prompt: DeletionConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			{ modal: true, detail: prompt.detail },
			prompt.action,
		);
		return choice === prompt.action;
	}

	async chooseCheckpoint(
		title: string,
		checkpoints: readonly Checkpoint[],
	): Promise<Checkpoint | undefined> {
		if (checkpoints.length === 0) {
			await this.inform('There is no checkpoint for this to act on.');
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(
			checkpoints.map(checkpoint => ({
				label: checkpoint.id,
				description: describeCheckpoint(checkpoint),
				detail: checkpoint.message,
				checkpoint,
			})),
			{ title, matchOnDetail: true, ignoreFocusOut: true },
		);
		return picked?.checkpoint;
	}

	async chooseScope(title: string, choices: readonly ScopeChoice[]): Promise<DeleteScope | undefined> {
		const picked = await vscode.window.showQuickPick(
			choices.map((choice: ScopePick) => ({
				label: choice.label,
				description: choice.description,
				scope: choice.scope,
			})),
			{ title, ignoreFocusOut: true },
		);
		return picked?.scope;
	}

	async typeToConfirm(id: string): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Confirm by typing the checkpoint id',
				prompt: `Type ${id} to delete it everywhere. Press Escape to stop.`,
				ignoreFocusOut: true,
				validateInput: value => (value.trim() === id ? undefined : `Type ${id} exactly.`),
			}),
		);
	}

	async withProgress<T>(title: string, work: () => Promise<T>): Promise<T> {
		return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, work);
	}

	// A message with no buttons settles only when it is dismissed, so the
	// command is not held open waiting for that.
	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}
}
