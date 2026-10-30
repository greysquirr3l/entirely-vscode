/**
 * Reads a line number passed to a command, such as the one the blame hover
 * sends. Only a positive whole number is a line; anything else is
 * undefined so the caller can fall back to the cursor.
 */
export function parseRequestedLine(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}
