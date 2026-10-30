import * as vscode from 'vscode';

/** The URI scheme generated documents are opened under. */
export const GENERATED_SCHEME = 'entirely-generated';

/** What kind of document was generated. It decides the file extension, so the editor picks the language. */
export type GeneratedKind = 'dispatch' | 'recap' | 'plugin' | 'detail';

const EXTENSIONS: Record<GeneratedKind, string> = { dispatch: 'md', recap: 'txt', plugin: 'txt', detail: 'txt' };

/** How many documents are kept in memory at once. */
const MAX_DOCUMENTS = 5;

/**
 * Serves dispatches and recaps as read-only documents.
 *
 * A document backed by a content provider cannot be edited or saved,
 * which is right for something the CLI generated. The text is kept in
 * memory only, and only the few most recent are kept.
 */
export class GeneratedDocuments implements vscode.TextDocumentContentProvider {
	private readonly documents = new Map<string, { kind: GeneratedKind; text: string }>();
	private readonly changed = new vscode.EventEmitter<vscode.Uri>();
	private counter = 0;

	readonly onDidChange: vscode.Event<vscode.Uri> = this.changed.event;

	/**
	 * Stores the text and returns where to open it. Each call gets an address of its own.
	 *
	 * A `name` becomes the tab's title, with the counter kept in the query so two
	 * documents with the same name stay apart.
	 */
	set(kind: GeneratedKind, text: string, name?: string): vscode.Uri {
		this.counter += 1;
		const label = name?.replace(/[\u0000-\u001f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
		const uri = vscode.Uri.from({
			scheme: GENERATED_SCHEME,
			path: label ? `/${label}.${EXTENSIONS[kind]}` : `/${kind}-${this.counter}.${EXTENSIONS[kind]}`,
			query: label ? String(this.counter) : '',
		});
		this.documents.set(uri.toString(), { kind, text });
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

	/** The text at an address, when it is still held. */
	textOf(uri: vscode.Uri): string | undefined {
		return this.documents.get(uri.toString())?.text;
	}

	/** The text of the most recent document of a kind. */
	latest(kind: GeneratedKind): string | undefined {
		let found: string | undefined;
		for (const entry of this.documents.values()) {
			if (entry.kind === kind) {
				found = entry.text;
			}
		}
		return found;
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.textOf(uri) ?? '';
	}

	dispose(): void {
		this.documents.clear();
		this.changed.dispose();
	}
}
