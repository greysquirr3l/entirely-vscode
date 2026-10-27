import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	decodeEntireSettings,
	resolveEntireSettings,
	unwrap,
	type EntireSettings,
} from '../lib/entire';

/**
 * Where each layer of Entire's settings lives.
 *
 * The order is the order they take precedence, highest first: the
 * repository's own local settings beat the repository's shared ones,
 * which beat the ones the user keeps for every repository, which in turn
 * leave the CLI's own defaults to decide.
 */
export function settingsLayers(
	workspaceRoot: string | undefined,
	homeDirectory: string,
): readonly string[] {
	const layers: string[] = [];

	if (workspaceRoot) {
		layers.push(path.join(workspaceRoot, '.entire', 'settings.local.json'));
		layers.push(path.join(workspaceRoot, '.entire', 'settings.json'));
	}

	layers.push(path.join(homeDirectory, '.config', 'entire', 'settings.json'));

	return layers;
}

/** Reads one layer of settings, when it is there and it can be read. */
function readLayer(file: string): EntireSettings | undefined {
	let contents: string;

	try {
		contents = fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch {
		// A settings file that cannot be parsed is a file the extension
		// does not understand. The CLI will say so itself.
		return undefined;
	}

	const decoded = decodeEntireSettings(parsed);
	return decoded.ok ? decoded.value : undefined;
}

/**
 * Reads the settings that are in effect for a workspace.
 *
 * The layers are merged in the order the CLI layers them, so the value
 * the extension acts on is the value the CLI would act on.
 */
export function readEntireSettings(
	workspaceRoot: string | undefined,
	homeDirectory: string = os.homedir(),
): EntireSettings {
	const layers = settingsLayers(workspaceRoot, homeDirectory).map(readLayer);
	return resolveEntireSettings(layers);
}
