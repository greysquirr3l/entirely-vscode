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
