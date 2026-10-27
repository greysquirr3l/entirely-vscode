import * as vscode from 'vscode';

/**
 * Watches the HEAD of each workspace's git repository.
 *
 * A normal repository keeps HEAD in `.git/HEAD`. A worktree keeps a `.git`
 * file that points at the real git directory, and its HEAD lives there, so
 * the pointer is followed rather than assumed.
 */
export function watchHeadChanges(onChange: () => void): vscode.Disposable {
	const watchers: vscode.Disposable[] = [];
	let disposed = false;

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		void resolveHeadPath(folder.uri.fsPath).then(headPath => {
			if (!headPath) {
				return;
			}

			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(vscode.Uri.file(pathDirectory(headPath)), pathBasename(headPath)),
			);
			watcher.onDidChange(onChange);
			watcher.onDidCreate(onChange);

			// The watcher is set up asynchronously, so the caller may have
			// given up on it already. Disposing it here is what keeps a
			// watcher from outliving the extension host.
			if (disposed) {
				watcher.dispose();
				return;
			}
			watchers.push(watcher);
		});
	}

	return new vscode.Disposable(() => {
		disposed = true;
		for (const watcher of watchers) {
			watcher.dispose();
		}
		watchers.length = 0;
	});
}

/** The directory holding a path. */
function pathDirectory(target: string): string {
	const index = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
	return index === -1 ? target : target.slice(0, index);
}

/** The last segment of a path. */
function pathBasename(target: string): string {
	const index = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
	return index === -1 ? target : target.slice(index + 1);
}

/**
 * Finds the HEAD file of the repository a folder belongs to.
 *
 * Returns undefined when the folder is not in a repository, or when the
 * repository cannot be read — there is nothing to watch in that case.
 */
async function resolveHeadPath(folderPath: string): Promise<string | undefined> {
	const gitUri = vscode.Uri.file(joinPath(folderPath, '.git'));

	let gitEntry: vscode.FileStat;
	try {
		gitEntry = await vscode.workspace.fs.stat(gitUri);
	} catch {
		return undefined;
	}

	if (gitEntry.type === vscode.FileType.Directory) {
		return joinPath(gitUri.fsPath, 'HEAD');
	}

	// A worktree: the .git file points at the real git directory.
	try {
		const contents = await vscode.workspace.fs.readFile(gitUri);
		const pointer = new TextDecoder().decode(contents).trim();
		const match = /^gitdir:\s*(.+)$/m.exec(pointer);
		if (!match) {
			return undefined;
		}
		return joinPath(match[1].trim(), 'HEAD');
	} catch {
		return undefined;
	}
}

/** Joins two path segments. */
function joinPath(parent: string, child: string): string {
	const separator = parent.endsWith('/') || parent.endsWith('\\') ? '' : '/';
	return `${parent}${separator}${child}`;
}
