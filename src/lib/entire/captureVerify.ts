import { settingLabel } from './captureActions';
import type { CleanScope, ConfigureChange, ConfigureKey, SettingsTarget } from './captureFlags';
import type { EntireSettings } from './settings';
import type { WorkspaceStatus } from './types';

/** What a fresh status says about a disable. */
export type DisableVerdict =
	| { readonly kind: 'verified' }
	/** Status still reports Entire as enabled. */
	| { readonly kind: 'still-enabled' }
	/** Status already reported Entire as off before the command. */
	| { readonly kind: 'unchanged' }
	| { readonly kind: 'unreadable' };

/** Whether a disable took effect, judged by a status read after it. */
export function verifyDisabled(before: WorkspaceStatus | undefined, after: WorkspaceStatus | undefined): DisableVerdict {
	if (after === undefined) {
		return { kind: 'unreadable' };
	}
	if (after.kind === 'tracked') {
		return { kind: 'still-enabled' };
	}
	return before !== undefined && before.kind !== 'tracked' ? { kind: 'unchanged' } : { kind: 'verified' };
}

/** What is left after an uninstall. */
export interface UninstallFacts {
	/** Whether the `.entire` directory is still there. Undefined when it could not be checked. */
	readonly entireDirectoryPresent: boolean | undefined;
	/** Hook files that still call the CLI. */
	readonly hookFilesLeft: readonly string[];
}

/** Whether an uninstall is complete, and what remains when it is not. */
export function verifyUninstalled(after: WorkspaceStatus | undefined, facts: UninstallFacts): { readonly complete: boolean; readonly remaining: readonly string[] } {
	const remaining: string[] = [];
	if (after === undefined) {
		remaining.push('workspace status could not be read afterwards');
	} else if (after.kind === 'tracked') {
		remaining.push('status still reports Entire as enabled');
	}
	if (facts.entireDirectoryPresent === true) {
		remaining.push('the .entire directory is still present');
	} else if (facts.entireDirectoryPresent === undefined) {
		remaining.push('whether the .entire directory is gone could not be checked');
	}
	if (facts.hookFilesLeft.length > 0) {
		remaining.push(`hook files still call the CLI: ${facts.hookFilesLeft.join(', ')}`);
	}
	return { complete: remaining.length === 0, remaining };
}

/** What a fresh session listing says about a clean. */
export type CleanVerdict =
	| { readonly kind: 'done'; readonly gone: readonly string[]; readonly remaining: readonly string[] }
	| { readonly kind: 'unconfirmed'; readonly detail: string; readonly gone: readonly string[]; readonly remaining: readonly string[] };

/**
 * Compares the session ids listed before a clean with those listed after.
 *
 * One session or everything must be gone for the result to be done; the
 * default scope covers only what belongs to HEAD, so sessions that remain
 * there are not a failure.
 */
export function verifyCleaned(before: readonly string[] | undefined, after: readonly string[] | undefined, scope: CleanScope): CleanVerdict {
	if (after === undefined) {
		return { kind: 'unconfirmed', detail: 'the session list could not be read afterwards', gone: [], remaining: [] };
	}
	const listedBefore = before ?? [];
	const gone = listedBefore.filter(id => !after.includes(id));
	if (scope.kind === 'session') {
		return after.includes(scope.id)
			? { kind: 'unconfirmed', detail: `session ${scope.id} is still listed`, gone, remaining: [scope.id] }
			: { kind: 'done', gone, remaining: [] };
	}
	if (scope.kind === 'all' && after.length > 0) {
		return { kind: 'unconfirmed', detail: `${after.length} ${after.length === 1 ? 'session is' : 'sessions are'} still listed after cleaning everything`, gone, remaining: after };
	}
	return { kind: 'done', gone, remaining: after };
}

/** One layer of Entire's settings, read back. */
export interface SettingsLayerReading {
	/** The file, relative to the folder, as it is shown. */
	readonly file: string;
	/** The repository file this layer is, when it is one the editor can write. */
	readonly target?: SettingsTarget;
	/** What the file says. Undefined when it is absent or could not be read. */
	readonly settings: EntireSettings | undefined;
}

type ReadableKey = 'telemetry' | 'absoluteHookPath' | 'checkpointRemote' | 'checkpointBackend';

