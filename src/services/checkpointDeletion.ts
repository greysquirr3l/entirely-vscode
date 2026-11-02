import { cleanCliText, failureDetail, isCheckpointId } from '../lib/entire';
import {
	checkpointDeleteArguments,
	planDeleteFlags,
	type DeleteFlags,
	type DeletePlan,
	type DeleteScope,
} from '../lib/entire/checkpointDeletion';
import type { CliRunner } from './cli';

/** What the service needs to do its job. */
export interface CheckpointDeletionOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, a deletion may take. */
	readonly timeoutSeconds: () => number;
}

/** What the CLI's dry-run said. */
export type DeletionPreview =
	| { readonly kind: 'done'; readonly text: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** How a deletion ended. */
export type DeletionOutcome =
	| { readonly kind: 'done'; readonly summary: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where checkpoint deletions come from. */
export interface CheckpointDeletionSource {
	/**
	 * Whether this CLI can delete a checkpoint at all.
	 *
	 * Asked before the user is asked anything, so nobody is asked which
	 * copies to delete by a CLI that cannot delete any.
	 */
	supported(): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }>;
	/** Asks the CLI what a deletion would remove, without removing anything. */
	preview(id: string, scope: DeleteScope): Promise<DeletionPreview>;
	/** Deletes, as the login the user confirmed. */
	delete(id: string, scope: DeleteScope, acting: string): Promise<DeletionOutcome>;
}

/**
 * Runs `entire checkpoint delete`.
 *
 * The flags come from the CLI's own help, read for each call and never
 * cached, so a CLI that changes between two calls is followed. The id is
 * checked before it reaches an argument list and goes in the CLI's own
 * operand position. The deletion runs once, as the login the user
 * confirmed, and is never run again — not after a timeout, and not after a
 * refusal. A CLI that lacks the command, or whose help does not describe
 * the flags this needs, is a failure with a reason and nothing is run.
 */
export class CheckpointDeletionService implements CheckpointDeletionSource {
	constructor(private readonly options: CheckpointDeletionOptions) {}

	async supported(): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }> {
		const plan = await this.plan();
		return plan.ok ? { ok: true } : { ok: false, detail: plan.detail };
	}

	async preview(id: string, scope: DeleteScope): Promise<DeletionPreview> {
		const plan = await this.plan();
		if (!plan.ok) {
			return { kind: 'failed', detail: plan.detail };
		}
		if (!isCheckpointId(id)) {
			return { kind: 'failed', detail: 'the checkpoint id is not one the CLI can be given' };
		}
		const result = await this.options.runner.run(checkpointDeleteArguments(plan, id, scope, 'preview'), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			withholdBodies: true,
			redactOperands: true,
		});
		if (!result.ok) {
			return { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		return { kind: 'done', text: cleanCliText(result.stdout || result.stderr) };
	}

	async delete(id: string, scope: DeleteScope, acting: string): Promise<DeletionOutcome> {
		const plan = await this.plan();
		if (!plan.ok) {
			return { kind: 'failed', detail: plan.detail };
		}
		if (!isCheckpointId(id)) {
			return { kind: 'failed', detail: 'the checkpoint id is not one the CLI can be given' };
		}
		const result = await this.options.runner.run(checkpointDeleteArguments(plan, id, scope, 'delete'), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			context: acting,
			withholdBodies: true,
			redactOperands: true,
		});
		if (!result.ok) {
			return { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		return { kind: 'done', summary: cleanCliText(result.stdout || result.stderr) };
	}

	/** Reads the command's help and works out its flags. */
	private async plan(): Promise<DeletePlan<DeleteFlags>> {
		const usage = await this.options.runner.usage('checkpoint delete', {
			cwd: this.options.workspaceRoot(),
			// The help is the CLI's own manual. It is read, not kept, and
			// it has no place in the output channel.
			withholdBodies: true,
		});
		if (!usage.ok) {
			return { ok: false, detail: explainHelpFailure(usage.reason, usage.detail) };
		}
		return planDeleteFlags(usage.value.raw, usage.value.flags);
	}

	private timeoutMs(): number {
		return this.options.timeoutSeconds() * 1000;
	}
}

/** Says why the help could not be read, with something the user can do. */
function explainHelpFailure(reason: string, detail: string): string {
	switch (reason) {
		case 'absent':
			return 'the Entire CLI is not installed; install it to delete a checkpoint';
		case 'broken':
		case 'spawn-failed':
		case 'timeout':
			return detail;
		default:
			return "this version of the Entire CLI has no 'checkpoint delete'; update the CLI";
	}
}
