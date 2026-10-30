import * as vscode from 'vscode';

import { normaliseQuery, resolveInRoot } from '../lib/entire';
import type { SearchProvider, SearchTarget } from '../providers/searchProvider';
import type { SessionItemNode } from '../providers/sessionsProvider';

/** Asks for a query and runs the search in the Search view. */
export async function searchWork(search: SearchProvider, query?: unknown): Promise<void> {
	const given = typeof query === 'string' ? normaliseQuery(query) : undefined;
	const text =
		given ??
		normaliseQuery(
			(await vscode.window.showInputBox({
				title: 'Search past agent work and code',
				prompt: 'Describe what you are looking for. The Entire CLI searches sessions, commits, checkpoints and files.',
				value: search.lastQuery,
				ignoreFocusOut: true,
			})) ?? '',
		);
	if (text === undefined) {
		return;
	}

	await vscode.commands.executeCommand('entirely.search.focus');
	await search.run(text);
}

/** What opening a result needs from the rest of the extension. */
export interface OpenResultDependencies {
	/** The folders a result's file may be in. */
	readonly roots: () => readonly string[];
	/** Finds a tracked session by id. */
	readonly findSession: (id: string) => Promise<SessionItemNode | undefined>;
	/** Shows a session in the session views. */
	readonly showSession: (node: SessionItemNode) => Promise<void>;
	/** Shows the story of a checkpoint. */
	readonly explainCheckpoint: (id: string) => Promise<void>;
}

export type OpenResult =
	| { readonly kind: 'opened-file'; readonly path: string }
	| { readonly kind: 'opened-session' }
	| { readonly kind: 'opened-checkpoint' }
	| { readonly kind: 'described' }
	| { readonly kind: 'not-here'; readonly detail: string };

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function openFile(deps: OpenResultDependencies, target: Extract<SearchTarget, { kind: 'file' }>): Promise<OpenResult> {
	const { file } = target;
	if (!target.local) {
		const detail = `${file.path} is in ${file.repo ?? 'another repository'}, which is not open in this window.`;
		void vscode.window.showInformationMessage(detail);
		return { kind: 'not-here', detail };
	}

	for (const root of deps.roots()) {
		const resolved = resolveInRoot(root, file.path);
		if (resolved === undefined) {
			continue;
		}
		const uri = vscode.Uri.file(resolved);
		if (!(await exists(uri))) {
			continue;
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const line = Math.max(0, (file.line ?? 1) - 1);
		const column = Math.max(0, (file.column ?? 1) - 1);
		const position = new vscode.Position(line, column);
		await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
		return { kind: 'opened-file', path: resolved };
	}

	const detail = `${file.path} is not in this workspace. The search indexes the repository's pushed code, so the file may be on another branch or deleted.`;
	void vscode.window.showInformationMessage(detail);
	return { kind: 'not-here', detail };
}

async function openHit(deps: OpenResultDependencies, target: Extract<SearchTarget, { kind: 'hit' }>): Promise<OpenResult> {
	const { hit } = target;
	const where = hit.repo ? ` in ${hit.repo}` : '';

	if (hit.kind === 'session' && target.local) {
		const node = await deps.findSession(hit.id);
		if (node) {
			await deps.showSession(node);
			return { kind: 'opened-session' };
		}
		const detail = `Session ${hit.id} is not tracked in this workspace.`;
		void vscode.window.showInformationMessage(detail);
		return { kind: 'not-here', detail };
	}

	if (hit.kind === 'checkpoint' && target.local) {
		await deps.explainCheckpoint(hit.id);
		return { kind: 'opened-checkpoint' };
	}

	const label = hit.kind === 'other' ? hit.typeName : hit.kind;
	const description = `This ${label}${where}${hit.branch ? ` on ${hit.branch}` : ''}: ${hit.title ?? hit.id}`;
	const copy = hit.kind === 'commit' ? 'Copy Commit Hash' : 'Copy ID';
	const choice = await vscode.window.showInformationMessage(
		target.local ? description : `${description} It is not in this window.`,
		copy,
	);
	if (choice === copy) {
		await vscode.env.clipboard.writeText(hit.id);
	}
	return { kind: 'described' };
}

/**
 * Opens a search result by what it is.
 *
 * A file opens in the editor at its line. A session or a checkpoint of
 * this repository opens in its own view. A commit, or anything that
 * belongs to another repository, is described and its id can be copied.
 */
export async function openSearchResult(deps: OpenResultDependencies, target: SearchTarget): Promise<OpenResult> {
	return target.kind === 'file' ? openFile(deps, target) : openHit(deps, target);
}
