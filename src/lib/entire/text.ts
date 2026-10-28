/** How long a prompt may be before it is cut short. */
const MAX_PROMPT_LENGTH = 80;

/**
 * Shortens a prompt to a single line.
 *
 * A prompt is a prompt, not a document. It arrives with the newlines and
 * indentation the user typed it with, and showing all of it in a tree
 * would push every other row off the side.
 */
export function truncatePrompt(prompt: string, maxLength = MAX_PROMPT_LENGTH): string {
	const firstLine = prompt.split('\n')[0] ?? '';
	const collapsed = firstLine.replace(/\s+/g, ' ').trim();

	if (collapsed.length <= maxLength) {
		return collapsed;
	}

	return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * The characters Markdown gives a meaning to.
 *
 * Every one of them is escaped before a value is put into a Markdown
 * document, so that a value cannot become a heading, a list, a link, a
 * quote, a table, a formula or a block of code — whatever it holds, it
 * is text.
 *
 * The set is wider than the one the editor escapes for itself. The
 * extension host and the editor do not escape the same characters, and
 * a difference between them is a difference in what a value can do.
 *
 * The colon is in the set for the URLs rather than for the Markdown: a
 * renderer that links a bare address would otherwise turn
 * `https://example.invalid` in a prompt into a link, and a link in a
 * tooltip is a link a user can click without meaning to.
 */
const MARKDOWN_PUNCTUATION = /[\\`*_{}[\]()#+\-.!~>|$&<=:]/g;

/**
 * Puts a value into a Markdown document as text.
 *
 * The value came from the CLI, from a repository or from a prompt, so it
 * is not the extension's own writing and it is not trusted to be
 * Markdown. Escaped here, a value that says
 * `[click me](https://example.invalid)` is shown as the words of a
 * prompt rather than as a link.
 *
 * A line break inside the value becomes a hard break, so the value stays
 * one paragraph: no line of it can start a block of its own, and the
 * structure the extension wrote around it is left alone.
 */
export function escapeMarkdown(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(MARKDOWN_PUNCTUATION, '\\$&')
		.replace(/\n/g, '\\\n');
}

/**
 * Counts things in the way English does: one turn, two turns.
 */
export function pluralise(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Turns a status the CLI uses into a label a person can read.
 *
 * The CLI's statuses are its own; this only changes how they look.
 */
export function humanizeStatus(status: string): string {
	const words = status.replace(/[_-]+/g, ' ').trim();
	if (words.length === 0) {
		return status;
	}
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How long a quoted value may be before it is cut short. */
const MAX_QUOTED_LENGTH = 200;

/**
 * Puts a value on one line, so it cannot pretend to be a line of its own.
 *
 * A value that came from the CLI may hold a newline, and a report that
 * a user pastes into a public issue is a document where a forged line
 * is a forged fact: a value carrying a newline could add a line of its
 * own, and a reader would have no way of telling it from the ones the
 * report wrote.
 *
 * So the value is folded onto one line, and the control characters that
 * would have done the folding are shown instead. The length is bounded
 * too, because a value nobody is going to read all of is a value nobody
 * is going to check.
 */
export function oneLine(value: string, maxLength = MAX_QUOTED_LENGTH): string {
	const folded = value.replace(/[\r\n\t]+/g, ' <break> ').replace(/[\u0000-\u001f\u007f]/g, '');

	if (folded.length <= maxLength) {
		return folded;
	}

	return `${folded.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
