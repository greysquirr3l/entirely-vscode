import * as vscode from 'vscode';

import type { CheckpointFilter } from '../services/checkpointFilter';

/**
 * Opens the filter box. The tree narrows as the user types; the filter
 * stays applied when the box is accepted or dismissed, until it is cleared.
 */
export function searchCheckpoints(filter: CheckpointFilter): vscode.InputBox {
	const box = vscode.window.createInputBox();
	box.title = 'Search checkpoints';
	box.prompt = 'What was the checkpoint about? The Entire CLI searches as you type.';
	box.ignoreFocusOut = true;
	if (filter.text !== undefined) {
		box.value = filter.text;
	}

	box.onDidChangeValue(value => filter.setQuery(value));
	box.onDidAccept(() => box.hide());
	box.onDidHide(() => box.dispose());
	box.show();
	return box;
}

/** Removes the filter and shows the whole list again. */
export function clearCheckpointSearch(filter: CheckpointFilter): void {
	filter.clear();
}
