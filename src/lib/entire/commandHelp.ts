/**
 * Whether a command's own `--help` describes that command.
 *
 * The labs commands are missing from `agent-help`, so their help is the only
 * source of their flags. A CLI that lacks a command prints the top-level
 * help instead (and exits non-zero), and a group such as `tokens` prints its
 * own help when asked about a subcommand it does not have. Both are
 * recognised by the usage line: the help of `entire review` shows
 * `entire review [flags]`, and the top-level help shows `entire [command]`.
 */
export function describesCommand(help: string, command: string): boolean {
	const words = command
		.trim()
		.split(/\s+/)
		.filter(word => word.length > 0)
		.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	if (words.length === 0) {
		return false;
	}
	return new RegExp(`^\\s*entire\\s+${words.join('\\s+')}(?:\\s|$)`, 'm').test(help);
}

/** The most characters of the CLI's own description that are quoted. */
const MAX_DESCRIPTION_CHARACTERS = 600;

/**
 * The first paragraph of a command's help, on one line.
 *
 * It is the CLI's own description of what the command does and is quoted
 * as written. A help that opens with its usage block has no description.
 */
export function firstParagraph(help: string): string | undefined {
	const lines = help.replace(/\r\n?/g, '\n').split('\n');
	const paragraph: string[] = [];
	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) {
			if (paragraph.length > 0) {
				break;
			}
			continue;
		}
		if (/^(usage|flags|options|examples?)\s*:?$/i.test(line)) {
			break;
		}
		paragraph.push(line);
	}
	const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
	if (text.length === 0) {
		return undefined;
	}
	return text.length > MAX_DESCRIPTION_CHARACTERS ? `${text.slice(0, MAX_DESCRIPTION_CHARACTERS - 1).trimEnd()}…` : text;
}

/**
 * The fullest help line a flag has.
 *
 * The help of `entire review` describes each flag twice: first in prose, with
 * the description wrapped over several lines, then in the flag table on one
 * line. The table reader keeps the first row it sees, so this reads every row
 * of the named flag and keeps the longest description.
 */
export function longestFlagDescription(help: string, flag: string): string | undefined {
	const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const row = new RegExp(`^\\s+(?:-[A-Za-z0-9],\\s+)?${escaped}(?:\\s+[A-Za-z]+)?\\s{2,}(\\S.*)$`);
	let best: string | undefined;
	for (const line of help.split('\n')) {
		const description = row.exec(line)?.[1]?.trim();
		if (description !== undefined && (best === undefined || description.length > best.length)) {
			best = description;
		}
	}
	return best;
}
