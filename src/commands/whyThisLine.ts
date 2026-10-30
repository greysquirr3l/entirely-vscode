import * as vscode from 'vscode';

import { parseRequestedLine, type CheckpointDetail } from '../lib/entire';
import { WhyPanel } from '../providers/whyPanel';
import type { WhyService } from '../services/whyService';

/** What the command needs to do its job. */
export interface WhyCommandDependencies {
	readonly why: WhyService;
	/** Reads one checkpoint's story. */
	readonly checkpointDetail: (id: string) => Promise<CheckpointDetail | undefined>;
}

/**
 * Answers why the line under the cursor is the way it is.
 *
 * The question is put to the CLI's own `why` command, so the answer says
 * the same thing here as it does in the CLI and on the web. A line number
 * may be given (the blame hover does); without one the cursor line is used.
 */
export async function whyThisLine(deps: WhyCommandDependencies, requestedLine?: unknown): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		await vscode.window.showInformationMessage(
			'Entirely could not tell why the line exists: there is no open file.',
		);
		return;
	}

	const file = editor.document.uri.fsPath;
	// The blame hover passes the line it was drawn on. Anything that is
	// not a positive whole number falls back to the cursor.
	const line = parseRequestedLine(requestedLine) ?? editor.selection.active.line + 1;

	const result = await deps.why.explainLine(file, line);

	switch (result.kind) {
		case 'answered':
			WhyPanel.show(result.answer);
			return;

		case 'outside-workspace':
			await vscode.window.showInformationMessage(
				`Entirely can only explain files in the workspace, and ${result.file} is outside it.`,
			);
			return;

		case 'failed':
			await vscode.window.showErrorMessage(
				`Entirely could not explain the line: ${result.detail}`,
			);
			return;
	}
}

/**
 * Shows the story of a checkpoint.
 *
 * This is the drill-down from a line that a checkpoint owns.
 */
export async function explainCheckpoint(
	deps: WhyCommandDependencies,
	id: string,
): Promise<void> {
	if (!id) {
		return;
	}

	const detail = await deps.checkpointDetail(id);
	if (!detail) {
		await vscode.window.showErrorMessage(
			`Entirely could not read the checkpoint ${id}.`,
		);
		return;
	}

	WhyPanel.showCheckpoint(detail);
}
