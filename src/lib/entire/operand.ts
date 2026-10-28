/**
 * How the CLI reads an operand.
 *
 * The CLI parses its arguments with a flag parser, and several of its
 * commands take a file or an id where a flag may also go. Two things
 * follow from that, and both are about a value the extension did not
 * choose: a filename in a repository, a checkpoint id from the forge.
 *
 * The first is that a value that begins with a dash is read as a flag
 * rather than as a value. The second is that the `why` command reads its
 * file operand as `<file>[:line]`, so a filename that contains a colon
 * followed by digits is read as a different file at a different line.
 *
 * Neither is the extension's behaviour to guess at. The CLI is the source
 * of truth for its own arguments, so this module only answers the
 * question the extension has to answer before it builds an argument list:
 * can this value be passed safely, and what has to be done to make it
 * safe?
 */

/**
 * The separator that ends the CLI's options.
 *
 * Everything after it is an operand, whatever it looks like. The CLI's
 * own help is read at runtime to decide which flags exist; this is not a
 * flag, it is the conventional way of saying that the options have
 * stopped.
 */
export const END_OF_OPTIONS = '--';

/**
 * Whether the CLI would read the end of this path as a line number.
 *
 * The `why` command takes `<file>[:line]`. It splits the operand at the
 * last colon and reads the part after it as a line, but only when that
 * part is all digits. `notes:12` is therefore read as the file `notes` at
 * line 12, and the extension would be answered about a file the user did
 * not ask about.
 *
 * The check is on the last colon rather than on any colon: a directory
 * may contain a colon, and only a colon at the end of the operand can be
 * mistaken for the line separator.
 */
export function endsWithLineSuffix(path: string): boolean {
	const colon = path.lastIndexOf(':');

	if (colon === -1) {
		return false;
	}

	return /^\d+$/.test(path.slice(colon + 1));
}

/**
 * The line the CLI would read from this path, if it would read one.
 *
 * A path that ends in `:<digits>` is read as a different file at a
 * different line, so the extension must not pass such a path on its own.
 */
export function splitLineSuffix(path: string): { readonly file: string; readonly line: number } | undefined {
	if (!endsWithLineSuffix(path)) {
		return undefined;
	}

	const colon = path.lastIndexOf(':');
	const line = Number.parseInt(path.slice(colon + 1), 10);

	if (!Number.isSafeInteger(line) || line < 1) {
		return undefined;
	}

	return { file: path.slice(0, colon), line };
}

/**
 * The path the CLI should be given for a file.
 *
 * The `why` command splits its operand at a trailing `:<digits>`, so a
 * file whose name ends that way would be answered about as a different
 * file at a different line. A trailing slash defeats the split — the
 * suffix after the last colon is then `12/` rather than `12`, which is
 * not all digits — and the CLI strips the slash from the file it reports
 * back.
 *
 * The slash is only added when the path would otherwise be misread. A
 * path with no such suffix is passed as it is.
 */
export function fileOperand(path: string): string {
	if (!endsWithLineSuffix(path)) {
		return path;
	}

	return `${path}/`;
}

/**
 * Builds the argument list for a command that takes one file.
 *
 * The file is placed after the end-of-options separator, so the CLI
 * cannot read it as a flag, and the line is given with the CLI's own
 * `--line` flag rather than by being appended to the path, so a path that
 * contains a colon keeps its colon.
 *
 * The result is that the extension asks about the file it means, and the
 * CLI answers about that file.
 */
export function fileArguments(
	command: readonly string[],
	file: string,
	line: number | undefined,
	flags: readonly string[] = [],
): readonly string[] {
	const args = [...command, ...flags];

	if (line !== undefined) {
		args.push('--line', String(line));
	}

	args.push(END_OF_OPTIONS, fileOperand(file));

	return args;
}
