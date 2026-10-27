import type { CliCommandUsage, CliFlag } from './types';

/**
 * A flag as it appears in usage text: `--json`, `--flag value`, or `-v`.
 *
 * The leading group keeps the separator so a flag inside a bracket or after
 * a comma is still recognised.
 */
const FLAG_TOKEN = /(^|[\s,(\[])(--[A-Za-z0-9][A-Za-z0-9-]*|-[A-Za-z0-9])(?![A-Za-z0-9-])/g;

/** Removes flag tokens and separators from the front of a description. */
function stripLeadingFlags(text: string): string {
	let remaining = text.trim();
	for (;;) {
		FLAG_TOKEN.lastIndex = 0;
		const match = FLAG_TOKEN.exec(remaining);
		if (!match || match.index !== 0) {
			break;
		}
		remaining = remaining.slice(match[0].length);
	}
	return remaining.replace(/^[\s,:=]+/, '').trim();
}

/**
 * Reads the flags out of the CLI's own `agent-help` output.
 *
 * The CLI owns the format and is free to change it, so this is a best-effort
 * reading rather than a strict grammar: it recognises flags and the text
 * that follows them on the same line. The unmodified text is always kept on
 * the result, so a caller that needs more can read it.
 */
export function parseUsage(command: string, text: string): CliCommandUsage {
	const flags: CliFlag[] = [];
	const seen = new Set<string>();

	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		// A usage synopsis lists the flags a command accepts, but it does not
		// describe them. The descriptions come from the flag list below it.
		if (/^usage\b/i.test(line)) {
			continue;
		}

		FLAG_TOKEN.lastIndex = 0;
		const matches = [...line.matchAll(FLAG_TOKEN)];
		if (matches.length === 0) {
			continue;
		}

		for (let index = 0; index < matches.length; index++) {
			const match = matches[index];
			const name = match[2];
			const start = (match.index ?? 0) + match[0].length;
			const end = index + 1 < matches.length ? (matches[index + 1].index ?? line.length) : line.length;
			const description = stripLeadingFlags(line.slice(start, end));

			if (seen.has(name)) {
				continue;
			}
			seen.add(name);
			flags.push({ name, description });
		}
	}

	return { command, flags, raw: text };
}
