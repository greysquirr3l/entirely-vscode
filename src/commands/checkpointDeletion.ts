import {
	DELETE_SCOPE_WORDS,
	classifyReadBack,
	decideDeletable,
	deletionConfirmation,
	type DeleteScope,
	type DeletionConfirmation,
} from '../lib/entire/checkpointDeletion';
import { describeActingLogin } from '../lib/entire/controlPlaneActions';
import type { AccountContext } from '../lib/entire/accountContext';
import type { Checkpoint } from '../lib/entire/types';
import type { CheckpointDeletionSource } from '../services/checkpointDeletion';
import type { CheckpointDetailSource, CheckpointSource } from '../services/checkpointSource';

/** How a checkpoint deletion ended. */
export type DeletionResult = 'cancelled' | 'no-login' | 'done' | 'unconfirmed' | 'failed';

/** One of the choices a person makes about how far a deletion reaches. */
export interface ScopeChoice {
	readonly scope: DeleteScope;
	readonly label: string;
	readonly description: string;
}

/** The two choices, in the order they are offered. */
export const DELETE_SCOPES: readonly ScopeChoice[] = [
	{
		scope: 'everywhere',
		label: DELETE_SCOPE_WORDS.everywhere,
		description: 'Reaches Entire and the team.',
	},
	{
		scope: 'local-only',
		label: DELETE_SCOPE_WORDS['local-only'],
		description: 'Deletes the local copy only.',
	},
];

/** What the deletion command asks the person. */
export interface CheckpointDeletionUi {
	/** True only when the person chose to go ahead. */
	confirm(prompt: DeletionConfirmation): Promise<boolean>;
	/** The checkpoint to delete, chosen by the person and never for them. */
	chooseCheckpoint(title: string, checkpoints: readonly Checkpoint[]): Promise<Checkpoint | undefined>;
	/** Which copies the deletion reaches. */
	chooseScope(title: string, choices: readonly ScopeChoice[]): Promise<DeleteScope | undefined>;
	/** The id the person types, when one has to be typed. */
	typeToConfirm(id: string): Promise<string | undefined>;
	withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
}

/** What the deletion command needs. */
export interface CheckpointDeletionDependencies {
	readonly checkpoints: CheckpointSource;
	readonly detail: CheckpointDetailSource;
	readonly deletion: CheckpointDeletionSource;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly ui: CheckpointDeletionUi;
	/** Reads the Checkpoints view again. */
	readonly refresh: () => void | Promise<void>;
}

/**
 * Deletes one checkpoint, after the user has been told what it would reach.
 *
 * The order is the point. The checkpoint is chosen by the person, the
 * login is read before anything is asked, the scope is chosen before the
 * CLI is asked what it would do, and the CLI's own dry-run is what the
 * confirmation shows. Nothing is deleted until the person has agreed to
 * that text — and a deletion that reaches a remote is not agreed to until
 * the full id has been typed.
 *
 * One checkpoint is deleted per action. There is no batch form, and the
 * deletion is never run a second time: not after a refusal, and not after
 * a timeout. What happened is decided by reading the checkpoint list
 * again, and when that read cannot tell, the result is reported as not
 * confirmed rather than as a deletion.
 */
