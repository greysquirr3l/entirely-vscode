import * as path from 'path';
import * as vscode from 'vscode';

import type { CheckpointFileNode } from '../providers/checkpointsProvider';
import type { GitService } from '../services/gitService';

/**
 * Builds a URI that reads a file as it was at a git revision.
 *
 * The git extension serves the `git` scheme, so the diff editor can open
 * both sides of a change without either side ever being written to disk.
 */
export function gitUri(filePath: string, ref: string): vscode.Uri {
	return vscode.Uri.file(filePath).with({
		scheme: 'git',
		query: JSON.stringify({ path: filePath, ref }),
	});
}

/**
 * Opens the difference a checkpoint made to one file.
 *
 * A checkpoint is a commit, so the difference is between that commit and
 * the one before it. When the checkpoint is not in this repository there is
 * nothing to compare, and that is said rather than shown as an empty diff.
 */
export async function openCheckpointFile(
	node: CheckpointFileNode,
	git: GitService | undefined,
	workspaceFolder: vscode.Uri | undefined,
): Promise<void> {
	if (!git) {
		await vscode.window.showErrorMessage(
			'Entirely needs the built-in git extension to show a checkpoint diff.',
		);
		return;
	}

	const repository = git.repositoryFor(workspaceFolder);
	if (!repository) {
		await vscode.window.showErrorMessage(
			'Entirely could not find the git repository for this workspace.',
		);
		return;
	}

	const commit = await git.findCheckpointCommit(repository, node.checkpoint.id);
	if (!commit) {
		await vscode.window.showInformationMessage(
			`Checkpoint ${node.checkpoint.id} is not in this repository, so there is no diff to show.`,
			'Explain Checkpoint',
		);
		return;
	}

	if (!commit.parent) {
		await vscode.window.showInformationMessage(
			`Checkpoint ${node.checkpoint.id} has nothing before it to compare against.`,
		);
		return;
	}

	const filePath = path.join(repository.rootUri.fsPath, node.path);
	const title = `${node.checkpoint.id}: ${node.path}`;

	await vscode.commands.executeCommand(
		'vscode.diff',
		gitUri(filePath, commit.parent),
		gitUri(filePath, commit.commit),
		title,
	);
}
