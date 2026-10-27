import {
	decodeCheckpointDetail,
	decodeCheckpointList,
	unwrap,
	type Checkpoint,
	type CheckpointDetail,
} from '../lib/entire';
import { CliRunner } from './cli';

/**
 * Reads the checkpoints the CLI has recorded for the current branch.
 *
 * The list is scoped to the branch the user is on, so it shows the work
 * that led to the code in front of them rather than the whole repository's
 * history.
 */
export interface CheckpointListing {
	readonly checkpoints: readonly Checkpoint[];
	/** Why there is nothing to show, when there is nothing to show. */
	readonly emptyReason?: string;
}

/** Where the checkpoint list comes from. */
export type CheckpointSource = () => Promise<CheckpointListing>;

/** Where a single checkpoint's detail comes from. */
export type CheckpointDetailSource = (id: string) => Promise<CheckpointDetail | undefined>;

/** Builds a source that reads the checkpoint list from the CLI. */
export function createCheckpointSource(
	runner: CliRunner,
	workspaceRoot: () => string | undefined,
): CheckpointSource {
	return async (): Promise<CheckpointListing> => {
		const result = await runner.runJson(
			['checkpoint', 'list', '--json'],
			value => unwrap(decodeCheckpointList(value)),
			{ cwd: workspaceRoot() },
		);

		if (!result.ok) {
			return { checkpoints: [], emptyReason: result.detail };
		}

		return { checkpoints: result.value };
	};
}

/**
 * Builds a source that reads one checkpoint's detail from the CLI.
 *
 * The list the CLI returns says what a checkpoint is; this says what it
 * touched, which is what a diff is made of.
 */
export function createCheckpointDetailSource(
	runner: CliRunner,
	workspaceRoot: () => string | undefined,
): CheckpointDetailSource {
	return async (id: string): Promise<CheckpointDetail | undefined> => {
		const result = await runner.runJson(
			['checkpoint', 'explain', id, '--json'],
			value => unwrap(decodeCheckpointDetail(value)),
			{ cwd: workspaceRoot() },
		);

		return result.ok ? result.value : undefined;
	};
}