export async function deleteCheckpoint(
	deps: CheckpointDeletionDependencies,
	target?: Checkpoint,
): Promise<DeletionResult> {
	const listing = await deps.checkpoints();
	const chosen = target ?? (await deps.ui.chooseCheckpoint('Delete which checkpoint?', listing.checkpoints));
	if (!chosen) {
		return 'cancelled';
	}

	const detail = await deps.detail(chosen.id);
	const decision = decideDeletable(chosen, detail);
	if (!decision.ok) {
		await deps.ui.warn(decision.detail);
		return 'cancelled';
	}

	const acting = await deps.acting();
	if (!acting) {
		await deps.ui.warn('No Entire login is available. Log in to delete a checkpoint.');
		return 'no-login';
	}

	const supported = await deps.deletion.supported();
	if (!supported.ok) {
		await deps.ui.warn(supported.detail);
		return 'failed';
	}

	const scope = await deps.ui.chooseScope(`Delete which copies of checkpoint ${chosen.id}?`, DELETE_SCOPES);
	if (!scope) {
		return 'cancelled';
	}

	const before = listing.checkpoints.map(checkpoint => checkpoint.id);

	const preview = await deps.ui.withProgress('Reading what would be deleted…', () =>
		deps.deletion.preview(chosen.id, scope),
	);
	if (preview.kind === 'failed') {
		await deps.ui.warn(`Could not read what would be deleted: ${preview.detail}`);
		return 'failed';
	}

	const confirmation = deletionConfirmation({
		id: chosen.id,
		scope,
		acting: describeActingLogin(acting),
		branch: detail?.branch,
		dryRun: preview.text,
	});
	if (!(await deps.ui.confirm(confirmation))) {
		return 'cancelled';
	}
	if (confirmation.typeToConfirm) {
		const typed = await deps.ui.typeToConfirm(confirmation.typeToConfirm);
		if (typed === undefined || typed.trim() !== confirmation.typeToConfirm) {
			return 'cancelled';
		}
	}

	const outcome = await deps.ui.withProgress(`Deleting checkpoint ${chosen.id}…`, () =>
		deps.deletion.delete(chosen.id, scope, acting.name),
	);
	await deps.refresh();

	if (outcome.kind === 'failed') {
		await deps.ui.warn(`Could not delete checkpoint ${chosen.id}: ${outcome.detail}`);
		return 'failed';
	}

	const readBack = classifyReadBack(before, await readIds(deps), chosen.id);
	if (readBack === 'gone') {
		// The local-only case says what the CLI's own output says: no
		// remote was contacted, so a remote may still hold the checkpoint.
		await deps.ui.inform(
			scope === 'everywhere'
				? `Deleted checkpoint ${chosen.id} as ${acting.handle}. ` +
					'Other checkpoints of the session keep its transcript visible on Entire.'
				: `Deleted the local copy of checkpoint ${chosen.id} as ${acting.handle}. ` +
					'No checkpoint remote was contacted, so a remote may still hold it.',
		);
		return 'done';
	}
	await deps.ui.warn(
		readBack === 'still-listed'
			? `Checkpoint ${chosen.id} is still listed, so the deletion is not confirmed.`
			: `The checkpoint list could not be read back, so the deletion is not confirmed.`,
	);
	return 'unconfirmed';
}

/**
 * The checkpoint a command was invoked on, when the tree named one.
 *
 * A row in the Checkpoints view carries the checkpoint's id, so the
 * command can be told which one was clicked. A command run from the
 * palette names none, and the person is asked to choose. A list of rows
 * names none either: there is no batch form, and a list is asked about
 * one checkpoint at a time.
 */
export function checkpointFromTarget(
	target: unknown,
	find: (id: string) => Checkpoint | undefined,
): Checkpoint | undefined {
	if (typeof target !== 'object' || target === null || Array.isArray(target)) {
		return undefined;
	}
	const node = target as { id?: unknown; checkpoint?: unknown };
	if (typeof node.checkpoint === 'object' && node.checkpoint !== null) {
		return node.checkpoint as Checkpoint;
	}
	return typeof node.id === 'string' ? find(node.id) : undefined;
}

/**
 * Reads the checkpoint list again, for the read-back.
 *
 * A list that could not be read is `undefined`, not an empty list. An
 * empty list says the checkpoint is gone; a list that was never read says
 * nothing at all, and the two must not be confused.
 */
async function readIds(deps: CheckpointDeletionDependencies): Promise<readonly string[] | undefined> {
	const listing = await deps.checkpoints();
	if (listing.emptyReason !== undefined) {
		return undefined;
	}
	return listing.checkpoints.map(checkpoint => checkpoint.id);
}