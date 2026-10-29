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
}

/** The part of the git extension's API the extension uses. */
interface GitApi {
	readonly repositories: GitRepository[];
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
