import * as vscode from 'vscode';

import type { UnsavedFile } from '../lib/entire';

/**
 * The files the editor holds open with unsaved changes.
 *
 * The editor is the only thing that knows about a buffer that was
 * never written to disk, so it is the editor that is asked. An untitled
 * buffer or a virtual document is not a file in the working tree, and a
 * file outside the workspace is not in the repository, so neither can
 * be lost by something that changes the working tree.
 */
export function unsavedFiles(): UnsavedFile[] {
	const files: UnsavedFile[] = [];

	for (const document of vscode.workspace.textDocuments) {
		if (!document.isDirty || document.isUntitled || document.uri.scheme !== 'file') {
			continue;
		}

		if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
			continue;
		}

		const name = vscode.workspace.asRelativePath(document.uri, false);

		files.push({ path: document.uri.fsPath, name });
	}

	return files;
}
