import { isCheckpointId } from './checkpoint';
import { isImportedCheckpoint } from './importedHistory';
import { END_OF_OPTIONS } from './operand';
import { cleanCliText, findFlag, flagsOf } from './sessionLifecycle';
import type { HelpFlag } from './search';
import type { Checkpoint, CheckpointDetail } from './types';

/**
 * Which copies of a checkpoint a deletion reaches.
 *
 * `everywhere` is the local copy and every checkpoint remote that holds
 * it. `local-only` leaves the remotes alone — except on the git-branch
 * backend, where the CLI says a local removal still reaches the sync
 * remote on the next push. The wording of the confirmation follows the
 * CLI's own, not this type's.
 */
export type DeleteScope = 'everywhere' | 'local-only';

/** The scope's own words, as the picker and the modal both give them. */
export const DELETE_SCOPE_WORDS: Record<DeleteScope, string> = {
	everywhere: 'This machine and every checkpoint remote',
	'local-only': 'This machine only',
};

/** Whether a call previews the deletion or performs it. */
export type DeleteMode = 'preview' | 'delete';

/** The flags a checkpoint deletion needs, or why they could not be found. */
export type DeletePlan<T> =
	| ({ readonly ok: true } & T)
	| { readonly ok: false; readonly detail: string };

/** What deleting a checkpoint needs from the CLI's help. */
export interface DeleteFlags {
	/** The flag that prints what would be deleted and changes nothing. */
	readonly dryRun: string;
	/** The flag that skips the CLI's own prompt, which needs a terminal. */
	readonly skipPrompt: string;
	/** The flag that leaves every remote untouched. */
	readonly localOnly: string;
}

/**
 * The help lines the flags are found by.
 *
 * Nothing here names a flag. Each is chosen by what the CLI says the flag
 * does, so a CLI that renames one is followed rather than broken.
 */
const DRY_RUN = /\bwould be deleted\b/i;
const SKIP_PROMPT = /\bwithout asking\b.*\bconfirmation\b/i;
const LOCAL_ONLY = /\bonly the local copy\b/i;
const REMOTE_SELECTION = /\blimit remote deletion\b/i;

function unreadable(what: string): { readonly ok: false; readonly detail: string } {
	return {
		ok: false,
		detail: `this version of the Entire CLI does not describe ${what} for 'checkpoint delete'; update the CLI`,
	};
}

/**
 * Works out the flags a checkpoint deletion needs, from the CLI's help.
 *
 * The dry-run flag is not optional. Without it there is no preview, and a
 * deletion the user agrees to without being told what it would remove is
 * the one thing this command must never do.
 */
export function planDeleteFlags(
	help: string,
	fallback: readonly HelpFlag[] = [],
): DeletePlan<DeleteFlags> {
	const flags = flagsOf(help, fallback);
	// The remote-selection flag mentions the local copy too. It is found
	// first so it can be kept out of the search for the local-only flag.
	const remote = findFlag(flags, REMOTE_SELECTION);
	const others = remote ? [remote] : [];

	const dryRun = findFlag(flags, DRY_RUN, others);
	if (!dryRun) {
		return unreadable('a flag that previews the deletion');
	}
	const skipPrompt = findFlag(flags, SKIP_PROMPT, others);
	if (!skipPrompt) {
		return unreadable('a flag that skips the confirmation');
	}
	const localOnly = findFlag(flags, LOCAL_ONLY, others);
	if (!localOnly) {
		return unreadable('a flag that limits the deletion to this machine');
	}
	return {
		ok: true,
		dryRun: dryRun.name,
		skipPrompt: skipPrompt.name,
		localOnly: localOnly.name,
	};
}

/**
 * `entire checkpoint delete <id>`, as a preview or as the deletion itself.
 *
 * The id goes after the end-of-options marker, because the CLI takes it as
 * an operand and the extension never lets a value it did not check become
 * an option. The skip-prompt flag is passed only for the deletion, and
 * only because the extension has asked the user itself by then.
 */
export function checkpointDeleteArguments(
	plan: DeleteFlags,
	id: string,
	scope: DeleteScope,
	mode: DeleteMode,
): readonly string[] {
	const args = ['checkpoint', 'delete'];
	if (mode === 'preview') {
		args.push(plan.dryRun);
	} else {
		args.push(plan.skipPrompt);
		if (scope === 'local-only') {
			args.push(plan.localOnly);
		}
	}
	args.push(END_OF_OPTIONS, id);
	return args;
}

/** Why a checkpoint cannot be deleted. */
export type DeletableRefusal = 'imported' | 'bad-id';

/** Whether a checkpoint may be deleted, and why not when it may not. */
export type DeletableDecision =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: DeletableRefusal; readonly detail: string };

/**
 * Decides whether a checkpoint may be deleted at all.
 *
 * Imported history is read-only. The extension says so and runs nothing:
 * an import is a copy of work that came from somewhere else, and the CLI
 * has no way to remove it from where it came from.
 */
export function decideDeletable(
	checkpoint: Pick<Checkpoint, 'id' | 'imported'>,
	detail?: Pick<CheckpointDetail, 'strategy' | 'sessions'>,
): DeletableDecision {
	if (isImportedCheckpoint(checkpoint, detail)) {
		return {
			ok: false,
			reason: 'imported',
			detail: 'imported history is read-only, so it cannot be deleted',
		};
	}
	if (!isCheckpointId(checkpoint.id)) {
		return {
			ok: false,
			reason: 'bad-id',
			detail: 'the checkpoint id is not one the CLI can be given',
		};
	}
	return { ok: true };
}

