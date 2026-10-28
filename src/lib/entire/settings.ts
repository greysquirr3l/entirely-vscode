import {
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalString,
	requireString,
	type DecodeResult,
} from './decode';

/** A value a strategy option may hold. */
export type StrategyOptionValue = string | number | boolean;

/** A forge a checkpoint repository can be on. */
export type CheckpointProvider = 'github' | 'gitlab';

/**
 * The repository checkpoints are uploaded to, when it is one of their own.
 *
 * The provider is the one the CLI names — `github` or `gitlab` — and the
 * repository is `owner/repo`.
 */
export interface CheckpointRemote {
	/**
	 * The provider the repository is on.
	 *
	 * Absent when the CLI names a provider the extension does not know,
	 * which is a reason to report the repository and not to decide what
	 * can be done about it.
	 */
	readonly provider?: CheckpointProvider;
	/** The repository, as `owner/repo`. */
	readonly repo: string;
}

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
	/** The repository checkpoints are uploaded to, when it is one of their own. */
	readonly checkpointRemote?: CheckpointRemote;
	/** The options given to the CLI's strategies, as they are. */
	readonly strategyOptions?: Readonly<Record<string, StrategyOptionValue>>;
}

/**
 * Decodes the repository checkpoints are uploaded to.
 *
 * A provider the extension does not know is left out rather than guessed
 * at, so that a new provider is reported as an unknown one instead of
 * being mistaken for GitHub.
 */
function decodeCheckpointRemote(
	value: unknown,
	path: string,
): DecodeResult<CheckpointRemote | undefined> {
	if (value === undefined || value === null) {
		return { ok: true, value: undefined };
	}

	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const repo = requireString(read, 'repo');
	if (!repo.ok) {
		return repo;
	}

	const provider = optionalString(read, 'provider');
	if (!provider.ok) {
		return provider;
	}

	if (provider.value !== 'github' && provider.value !== 'gitlab') {
		return { ok: true, value: { repo: repo.value } };
	}

	return { ok: true, value: { provider: provider.value, repo: repo.value } };
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
	let checkpointRemote: CheckpointRemote | undefined;
	if (read.record['strategy_options'] !== undefined) {
		const strategyRecord = decodeRecord(
			read.record['strategy_options'],
			'settings.strategy_options',
		);
		if (!strategyRecord.ok) {
			return strategyRecord;
		}

		const decoded = decodeStrategyOptions(strategyRecord.value, 'settings.strategy_options');
		if (!decoded.ok) {
			return decoded;
		}
		strategyOptions = decoded.value;

		const remote = decodeCheckpointRemote(
			strategyRecord.value['checkpoint_remote'],
			'settings.strategy_options.checkpoint_remote',
		);
		if (!remote.ok) {
			return remote;
		}
		checkpointRemote = remote.value;
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
			checkpointRemote,
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
		checkpointRemote: first(layer => layer.checkpointRemote),
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

	if (settings.checkpointRemote) {
		const provider = settings.checkpointRemote.provider ?? 'unknown';
		summary.push(
			`strategy_options.checkpoint_remote: ${provider}:${settings.checkpointRemote.repo}`,
		);
	}

	return summary;
}
