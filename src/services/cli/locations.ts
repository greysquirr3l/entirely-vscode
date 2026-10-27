import * as os from 'os';
import * as path from 'path';

/** A directory the Entire CLI is documented to install into. */
export interface DocumentedLocation {
	/** The directory to look in. */
	readonly directory: string;
	/** A short human-readable name for it, for diagnostics. */
	readonly label: string;
}

/**
 * The directories the Entire CLI installs into, in the order they are tried.
 *
 * The CLI installs to `~/.local/bin`, which is off `PATH` on most machines.
 * A binary found here is a working binary — the extension invokes it by
 * absolute path — so it is "found", never "broken". The difference only
 * matters to the user's own shell, which is what the path repair addresses.
 */
export function documentedLocations(
	platform: NodeJS.Platform = process.platform,
	homeDir: string = os.homedir(),
	env: NodeJS.ProcessEnv = process.env,
): DocumentedLocation[] {
	if (platform === 'win32') {
		const locations: DocumentedLocation[] = [];
		const localAppData = env.LOCALAPPDATA;
		const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
		if (localAppData) {
			locations.push({
				directory: path.join(localAppData, 'entire', 'bin'),
				label: path.join('%LOCALAPPDATA%', 'entire', 'bin'),
			});
		}
		if (programFiles) {
			locations.push({
				directory: path.join(programFiles, 'entire', 'bin'),
				label: path.join('%PROGRAMFILES%', 'entire', 'bin'),
			});
		}
		return locations;
	}

	const dataHome =
		env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
			? env.XDG_DATA_HOME
			: path.join(homeDir, '.local', 'share');

	return [
		{ directory: path.join(homeDir, '.local', 'bin'), label: '~/.local/bin' },
		{ directory: path.join('/usr', 'local', 'bin'), label: '/usr/local/bin' },
		{ directory: path.join(dataHome, 'entire', 'bin'), label: '$XDG_DATA_HOME/entire/bin' },
	];
}

/** The `PATH` entries to search, in order. */
export function pathEntries(env: NodeJS.ProcessEnv = process.env): string[] {
	const raw = env.PATH ?? env.Path ?? '';
	return raw
		.split(path.delimiter)
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);
}