/**
 * How much of the CLI's plan is shown.
 *
 * The plan is the CLI's own text: the checkpoint, the local ref, every
 * remote and whether it holds the checkpoint, the sessions whose token
 * counts go with it, and every other checkpoint of those sessions — and
 * that last list can run to a hundred lines. What matters comes first,
 * so the plan is cut at this length and the cut is said out loud rather
 * than left as a silent ellipsis.
 */
const PLAN_TEXT_LIMIT = 1200;

/** What the CLI's dry-run said. */
export interface DryRunReading {
	/** The CLI's own words, cleaned and bounded. */
	readonly text: string;
	/** Whether the plan was too long to show whole. */
	readonly truncated: boolean;
}

/**
 * Reads the CLI's dry-run output.
 *
 * The shape of the output is the CLI's. Observed against the real CLI
 * 0.12.2, it opens with the checkpoint, then the local ref, then every
 * remote and whether it holds the checkpoint, then the sessions, then
 * the other checkpoints of those sessions, and closes with "Dry run:
 * nothing was changed." The CLI's words are kept as they are; the only
 * thing this changes is how much of them is shown.
 */
export function decodeDryRun(output: string): DryRunReading {
	const full = cleanCliText(output, Number.MAX_SAFE_INTEGER);
	const truncated = full.length > PLAN_TEXT_LIMIT;
	const text = truncated
		? `${full.slice(0, PLAN_TEXT_LIMIT - 1).trimEnd()}\n… the rest of the plan was not shown.`
		: full;
	return { text, truncated };
}

/** What a deletion confirmation needs to say. */
export interface DeletionConfirmationInput {
	/** The checkpoint being deleted. */
	readonly id: string;
	/** Which copies the deletion reaches. */
	readonly scope: DeleteScope;
	/** The login the deletion runs as, in words the user recognises. */
	readonly acting: string;
	/** The branch the checkpoint is on, when the detail gave one. */
	readonly branch?: string;
	/** The CLI's own dry-run text. */
	readonly dryRun?: string;
}

/** The question asked before a checkpoint is deleted. */
export interface DeletionConfirmation {
	readonly message: string;
	readonly detail: string;
	/** The label of the button that goes ahead. */
	readonly action: string;
	/** The full id the user has to type, when one has to be typed. */
	readonly typeToConfirm?: string;
}

/** What the CLI says about the copies a deletion leaves behind. */
const SESSION_TRANSCRIPT =
	"Other checkpoints of the same session are not deleted. Each one carries the session's full transcript, " +
	'so the session stays visible on Entire while any of them remain.';

/** What the CLI says about the branch its legacy checkpoints live on. */
const LEGACY_BRANCH =
	'On the entire/checkpoints/v1 branch this removes the checkpoint from the branch tip only: ' +
	"the branch's history still contains it.";

/**
 * What the CLI says about a local removal and the checkpoint remotes.
 *
 * Observed against the real CLI 0.12.2: with `--local-only` the local
 * copy is deleted and no remote is contacted, and the CLI says so —
 * "checkpoints was not checked (--local-only) and may still hold it". It
 * does not refuse, on the git-refs backend. The git-branch backend is
 * the one that reaches the sync remote on the next push, and the CLI's
 * own help refuses `--local-only` there while that remote holds a copy.
 */
const LOCAL_SYNC_REMOTE =
	'No checkpoint remote is contacted, so a remote may still hold the checkpoint. ' +
	'On a git-branch backend a local removal reaches the sync remote on the next git push.';

/**
 * Builds the question asked before a checkpoint is deleted.
 *
 * The two scopes are described in the CLI's own words, because they are
 * not symmetric: a deletion that reaches a remote cannot be undone, and a
 * local one is not always only local. Neither text promises something the
 * CLI does not promise.
 */
export function deletionConfirmation(input: DeletionConfirmationInput): DeletionConfirmation {
	const lines: string[] = [
		`Checkpoint ${input.id}.`,
		input.branch ? `Branch ${input.branch}.` : 'Commit not reported.',
		`Acting as ${input.acting}.`,
		DELETE_SCOPE_WORDS[input.scope],
	];
	if (input.dryRun) {
		lines.push('', input.dryRun);
	}
	if (input.scope === 'everywhere') {
		lines.push(
			'',
			'This reaches this machine and every checkpoint remote that holds the checkpoint. ' +
				'A deletion that reaches a remote cannot be undone.',
			'',
			SESSION_TRANSCRIPT,
			'',
			LEGACY_BRANCH,
		);
		return {
			message: `Delete checkpoint ${input.id}?`,
			detail: lines.join('\n'),
			action: 'Delete Checkpoint Everywhere',
			typeToConfirm: input.id,
		};
	}
	lines.push('', LOCAL_SYNC_REMOTE);
	return {
		message: `Delete checkpoint ${input.id}?`,
		detail: lines.join('\n'),
		action: 'Delete Local Copy',
	};
}

/** What a read-back of the checkpoint list says about the deletion. */
export type ReadBack = 'gone' | 'still-listed' | 'unknown';

/**
 * Decides what a re-read of the checkpoint list says happened.
 *
 * A checkpoint that was listed before and is not listed now is gone. One
 * that is still listed was not deleted. A list that could not be read, or
 * a checkpoint that was not in the list to begin with, proves nothing —
 * and nothing is claimed.
 */
export function classifyReadBack(
	before: readonly string[],
	after: readonly string[] | undefined,
	id: string,
): ReadBack {
	if (after === undefined) {
		return 'unknown';
	}
	if (after.includes(id)) {
		return 'still-listed';
	}
	if (!before.includes(id)) {
		return 'unknown';
	}
	return 'gone';
}
