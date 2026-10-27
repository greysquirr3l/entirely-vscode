import {
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalString,
	type DecodeResult,
} from './decode';

/** A value a strategy option may hold. */
export type StrategyOptionValue = string | number | boolean;

/**
 * The settings Entire's own configuration understands.
 *
 * These are the settings the extension acts on or reports. Anything the
 * CLI understands that is not here is not something the extension has an
 * opinion about.
 */
export interface EntireSettings {
	/** Whether Entire is turned on for the repository. */
	readonly enabled?: boolean;
	/** How much the CLI says. */
	readonly logLevel?: string;
	/** Whether the CLI sends anonymous usage analytics. */
	readonly telemetry?: boolean;
	/** Whether the git hook holds the CLI's full path. */
	readonly absoluteGitHookPath?: boolean;
	/** Whether commits are linked to their checkpoints. */
	readonly commitLinking?: boolean;
	/** Whether checkpoint commits are signed. */
	readonly signCheckpointCommits?: boolean;
	/** How checkpoints are stored, as the CLI names it. */
	readonly checkpointType?: string;
	/** The options given to the CLI's strategies, as they are. */
	readonly strategyOptions?: Readonly<Record<string, StrategyOptionValue>>;
}

/** Decodes the options given to the CLI's strategies. */
function decodeStrategyOptions(
	value: unknown,
	path: string,
): DecodeResult<Readonly<Record<string, StrategyOptionValue>>> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const options: Record<string, StrategyOptionValue> = {};
	for (const [key, entry] of Object.entries(record.value)) {
		if (typeof entry === 'string' || typeof entry === 'boolean') {
			options[key] = entry;
			continue;
		}

		if (typeof entry === 'number' && Number.isFinite(entry)) {
			options[key] = entry;
			continue;
		}

		// An option the extension does not understand is left out rather
		// than guessed at.
	}

	return { ok: true, value: options };
}

/**
 * Decodes Entire's own settings.
 *
 * A setting the CLI may add later is simply absent here, which is why
 * every field is optional. Nothing is invented and nothing is defaulted:
 * an absent setting is one the extension does not know the value of.
 */
export function decodeEntireSettings(value: unknown): DecodeResult<EntireSettings> {
	const record = decodeRecord(value, 'settings');
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, 'settings');

	const enabled = optionalBoolean(read, 'enabled');
	const logLevel = optionalString(read, 'log_level');
	const telemetry = optionalBoolean(read, 'telemetry');
	const absoluteGitHookPath = optionalBoolean(read, 'absolute_git_hook_path');
	const commitLinking = optionalBoolean(read, 'commit_linking');
	const signCheckpointCommits = optionalBoolean(read, 'sign_checkpoint_commits');

	if (!logLevel.ok) {
		return logLevel;
	}

	let checkpointType: string | undefined;
	if (read.record['checkpoints'] !== undefined) {
		const checkpoints = decodeRecord(read.record['checkpoints'], 'settings.checkpoints');
		if (!checkpoints.ok) {
			return checkpoints;
		}

		const checkpointRead = fields(checkpoints.value, 'settings.checkpoints');
		if (checkpointRead.record['primary'] !== undefined) {
			const primary = decodeRecord(
				checkpointRead.record['primary'],
				'settings.checkpoints.primary',
			);
			if (!primary.ok) {
				return primary;
			}

			const primaryRead = fields(primary.value, 'settings.checkpoints.primary');
			const type = optionalString(primaryRead, 'type');
			if (!type.ok) {
				return type;
			}
			checkpointType = type.value;
		}
	}

	let strategyOptions: Readonly<Record<string, StrategyOptionValue>> | undefined;
	if (read.record['strategy_options'] !== undefined) {
		const decoded = decodeStrategyOptions(
			read.record['strategy_options'],
			'settings.strategy_options',
		);
		if (!decoded.ok) {
			return decoded;
		}
		strategyOptions = decoded.value;
	}

	return {
		ok: true,
		value: {
			enabled,
			logLevel: logLevel.value,
			telemetry,
			absoluteGitHookPath,
			commitLinking,
			signCheckpointCommits,
			checkpointType,
			strategyOptions,
		},
	};
}

/**
 * Merges the layers of Entire's settings into the one that is in effect.
 *
 * The layers are given in the order they take precedence, highest first,
 * so the first layer that has a setting wins. A setting no layer has is
 * simply absent, which is what the CLI's own defaults then decide.
 */
export function resolveEntireSettings(
	layers: readonly (EntireSettings | undefined)[],
): EntireSettings {
	const layersWithValues = layers.filter(
		(layer): layer is EntireSettings => layer !== undefined,
	);

	/**
	 * The value of a setting, taken from the first layer that has one.
	 */
	const first = <T>(pick: (layer: EntireSettings) => T | undefined): T | undefined => {
		for (const layer of layersWithValues) {
			const value = pick(layer);
			if (value !== undefined) {
				return value;
			}
		}
		return undefined;
	};

	return {
		enabled: first(layer => layer.enabled),
		logLevel: first(layer => layer.logLevel),
		telemetry: first(layer => layer.telemetry),
		absoluteGitHookPath: first(layer => layer.absoluteGitHookPath),
		commitLinking: first(layer => layer.commitLinking),
		signCheckpointCommits: first(layer => layer.signCheckpointCommits),
		checkpointType: first(layer => layer.checkpointType),
		strategyOptions: first(layer => layer.strategyOptions),
	};
}

/**
 * Summarises the settings that are in effect, for somewhere the user can
 * read them.
 *
 * The names are the CLI's own, so what is shown here is what the user
 * would find in the settings file.
 */
export function summariseSettings(settings: EntireSettings): readonly string[] {
	const summary: string[] = [];

	const add = (name: string, value: string | number | boolean | undefined): void => {
		if (value === undefined) {
			return;
		}
		summary.push(`${name}: ${value}`);
	};

	add('enabled', settings.enabled);
	add('log_level', settings.logLevel);
	add('telemetry', settings.telemetry);
	add('absolute_git_hook_path', settings.absoluteGitHookPath);
	add('commit_linking', settings.commitLinking);
	add('sign_checkpoint_commits', settings.signCheckpointCommits);
	add('checkpoints.primary.type', settings.checkpointType);

	for (const [name, value] of Object.entries(settings.strategyOptions ?? {})) {
		add(`strategy_options.${name}`, value);
	}

	return summary;
}
