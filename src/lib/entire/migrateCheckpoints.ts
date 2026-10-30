import { describeActingLogin, type ControlConfirmation } from './controlPlaneActions';
import type { AccountContext } from './accountContext';

/** Where the CLI writes the per-checkpoint refs. */
export const CHECKPOINT_REF_PREFIX = 'refs/entire/checkpoints/';

/**
 * The question before the migration is applied.
 *
 * It is a local, additive change, so it needs agreement but no typed
 * confirmation. It names the repository and the login it runs as, and says
 * what is not done: no push, no deletion, no change of store.
 */
export function confirmMigration(
	repository: string,
	acting: Pick<AccountContext, 'handle' | 'name'>,
	refCount: number | undefined,
): ControlConfirmation {
	const current = refCount === undefined ? 'The current number of refs there could not be counted.' : `Currently ${refCount} ref${refCount === 1 ? '' : 's'} exist there.`;
	return {
		message: `Create per-checkpoint refs in ${repository} as ${describeActingLogin(acting)}?`,
		detail:
			'This runs `entire doctor migrate-checkpoints`. ' +
			`It copies each checkpoint on the entire/checkpoints/v1 branch into its own local ref under ${CHECKPOINT_REF_PREFIX}. ` +
			'The branch is not changed or deleted, the configured checkpoint store is not changed, and nothing is pushed. ' +
			'The new refs are queued, and the CLI pushes them on a later push once the git-refs store is your primary. ' +
			'There is no undo in the CLI; removing the refs afterwards needs git. ' +
			current,
		action: 'Create the refs',
	};
}

/** How a migration ended, judged by counting the refs again. */
export type MigrationOutcome =
	| { readonly kind: 'migrated'; readonly created: number }
	| { readonly kind: 'unchanged' }
	| { readonly kind: 'unconfirmed'; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string }
	| { readonly kind: 'cancelled' };

/** The outcome of a run the CLI reported as successful, from the counts before and after. */
export function classifyMigration(before: number | undefined, after: number | undefined): MigrationOutcome {
	if (before === undefined || after === undefined) {
		return { kind: 'unconfirmed', detail: 'the CLI finished, but the checkpoint refs could not be counted to check' };
	}
	if (after > before) {
		return { kind: 'migrated', created: after - before };
	}
	return { kind: 'unchanged' };
}

/** The sentence that says how a migration ended. */
export function describeMigrationOutcome(outcome: MigrationOutcome): string {
	switch (outcome.kind) {
		case 'migrated':
			return `Created ${outcome.created} ref${outcome.created === 1 ? '' : 's'} under ${CHECKPOINT_REF_PREFIX}. They are queued for push and go out on your next push.`;
		case 'unchanged':
			return 'No new refs were created: every checkpoint was already converted, or there were none to convert.';
		case 'unconfirmed':
			return `The migration is unconfirmed: ${outcome.detail}.`;
		case 'failed':
			return `The migration failed: ${outcome.detail}. It was not retried.`;
		case 'cancelled':
			return 'The migration was cancelled. Some refs may already exist; running it again is safe, because the command skips checkpoints already converted.';
	}
}
