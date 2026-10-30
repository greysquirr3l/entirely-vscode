import * as vscode from 'vscode';

import { renderTranscript } from '../lib/entire';
import type { SessionDetailProvider } from '../providers/sessionDetailProvider';
import { selectionOfSession, type SessionItemNode, type SessionsProvider } from '../providers/sessionsProvider';
import type { TranscriptContentProvider } from '../providers/transcriptDocument';
import type { SelectionService } from '../services/selection';
import type { SessionDetailSource } from '../services/sessionDetail';

/** What selecting a session needs. */
export interface SelectSessionDependencies {
	readonly sessions: SessionsProvider;
	readonly selection: Pick<SelectionService, 'select' | 'clear'>;
}

/**
 * Shows a session in the Details viewer.
 *
 * The reads are the ones the view has always made: the record from
 * `session info`, the token usage, and the tool calls from the transcript,
 * which is read off the interface thread. The selection service runs them,
 * so a repeat selection is served from its cache and a slow read for an
 * earlier session cannot overwrite a later one. The transcript text is
 * never put in the tree: the tree gets counts, and the text opens in an
 * editor on request.
 */
export async function selectSession(
	deps: SelectSessionDependencies,
	element: SessionItemNode | undefined,
): Promise<void> {
	deps.sessions.select(element);
	if (!element) {
		deps.selection.clear();
		return;
	}
	await deps.selection.select(selectionOfSession(element), 'sessions');
}

/** What opening a transcript needs. */
export interface OpenTranscriptDependencies {
	readonly sessionDetail: SessionDetailProvider;
	readonly detail: SessionDetailSource;
	readonly documents: Pick<TranscriptContentProvider, 'set'>;
	/** Opens the document. Defaults to a preview tab in the editor. */
	readonly show?: (uri: vscode.Uri) => Promise<void>;
	/** Tells the user something. Defaults to a warning message. */
	readonly warn?: (message: string) => Promise<unknown>;
}

async function showReadOnly(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.languages.setTextDocumentLanguage(document, 'markdown');
	await vscode.window.showTextDocument(document, { preview: true });
}

/**
 * Opens a session's transcript in a read-only editor.
 *
 * The transcript is the user's conversation with an agent, so it goes to a
 * document they asked for and nowhere else: not the output channel, not a
 * notification, not the tree.
 */
export async function openTranscript(
	deps: OpenTranscriptDependencies,
	sessionId: string | undefined,
): Promise<void> {
	const warn = deps.warn ?? ((message: string) => vscode.window.showWarningMessage(message));
	const show = deps.show ?? showReadOnly;

	const id = sessionId ?? deps.sessionDetail.current?.id;
	if (!id) {
		await warn('Select a session first, then open its transcript.');
		return;
	}

	const found = await deps.detail.info(id);
	if (found.kind === 'failed') {
		await warn(`Could not read the session: ${found.detail}.`);
		return;
	}

	const read = await deps.detail.transcript(found.info);
	if (read.kind === 'failed') {
		await warn(`Could not read the transcript: ${read.detail}.`);
		return;
	}

	const text = renderTranscript(found.info, read.loaded);
	await show(deps.documents.set(id, text));
}

/** Narrows the sessions tree to the workspace's own session, or widens it. */
export async function setOwnSessionFilter(
	sessions: SessionsProvider,
	ownOnly: boolean,
): Promise<void> {
	await sessions.setOwnSessionOnly(ownOnly);
	await vscode.commands.executeCommand('setContext', 'entirely.ownSessionOnly', ownOnly);
}