function valueOf(settings: EntireSettings, key: ReadableKey): string | undefined {
	switch (key) {
		case 'telemetry':
			return settings.telemetry === undefined ? undefined : settings.telemetry ? 'on' : 'off';
		case 'absoluteHookPath':
			return settings.absoluteGitHookPath === undefined ? undefined : settings.absoluteGitHookPath ? 'on' : 'off';
		case 'checkpointRemote':
			return settings.checkpointRemote ? `${settings.checkpointRemote.provider ?? 'unknown'}:${settings.checkpointRemote.repo}` : undefined;
		case 'checkpointBackend':
			return settings.checkpointType;
	}
}

function isReadable(key: ConfigureKey): key is ReadableKey {
	return key === 'telemetry' || key === 'absoluteHookPath' || key === 'checkpointRemote' || key === 'checkpointBackend';
}

/** The value of a setting in the first layer that sets it, and that layer's file. Layers are highest priority first. */
export function effectiveValue(layers: readonly SettingsLayerReading[], key: ConfigureKey): { readonly value: string; readonly file: string } | undefined {
	if (!isReadable(key)) {
		return undefined;
	}
	for (const layer of layers) {
		const value = layer.settings ? valueOf(layer.settings, key) : undefined;
		if (value !== undefined) {
			return { value, file: layer.file };
		}
	}
	return undefined;
}

/** The value each readable setting has now, for a message that shows the old value. */
export function currentSettingValues(layers: readonly SettingsLayerReading[]): Readonly<Partial<Record<ConfigureKey, string>>> {
	const values: Partial<Record<ConfigureKey, string>> = {};
	for (const key of ['telemetry', 'absoluteHookPath', 'checkpointRemote', 'checkpointBackend'] as const) {
		const found = effectiveValue(layers, key);
		if (found) {
			values[key] = found.value;
		}
	}
	return values;
}

/** What a read of the settings files says about one setting that was written. */
export type SettingVerdict =
	| { readonly key: ConfigureKey; readonly status: 'verified'; readonly value: string; readonly file: string }
	| { readonly key: ConfigureKey; readonly status: 'written-not-readable' }
	| { readonly key: ConfigureKey; readonly status: 'mismatch'; readonly detail: string };

/** The value a change asked for, as the layers show values. */
export function chosenValue(change: ConfigureChange): string | undefined {
	if (change.key === 'reinstallHook') {
		return undefined;
	}
	const value = change.value;
	return typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
}

/**
 * Checks each chosen setting against the files, read after the write.
 *
 * A setting the editor can read back must be in the file that was written
 * with the value that was chosen, and must also be the value in effect: a
 * file earlier in the order of precedence may override it. A setting the
 * editor cannot read back is said to be written and nothing more.
 */
export function verifySettings(changes: readonly ConfigureChange[], layers: readonly SettingsLayerReading[], target: SettingsTarget): readonly SettingVerdict[] {
	return changes.map<SettingVerdict>(change => {
		const key = change.key;
		const chosen = chosenValue(change);
		if (!isReadable(key) || chosen === undefined) {
			return { key, status: 'written-not-readable' };
		}
		const written = layers.find(layer => layer.target === target);
		const inFile = written?.settings ? valueOf(written.settings, key) : undefined;
		if (inFile === undefined) {
			return { key, status: 'mismatch', detail: `${settingLabel(key)} is not set in ${written?.file ?? 'the settings file'} after the write` };
		}
		if (inFile !== chosen) {
			return { key, status: 'mismatch', detail: `${settingLabel(key)} is ${inFile} in ${written?.file ?? 'the settings file'}, not ${chosen}` };
		}
		const effective = effectiveValue(layers, key);
		if (effective && effective.value !== chosen) {
			return {
				key,
				status: 'mismatch',
				detail: `${settingLabel(key)} was written as ${chosen} to ${written?.file ?? 'the settings file'}, but ${effective.file} sets it to ${effective.value} and takes precedence`,
			};
		}
		return { key, status: 'verified', value: inFile, file: written?.file ?? '' };
	});
}

/** One line per verdict, for the result. */
export function describeVerdicts(verdicts: readonly SettingVerdict[]): readonly string[] {
	return verdicts.map(verdict => {
		switch (verdict.status) {
			case 'verified':
				return `${settingLabel(verdict.key)}: ${verdict.value} (read back from ${verdict.file})`;
			case 'written-not-readable':
				return `${settingLabel(verdict.key)}: written; the editor cannot read this setting back`;
			case 'mismatch':
				return verdict.detail;
		}
	});
}
