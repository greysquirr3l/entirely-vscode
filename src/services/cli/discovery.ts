import * as fs from 'fs';
import * as path from 'path';

import { documentedLocations, pathEntries } from './locations';
import type { CliDiscovery, CliLocation } from './types';

/** How discovery should look for the binary. */
export interface DiscoveryOptions {
	/**
	 * An explicit path to the binary, from the user's setting. When set, it
	 * is used as-is and nothing else is searched.
	 */
	readonly configuredPath?: string;
	readonly platform?: NodeJS.Platform;
	readonly env?: NodeJS.ProcessEnv;
	readonly homeDir?: string;
}

/** A candidate binary found on disk. */
export interface Candidate {
	readonly path: string;
	readonly location: CliLocation;
	readonly directory: string;
}

/** The name of the binary on the current platform. */
function binaryName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'entire.exe' : 'entire';
}

/** Whether a path points at a file this process can execute. */
function isExecutable(candidate: string): boolean {
	try {
		const stats = fs.statSync(candidate);
		if (!stats.isFile()) {
			return false;
		}
	} catch {
		return false;
	}

	try {
		fs.accessSync(candidate, fs.constants.X_OK);
		return true;
	} catch {
		// On Windows the executable bit is not meaningful, and a file that
		// exists is enough.
		return process.platform === 'win32';
	}
}

/**
 * Looks for the binary in `PATH`, then in the documented install locations.
 *
 * The two are reported differently because they mean different things to
 * the user: a binary on `PATH` is usable from their shell, one in
 * `~/.local/bin` is not. Both are equally usable by the extension.
 */
export function findCandidate(options: DiscoveryOptions = {}): Candidate | undefined {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const name = binaryName(platform);

	if (options.configuredPath && options.configuredPath.length > 0) {
		const resolved = path.resolve(options.configuredPath);
		if (isExecutable(resolved)) {
			return { path: resolved, location: 'configured', directory: path.dirname(resolved) };
		}
		return undefined;
	}

	for (const entry of pathEntries(env)) {
		const candidate = path.join(entry, name);
		if (isExecutable(candidate)) {
			return { path: candidate, location: 'path', directory: entry };
		}
	}

	const homeDir = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? '';
	for (const location of documentedLocations(platform, homeDir, env)) {
		const candidate = path.join(location.directory, name);
		if (isExecutable(candidate)) {
			return { path: candidate, location: 'install-location', directory: location.directory };
		}
	}

	return undefined;
}

/**
 * A version as it appears in text, for example `1.2.3`, `v1.2.3` or `1.2.3-rc.1`.
 */
const VERSION_PATTERN = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

/**
 * Pulls a version out of the CLI's own `version` output.
 *
 * The exact shape of that output is the CLI's business, so this stays
 * tolerant: a JSON payload is unwrapped if there is one, otherwise the
 * first non-empty line is read, preferring the version it contains over the
 * rest of the line.
 */
export function parseVersion(stdout: string): string | undefined {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const firstBrace = trimmed.indexOf('{');
	if (firstBrace !== -1) {
		try {
			const parsed = JSON.parse(trimmed.slice(firstBrace)) as unknown;
			if (typeof parsed === 'string') {
				return parsed.trim() || undefined;
			}
			if (typeof parsed === 'object' && parsed !== null) {
				const record = parsed as Record<string, unknown>;
				for (const key of ['version', 'Version', 'v']) {
					const value = record[key];
					if (typeof value === 'string' && value.trim().length > 0) {
						return value.trim();
					}
				}
			}
		} catch {
			// Not JSON after all. Fall through to the line-based reading.
		}
	}

	for (const line of trimmed.split('\n')) {
		const candidate = line.trim();
		if (candidate.length === 0) {
			continue;
		}
		const match = VERSION_PATTERN.exec(candidate);
		return (match ? match[0] : candidate).replace(/^v(?=\d)/, '');
	}

	return undefined;
}
