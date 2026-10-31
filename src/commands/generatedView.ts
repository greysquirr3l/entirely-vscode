import type { GeneratedKind } from '../providers/generatedDocuments';

/** What the token profile, experts and review flows share: opening a document, saying something, and showing progress. */
export interface GeneratedViewUi {
	/** Opens text in a read-only editor. */
	show(kind: GeneratedKind, text: string, name?: string): Promise<void>;
	warn(message: string): Promise<void>;
	/** Runs work behind a progress notification with a cancel button. Cancelling aborts the signal. */
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
