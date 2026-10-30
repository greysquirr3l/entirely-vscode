import { branchLabel, type TrailApproval, type TrailComment, type TrailMergePlan, type TrailSelector } from './trail';

/**
 * The rules a review action follows.
 *
 * These are the decisions the extension makes on its own, away from the
 * CLI and away from the editor: whether an approval landed under the
 * acting login, whether a checkout would lose work, and what a merge
 * would do. They are pure so that they can be tested without an
 * extension host and without a network.
 */

/**
 * Whether the CLI refused a comment because it is in an agent session.
 *
 * The CLI says trail discussions are for people, and that an agent
 * session should post a finding instead. When the extension is running
 * inside an agent session it inherits that refusal, so the refusal is
 * recognised here and the finding is posted in its place — the review
 * reaches the trail either way.
 *
 * The refusal is recognised by what the CLI says about it rather than
 * by a status code, because the CLI uses one status for every way a
 * write can be refused. The CLI writes the refusal to its error
 * stream, so that is where it is looked for.
 */
export function refusesCommentFromAgentSession(stderr: string): boolean {
	return /refusing\s+`entire trail comment add`/i.test(stderr);
}

/**
 * Whether a piece of review evidence is attributed to a login.
 *
 * The CLI records the forge handle of whoever made the change, and the
 * extension acts as one login. The two are compared here so that the
 * extension can say that an approval was *this* reviewer's rather than
 * merely that one exists.
 *
 * The comparison is exact. A handle that merely contains the acting
 * handle is somebody else's.
 */
export function isAttributedTo(
	author: string | undefined,
	actingHandle: string | undefined,
): boolean {
	if (!author || !actingHandle) {
		return false;
	}

	return author === actingHandle;
}

/** The outcome of checking an approval against the acting login. */
export type ApprovalAttribution =
	| {
			/** The approval landed under the acting login. */
			readonly kind: 'attributed';
			readonly approval: TrailApproval;
	  }
	| {
			/**
			 * The change was approved, but not by the acting login.
			 *
			 * Someone else's approval is shown as it is: it is real
			 * review evidence, and pretending the acting login made it
			 * would be a lie about who reviewed the work.
			 */
			readonly kind: 'other-reviewer';
			readonly approval: TrailApproval;
	  }
	| {
			/** Nothing has approved the change. */
			readonly kind: 'unapproved';
	  };

/**
 * Finds the approval that belongs to the acting login.
 *
 * The most recent approval wins: a reviewer who approved, then asked
 * for changes, then approved again is showing their final decision.
 */
export function attributeApproval(
	approvals: readonly TrailApproval[],
	actingHandle: string | undefined,
): ApprovalAttribution {
	if (approvals.length === 0) {
		return { kind: 'unapproved' };
	}

	const own = approvals.filter(approval => isAttributedTo(approval.author, actingHandle));
	if (own.length > 0) {
		return { kind: 'attributed', approval: own[own.length - 1] };
	}

	return { kind: 'other-reviewer', approval: approvals[approvals.length - 1] };
}

/**
 * Finds the discussion the acting login wrote in last.
 *
 * A comment is review evidence that has to be attributable, so the same
 * rule as for an approval applies: the reader must be able to tell who
 * said it.
 */
export function attributeComment(
	comments: readonly TrailComment[],
	actingHandle: string | undefined,
): TrailComment | undefined {
	const own = comments.filter(comment =>
		isAttributedTo(comment.lastMessageAuthor, actingHandle),
	);

	if (own.length > 0) {
		return own[own.length - 1];
	}

	return undefined;
}

/**
 * A file the editor has unsaved changes in.
 *
 * The editor knows about unsaved work in a way the working tree does
 * not: a buffer that was never written to disk is invisible to git, and
 * so invisible to any check that looks at the repository.
 */
export interface UnsavedFile {
	/** The file's path, as the editor knows it. */
	readonly path: string;
	/** The name of the editor that has it open. */
	readonly name?: string;
}

/**
 * Why a checkout was refused.
 *
 * A checkout moves the working tree. If the editor has unsaved work, a
 * checkout can throw that work away, so the extension refuses rather
 * than letting the change happen and the work be lost.
 */
export interface CheckoutRefusal {
	readonly kind: 'unsaved-work';
	/** The files that hold unsaved work. */
	readonly files: readonly UnsavedFile[];
}

/**
 * Whether a checkout would lose unsaved work.
 *
 * The refusal is only for work the editor holds and the working tree
 * does not: a checkout that would fail on its own is the CLI's business,
 * and the extension does not second-guess it.
 */
export function refuseCheckoutForUnsavedWork(
	unsaved: readonly UnsavedFile[],
): CheckoutRefusal | undefined {
	if (unsaved.length === 0) {
		return undefined;
	}

	return { kind: 'unsaved-work', files: unsaved };
}

/**
 * How a refusal is explained to the user.
 *
 * The explanation names the files, because "you have unsaved work" is
 * not something the user can act on and "src/app.ts has unsaved changes"
 * is.
 */
export function describeCheckoutRefusal(refusal: CheckoutRefusal): string {
	const names = refusal.files.map(file => file.name ?? file.path);

	const list =
		names.length === 1
			? names[0]
			: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

	return (
		`Entirely did not check out the trail because ${list} ${
			names.length === 1 ? 'has' : 'have'
		} unsaved changes. Save the ${
			names.length === 1 ? 'file' : 'files'
		}, or stash them, and try again.`
	);
}

/**
 * How a merge is described before it is confirmed.
 *
 * The description names what would be merged — the branch, where it
 * would go, and the commit at its head — so that the confirmation says
 * which work is about to land rather than merely asking whether to
 * proceed.
 */
export function describeMergePlan(plan: TrailMergePlan): string {
	const branch = plan.branch ?? 'the change';
	const base = plan.base ? ` into ${plan.base}` : '';

	const head = plan.headSha ? ` at ${plan.headSha.slice(0, 7)}` : '';

	return `Merging ${branch}${base}${head} (${plan.change})`;
}

/**
 * Why a merge cannot go ahead, in the CLI's own words.
 *
 * The CLI says what stands in the way and why. The extension passes
 * those reasons on rather than inventing its own, so the user is told
 * the same thing here as they would be in the CLI.
 */
export function describeMergeBlockers(plan: TrailMergePlan): string {
	const reasons = plan.reasons.length > 0 ? plan.reasons : plan.blockers;

	if (reasons.length === 0) {
		return 'Entirely did not merge the trail: the CLI did not say why.';
	}

	return `Entirely did not merge the trail: ${reasons.join('; ')}.`;
}

/**
 * How a change is named in a list.
 *
 * A change is a branch in a repository, and the branch is what a
 * reviewer recognises, so the branch leads.
 */
export function describeChange(change: {
	readonly repository: string;
	readonly number: number;
	readonly branch: string;
	readonly title?: string;
}): string {
	const title = change.title ? ` — ${change.title}` : '';

	return `${branchLabel(change)} (${change.repository}/${change.number})${title}`;
}

/**
 * How a selector is named in a message.
 *
 * The CLI's own form is used, so that what the extension says and what
 * the CLI would accept are the same string.
 */
export function describeSelector(selector: TrailSelector): string {
	switch (selector.kind) {
		case 'trail':
			return `trail #${selector.number}`;
		case 'trail-id':
			return `trail ${selector.id}`;
		case 'change':
			return `change ${selector.repository}/${selector.number}`;
	}
}
