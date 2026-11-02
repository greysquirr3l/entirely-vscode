/**
 * Makes text that came from the CLI or a server safe for a VS Code message
 * or picker, which render Markdown (links, autolinks and command: URIs).
 *
 * Brackets, angle brackets and backticks are dropped, so no link or autolink
 * can form. A `scheme:` for the schemes a link could use is broken. Bidi
 * controls and zero-width characters are removed, because they can hide
 * where a word ends or reorder what a reader sees. Newlines are kept: callers
 * build multi-line reports.
 */
export function neutraliseLinks(text: string): string {
	return text
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
		.replace(/[[\]<>`]/g, '')
		.replace(/\b(command|file|vscode|vscode-insiders|https?|ftp|mailto)\s*:/gi, '$1 :');
}

/**
 * Makes text safe for a VS Code message that carries a path of the
 * person's own.
 *
 * The same as `neutraliseLinks`, except that square brackets are kept: a
 * path can hold them, and a path shown altered is a path the person
 * cannot find.
 *
 * For a surface VS Code shows as plain text — a notification, or the
 * message of a modal. A surface it renders as Markdown, such as the
 * detail of a modal, takes `neutraliseLinks` instead: with the brackets
 * kept, `[text](where)` can still form a link there.
 */
export function neutraliseLinksKeepingBrackets(text: string): string {
	return text
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
		.replace(/[<>]/g, '')
		.replace(/\b(command|file|vscode|vscode-insiders|https?|ftp|mailto)\s*:/gi, '$1 :');
}
