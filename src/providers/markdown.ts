import * as vscode from 'vscode';

import { escapeMarkdown } from '../lib/entire';

/**
 * A tooltip, written in two kinds of writing.
 *
 * The extension writes the structure of a tooltip: the labels, the
 * bullets, the headings. The CLI and the user write the values inside
 * it — a branch name, a worktree path, a model, a prompt, a checkpoint
 * message. Those are not the extension's own words, and they are not
 * trusted to be Markdown.
 *
 * So the two are kept apart. Structure goes in as Markdown; a value goes
 * in as text, escaped, so that a prompt containing a link is shown as
 * the words of a prompt. A tooltip that mixes the two cannot be
 * reviewed by reading it, which is why the split is a type rather than a
 * convention.
 */
export class Tooltip {
	private readonly value = new vscode.MarkdownString();

	/**
	 * Writes structure the extension wrote itself.
	 *
	 * The text is Markdown, and it is the extension's own, so it is
	 * written as it is.
	 */
	markdown(markdown: string): this {
		this.value.appendMarkdown(markdown);
		return this;
	}

	/**
	 * Writes a value the extension did not write, as text.
	 *
	 * The value is escaped, so it cannot become a link, a heading, a
	 * quote, a formula or a block of code. It is still shown, in full
	 * and in its own words.
	 */
	text(value: string): this {
		this.value.appendMarkdown(escapeMarkdown(value));
		return this;
	}

	/**
	 * Writes a labelled value as an item of a list.
	 *
	 * The label is the extension's own, so it is written as Markdown.
	 * The item ends with a line break, so that the next one starts on a
	 * line of its own.
	 */
	item(label: string, value: string): this {
		return this.markdown(`- ${label}: `).text(value).markdown('\n');
	}

	/** The tooltip, ready to be shown. */
	build(): vscode.MarkdownString {
		return this.value;
	}
}
