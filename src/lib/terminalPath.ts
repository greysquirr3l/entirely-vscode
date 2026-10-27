/**
 * The platforms the editor names its terminal environment for.
 *
 * The editor keeps a separate environment for each platform, so a PATH
 * written on one machine does not leak onto another.
 */
export type PlatformSegment = 'osx' | 'linux' | 'windows';

/**
 * The terminal environment the editor keeps for one platform.
 *
 * The value is a variable's value. A null value takes a variable away.
 */
export type TerminalEnvironment = Record<string, string | null>;

/** The setting the editor keeps a platform's terminal environment in. */
export const TERMINAL_ENV_PREFIX = 'terminal.integrated.env';

/** The setting the editor keeps a platform's terminal environment in. */
export function terminalEnvSetting(segment: PlatformSegment): string {
	return `${TERMINAL_ENV_PREFIX}.${segment}`;
}

/** The segment the editor uses for a platform. */
export function platformSegment(platform: NodeJS.Platform): PlatformSegment | undefined {
	switch (platform) {
		case 'darwin':
			return 'osx';
		case 'linux':
			return 'linux';
		case 'win32':
			return 'windows';
		default:
			return undefined;
	}
}

/**
 * The PATH the editor resolves to the live PATH of the terminal.
 *
 * Writing this rather than a copy of the live PATH means the terminal
 * takes the value it has now, not the value it had when the setting was
 * written.
 */
export const INHERITED_PATH = '${env:PATH}';

/** The separator the platform puts between PATH entries. */
export function pathSeparator(platform: NodeJS.Platform): string {
	return platform === 'win32' ? ';' : ':';
}

/**
 * The entries of a PATH value.
 *
 * The platform's own separator is used, so a Windows path keeps the colon
 * in `C:\Users` intact. A variable reference is kept whole, because
 * `${env:PATH}` holds a colon of its own and would otherwise be split in
 * two.
 */
export function pathEntries(value: string | undefined, separator: string): string[] {
	if (!value) {
		return [];
	}

	const entries: string[] = [];
	let current = '';
	let inReference = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];

		if (character === '$' && value[index + 1] === '{') {
			inReference = true;
			current += character;
			continue;
		}

		if (inReference) {
			current += character;
			if (character === '}') {
				inReference = false;
			}
			continue;
		}

		if (character === separator) {
			entries.push(current);
			current = '';
			continue;
		}

		current += character;
	}

	entries.push(current);

	return entries.map(entry => entry.trim()).filter(entry => entry.length > 0);
}

/**
 * The PATH the terminal should have, with a directory added to it.
 *
 * The inherited PATH is written as `${env:PATH}` rather than as a copy of
 * it, so the terminal takes the live value rather than a stale one, and
 * so the entries the user already had are kept rather than replaced.
 */
export function pathWithDirectory(
	existing: string | undefined,
	directory: string,
	separator: string,
): string {
	const entries = pathEntries(existing, separator);

	// A directory that is already on the PATH is not added twice.
	if (entries.includes(directory)) {
		return entries.join(separator);
	}

	// A value that already inherits the PATH keeps the inherited PATH
	// exactly where it is, and the directory goes on the end.
	if (entries.includes(INHERITED_PATH)) {
		return [...entries, directory].join(separator);
	}

	// A value that does not inherit the PATH is kept whole, and the
	// inherited PATH is put in front of it so the terminal's own PATH
	// survives.
	return [INHERITED_PATH, ...entries, directory].join(separator);
}

/**
 * The terminal environment with the platform's PATH replaced.
 *
 * The other variables are left exactly as they were, so a value written
 * at one scope does not carry another scope's variables with it.
 */
export function withPath(
	existing: TerminalEnvironment | undefined,
	path: string,
): TerminalEnvironment {
	return { ...(existing ?? {}), PATH: path };
}

/**
 * The PATH the terminal should have, with a directory taken off it.
 *
 * When the directory was all the PATH held, the inherited PATH is left
 * in its place, so the terminal falls back to the PATH it would have had
 * anyway rather than to nothing.
 */
export function pathWithoutDirectory(
	existing: string | undefined,
	directory: string,
	separator: string,
): string {
	const kept = pathEntries(existing, separator).filter(entry => entry !== directory);
	return kept.length === 0 ? INHERITED_PATH : kept.join(separator);
}

/**
 * The platform's PATH, as it is now.
 */
export function currentPath(existing: TerminalEnvironment | undefined): string | undefined {
	const path = existing?.PATH;
	return typeof path === 'string' ? path : undefined;
}

/**
 * Whether the platform's PATH already holds the directory.
 *
 * A PATH that names the directory anywhere in it counts, because a
 * directory on the PATH is a directory on the PATH whichever position it
 * was written in.
 */
export function pathHasDirectory(
	existing: TerminalEnvironment | undefined,
	directory: string,
	separator: string,
): boolean {
	return pathEntries(currentPath(existing), separator).includes(directory);
}

/**
 * Whether a directory is on the PATH a terminal will have.
 *
 * The terminal's PATH is the setting's PATH, with the inherited PATH
 * resolved to the PATH the editor's own process has. A directory named
 * in either is on the terminal's PATH, and a directory on neither is not.
 *
 * A setting that says nothing about the PATH leaves the terminal with
 * the PATH the editor's process has, and a setting that names a PATH
 * without inheriting replaces it outright, so the directory is looked
 * for in the right place in each case.
 */
export function terminalPathHasDirectory(
	env: TerminalEnvironment | undefined,
	directory: string,
	separator: string,
	inheritedPath: string | undefined,
): boolean {
	const path = currentPath(env);

	if (path === undefined) {
		return pathEntries(inheritedPath, separator).includes(directory);
	}

	const entries = pathEntries(path, separator);

	if (entries.includes(directory)) {
		return true;
	}

	return entries.includes(INHERITED_PATH)
		&& pathEntries(inheritedPath, separator).includes(directory);
}
