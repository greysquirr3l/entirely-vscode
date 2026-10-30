import * as vscode from 'vscode';

import { planBlameMarks } from '../lib/entire';
import { WhyPanel } from '../providers/whyPanel';
import type { BlameDecorations } from '../providers/blameDecorations';
import type { BlameService } from '../services/blameService';

/** What the command needs to do its job. */
export interface BlameCommandDependencies {
	readonly blame: BlameService;
	readonly decorations: BlameDecorations;
	/** The most lines the editor will be marked on. */
	readonly maxDecoratedLines: () => number;
}

/**
 * Blames the active file.
 *
 * Runs once, when asked. The attribution is drawn beside each line and the
 * whole-file answer opens in the same panel the single-line answer uses.
 *
 * `entire blame` reads the committed file, so an unsaved buffer would be
 * marked against the wrong line numbers. The command offers to save first
 * and does nothing otherwise.
 */
export async function blameFile(deps: BlameCommandDependencies): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		await vscode.window.showInformationMessage('Entirely could not blame the file: there is no open file.');
		return;
	}

	const document = editor.document;
	if (document.uri.scheme !== 'file') {
		await vscode.window.showInformationMessage('Entirely can only blame a file that is saved on disk.');
		return;
	}

	if (document.isDirty) {
		const choice = await vscode.window.showWarningMessage(
			'This file has unsaved changes. Blame reads the saved file, so its line numbers would not match the editor.',
			'Save and Blame',
		);
		if (choice !== 'Save and Blame' || !(await document.save())) {
			return;
		}
	}

	const versionAtStart = document.version;
	const result = await deps.blame.blameFile(document.uri.fsPath);

	// An edit made while the CLI was working has moved the lines, so the
	// answer no longer fits the buffer. Drawing it would mark the wrong lines.
	if (result.kind === 'answered' && document.version !== versionAtStart) {
		await vscode.window.showInformationMessage(
			'The file changed while blame was running, so the marks were not drawn. Save it and blame again.',
		);
		return;
	}

	switch (result.kind) {
		case 'answered': {
			const plan = planBlameMarks(result.answer, deps.maxDecoratedLines());
			if (plan.kind === 'marks') {
				deps.decorations.apply(editor, plan.marks);
			} else {
				deps.decorations.clearEditor(editor);
				await vscode.window.showInformationMessage(
					`This file has ${plan.lines} lines, more than the ${plan.limit} that blame is drawn on. The answer is in the panel; raise entirely.blameMaxDecoratedLines to draw it in the editor.`,
				);
			}
			WhyPanel.show(result.answer);
			return;
		}

		case 'outside-workspace':
			await vscode.window.showInformationMessage(
				`Entirely can only blame files in the workspace, and ${result.file} is outside it.`,
			);
			return;

		case 'cli-missing':
			await vscode.window.showErrorMessage(
				'Entirely could not blame the file because the Entire CLI is not installed.',
			);
			return;

		case 'failed':
			await vscode.window.showErrorMessage(`Entirely could not blame the file: ${result.detail}`);
			return;
	}
}

/** Removes the blame marks from the active file. */
export function clearBlame(decorations: BlameDecorations): void {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		decorations.clearEditor(editor);
	}
}
