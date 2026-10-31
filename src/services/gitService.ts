import * as vscode from 'vscode';

import { checkpointRef } from '../lib/entire';

/** The id of the git extension the VS Code build ships with. */
const GIT_EXTENSION_ID = 'vscode.git';

/** A commit, as the git extension reports one. */
export interface GitCommit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
}

/** A repository, as the git extension reports one. */
export interface GitRepository {
	readonly rootUri: vscode.Uri;
	show(ref: string, path: string): Promise<string>;
	getCommit(ref: string): Promise<GitCommit>;
	log(options?: { readonly maxEntries?: number }): Promise<GitCommit[]>;
	/** The checked-out branch. Absent on a detached head. */
	readonly state?: { readonly HEAD?: { readonly name?: string } };
	/** The branches git knows, local ones when `remote` is false. */
	getBranches?(query: { readonly remote: boolean }): Promise<{ readonly name?: string }[]>;
}

/** The part of the git extension's API the extension uses. */
interface GitApi {
	readonly repositories: GitRepository[];
	/** The repository that holds a file or folder, when the git extension offers the lookup. */
	getRepository?(uri: vscode.Uri): GitRepository | null;
}

/** The shape of the git extension's exports. */
interface GitExtensionExports {
	getAPI(version: number): GitApi;
}

/**
 * Where a checkpoint sits in git.
 *
 * A checkpoint is a commit, so it has a commit and usually a parent. The
 * parent is the state the checkpoint was taken from, and the pair is what
 * makes a diff.
 */
export interface CheckpointCommit {
	/** The ref the checkpoint is stored under. */
	readonly ref: string;
	/** The checkpoint's commit. */
	readonly commit: string;
	/** The commit before it, when it has one. */
	readonly parent?: string;
}

/**
 * A thin wrapper over the git extension.
 *
 * The extension does not run git itself: it asks the git extension, which
 * already has the repository open, and which resolves any revision git can
 * resolve — including the forge's own checkpoint refs.
 */
export class GitService {
	private constructor(private readonly api: GitApi) {}

	/**
	 * Connects to the git extension, if there is one.
	 *
	 * Returns undefined when the build has no git extension, which is the
	 * case in a web build and in a test host without one.
	 */
	static async create(): Promise<GitService | undefined> {
		const extension = vscode.extensions.getExtension<GitExtensionExports>(GIT_EXTENSION_ID);
		if (!extension) {
			return undefined;
		}

		const exports = extension.isActive ? extension.exports : await extension.activate();
		if (!exports?.getAPI) {
			return undefined;
		}

		return new GitService(exports.getAPI(1));
	}

	/** The repository that holds a folder, if there is one. */
	repositoryFor(folder: vscode.Uri | undefined): GitRepository | undefined {
		if (!folder) {
			return undefined;
		}

		return this.api.repositories.find(
			repository => repository.rootUri.fsPath === folder.fsPath,
		);
	}

	/** The root of the repository that holds a folder, which is above the folder when the workspace is a subfolder. */
	repositoryRootFor(folder: vscode.Uri | undefined): string | undefined {
		if (!folder) {
			return undefined;
		}
		return (this.api.getRepository?.(folder) ?? this.repositoryFor(folder))?.rootUri.fsPath;
	}

	/** The checked-out branch, when the repository has one. */
	currentBranch(repository: GitRepository): string | undefined {
		return repository.state?.HEAD?.name;
	}

	/** The checked-out branch and the local branches of a repository. Empty when git does not say. */
	async branches(repository: GitRepository): Promise<{ readonly current?: string; readonly local: readonly string[] }> {
		const current = repository.state?.HEAD?.name;
		let local: readonly string[] = [];
		try {
			const found = (await repository.getBranches?.({ remote: false })) ?? [];
			local = found.flatMap(branch => (typeof branch.name === 'string' && branch.name.length > 0 ? [branch.name] : []));
		} catch {
			local = [];
		}
		return { current, local };
	}

	/**
	 * Finds the commit a checkpoint was recorded as.
	 *
	 * Returns undefined when the checkpoint is not in this repository, or
	 * when the repository does not hold it — which is the case for a
	 * checkpoint that has not been fetched.
	 *
	 * A checkpoint id the CLI would not recognise has no ref, so there is
	 * nothing to look up and the answer is undefined as well.
	 */
	async findCheckpointCommit(
		repository: GitRepository,
		checkpointId: string,
	): Promise<CheckpointCommit | undefined> {
		const ref = checkpointRef(checkpointId);
		if (!ref) {
			return undefined;
		}

		try {
			const commit = await repository.getCommit(ref);
			return { ref, commit: commit.hash, parent: commit.parents[0] };
		} catch {
			return undefined;
		}
	}
}
