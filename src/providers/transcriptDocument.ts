import * as vscode from 'vscode';

/** The URI scheme transcripts are opened under. */
export const TRANSCRIPT_SCHEME = 'entirely-transcript';

/** How many transcripts are kept in memory at once. */
const MAX_DOCUMENTS = 3;

/**
 * Serves transcripts as read-only documents.
 *
 * A document backed by a content provider cannot be edited or saved, which
 * is what a record of what an agent did should be. Only the few most
 * recent are kept, because a transcript can be megabytes.
 */
export class TranscriptContentProvider implements vscode.TextDocumentContentProvider {
	private readonly documents = new Map<string, string>();
	private readonly changed = new vscode.EventEmitter<vscode.Uri>();

	readonly onDidChange: vscode.Event<vscode.Uri> = this.changed.event;

	/** The address a session's transcript is shown at. */
	static uriFor(sessionId: string): vscode.Uri {
		return vscode.Uri.from({
			scheme: TRANSCRIPT_SCHEME,
			path: `/${sessionId}.md`,
		});
	}

	/** Stores the text of a transcript and returns where to open it. */
	set(sessionId: string, text: string): vscode.Uri {
		const uri = TranscriptContentProvider.uriFor(sessionId);
		const key = uri.toString();

		this.documents.delete(key);
		this.documents.set(key, text);
		while (this.documents.size > MAX_DOCUMENTS) {
			const oldest = this.documents.keys().next();
			if (oldest.done) {
				break;
			}
			this.documents.delete(oldest.value);
		}

		this.changed.fire(uri);
		return uri;
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.documents.get(uri.toString()) ?? '';
	}

	dispose(): void {
		this.documents.clear();
		this.changed.dispose();
	}
}
