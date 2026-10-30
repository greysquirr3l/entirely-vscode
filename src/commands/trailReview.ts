import * as vscode from 'vscode';

import {
	attributeApproval,
	attributeComment,
	changePicks,
	describeChange,
	describeCheckoutRefusal,
	describeMergeBlockers,
	describeMergePlan,
	describePick,
	describePickDetail,
	refuseCheckoutForUnsavedWork,
	trailPicks,
	type TrailPick,
} from '../lib/entire';
import type { Trail, TrailSelector } from '../lib/entire';
import type { TrailService, TrailWorkspace } from '../services/trailService';

/** What the commands need to do their job. */
export interface TrailReviewDependencies {
	readonly trails: TrailService;
	/** The forge handle of the login the extension is acting as. */
	readonly actingHandle: () => string | undefined;
}

/**
 * The trails of the workspace, as the CLI knows them.
 *
 * The list is taken from the project the workspace's repository belongs
 * to and filtered to that repository, so the extension offers the work
 * of this repository rather than every trail of the project.
 */
async function listTrails(
	deps: TrailReviewDependencies,
): Promise<{ readonly workspace: TrailWorkspace; readonly trails: readonly Trail[] } | undefined> {
	const workspace = await deps.trails.workspace();

	if (workspace.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not work out which trails this workspace belongs to: ${workspace.detail}`,
		);
		return undefined;
	}

	const list = await deps.trails.list(workspace.value.project, workspace.value.repository);

	if (list.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not list the trails of ${workspace.value.project}: ${list.detail}`,
		);
		return undefined;
	}

	return { workspace: workspace.value, trails: list.value.items };
}

/**
 * Asks the reviewer to choose one of the things on offer.
 *
 * The list is what the CLI returned, in the order it returned it, so
 * the reviewer sees the same work the CLI would show them.
 */
async function choose(
	picks: readonly TrailPick[],
	title: string,
	placeHolder: string,
): Promise<TrailPick | undefined> {
	if (picks.length === 0) {
		await vscode.window.showInformationMessage(
			'Entirely found no trails to work on in this repository.',
		);
		return undefined;
	}

	const items = picks.map(pick => ({
		label: describePick(pick),
		description: describePickDetail(pick),
		pick,
	}));

	const chosen = await vscode.window.showQuickPick(items, { title, placeHolder });

	return chosen?.pick;
}

/**
 * The files the editor holds open with unsaved changes.
 *
 * The editor is the only thing that knows about a buffer that was
 * never written to disk, so it is the editor that is asked.
 */
function unsavedFiles(): { readonly path: string; readonly name?: string }[] {
	const files: { path: string; name?: string }[] = [];

	for (const document of vscode.workspace.textDocuments) {
		// An untitled buffer or a virtual document is not a file in the
		// working tree, so a checkout cannot lose it. A file outside the
		// workspace is not in the repository the checkout moves.
		if (!document.isDirty || document.isUntitled || document.uri.scheme !== 'file') {
			continue;
		}

		if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
			continue;
		}

		const name = vscode.workspace.asRelativePath(document.uri, false);

		files.push({ path: document.uri.fsPath, name });
	}

	return files;
}

/**
 * Approves a change.
 *
 * The approval is made by the CLI as the login the extension is acting
 * as, and it is read back afterwards: the extension says an approval
 * landed only once the CLI has said whose it is.
 */
export async function approveChange(
	deps: TrailReviewDependencies,
): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		changePicks(listed.trails),
		'Which change do you want to approve?',
		'Entirely approves as the login it is acting as',
	);

	if (!pick || pick.kind !== 'change') {
		return;
	}

	const result = await deps.trails.approve(pick.selector, undefined);

	if (result.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not approve ${describeChange(pick.change)}: ${result.detail}`,
		);
		return;
	}

	const attribution = attributeApproval(result.value, deps.actingHandle());

	switch (attribution.kind) {
		case 'attributed':
			await vscode.window.showInformationMessage(
				`Entirely approved ${describeChange(pick.change)} as ${attribution.approval.author}.`,
			);
			return;

		case 'other-reviewer':
			await vscode.window.showWarningMessage(
				`Entirely approved ${describeChange(pick.change)}, but the CLI recorded it under ${
					attribution.approval.author
				} rather than the login the extension is acting as.`,
			);
			return;

		case 'unapproved':
			await vscode.window.showWarningMessage(
				`Entirely asked the CLI to approve ${describeChange(pick.change)}, but the CLI did not record an approval.`,
			);
			return;
	}
}

/**
 * Comments on a change.
 *
 * The CLI refuses a comment from an agent session and points at its
 * finding command instead, so a refusal is followed by the finding
 * rather than by an error.
 */
export async function commentOnChange(
	deps: TrailReviewDependencies,
): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		changePicks(listed.trails),
		'Which change do you want to comment on?',
		'Entirely comments as the login it is acting as',
	);

	if (!pick || pick.kind !== 'change') {
		return;
	}

	const body = await vscode.window.showInputBox({
		title: 'Comment on the change',
		prompt: describeChange(pick.change),
		placeHolder: 'What do you want to say about this change?',
		ignoreFocusOut: true,
	});

	if (!body || body.trim().length === 0) {
		return;
	}

	const result = await deps.trails.comment(pick.selector, body.trim(), undefined);

	if (result.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not comment on ${describeChange(pick.change)}: ${result.detail}`,
		);
		return;
	}

	const note = result.value;

	if (note.kind === 'finding') {
		// The CLI refuses a comment from an agent session, so the note
		// was posted as a finding instead. The reviewer is told, because
		// a finding and a discussion are read differently.
		await vscode.window.showInformationMessage(
			`Entirely recorded a finding on ${describeChange(pick.change)}. The CLI refuses discussions from an agent session, so the note was posted as a finding instead.`,
		);
		return;
	}

	const comment = attributeComment(note.comments, deps.actingHandle());

	if (!comment) {
		await vscode.window.showWarningMessage(
			`Entirely asked the CLI to comment on ${describeChange(pick.change)}, but the CLI did not record the comment under the login the extension is acting as.`,
		);
		return;
	}

	await vscode.window.showInformationMessage(
		`Entirely commented on ${describeChange(pick.change)} as ${comment.lastMessageAuthor}.`,
	);
}

/**
 * Merges a change into its base.
 *
 * The CLI is asked what a merge would do before anything is merged,
 * and the answer is what the confirmation says: the branch, where it
 * would go and the commit at its head.
 */
export async function mergeChange(deps: TrailReviewDependencies): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		changePicks(listed.trails),
		'Which change do you want to merge?',
		'Each change of a trail is merged on its own',
	);

	if (!pick || pick.kind !== 'change') {
		return;
	}

	const plan = await deps.trails.mergePlan(pick.selector);

	if (plan.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not work out whether ${describeChange(pick.change)} could be merged: ${plan.detail}`,
		);
		return;
	}

	if (!plan.value.mergeable) {
		await vscode.window.showWarningMessage(describeMergeBlockers(plan.value));
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(
		`${describeMergePlan(plan.value)}. Merge it?`,
		{ modal: true },
		'Merge',
	);

	if (confirmed !== 'Merge') {
		return;
	}

	const merged = await deps.trails.merge(pick.selector);

	if (merged.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not merge ${describeChange(pick.change)}: ${merged.detail}`,
		);
		return;
	}

	await vscode.window.showInformationMessage(
		`Entirely merged ${describeChange(pick.change)}.`,
	);
}

/**
 * Checks out the branch of a change.
 *
 * A checkout moves the working tree, so the editor is asked first
 * whether it holds unsaved work. Work that was never written to disk
 * would be lost, and the extension refuses rather than losing it.
 */
export async function checkoutChange(deps: TrailReviewDependencies): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		changePicks(listed.trails),
		'Which change do you want to check out?',
		'Checking out moves the working tree to that branch',
	);

	if (!pick || pick.kind !== 'change') {
		return;
	}

	const refusal = refuseCheckoutForUnsavedWork(unsavedFiles());

	if (refusal) {
		await vscode.window.showErrorMessage(describeCheckoutRefusal(refusal));
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(
		`Check out ${describeChange(pick.change)}? This moves the working tree to that branch.`,
		{ modal: true },
		'Check Out',
	);

	if (confirmed !== 'Check Out') {
		return;
	}

	const result = await deps.trails.checkout(pick.selector, pick.change.branch);

	if (result.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not check out ${describeChange(pick.change)}: ${result.detail}`,
		);
		return;
	}

	await vscode.window.showInformationMessage(
		`Entirely checked out ${describeChange(pick.change)}.`,
	);
}

/**
 * Links the current branch to a trail.
 *
 * Linking is about the trail rather than about one of its changes: a
 * branch belongs to a trail, and the CLI takes the trail.
 */
export async function linkBranch(deps: TrailReviewDependencies): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		trailPicks(listed.trails),
		'Which trail do you want to link this branch to?',
		'Linking ties the current branch to the trail',
	);

	if (!pick || pick.kind !== 'trail') {
		return;
	}

	const branch = await vscode.window.showInputBox({
		title: 'Link a branch to the trail',
		prompt: `#${pick.trail.number} ${pick.trail.title}`,
		placeHolder: 'The branch to link',
		ignoreFocusOut: true,
	});

	if (!branch || branch.trim().length === 0) {
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(
		`Link ${branch.trim()} to trail #${pick.trail.number}?`,
		{ modal: true },
		'Link',
	);

	if (confirmed !== 'Link') {
		return;
	}

	const result = await deps.trails.link(pick.selector, branch.trim());

	if (result.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not link ${branch.trim()} to trail #${pick.trail.number}: ${result.detail}`,
		);
		return;
	}

	await vscode.window.showInformationMessage(
		`Entirely linked ${branch.trim()} to trail #${pick.trail.number}.`,
	);
}

/**
 * Removes a branch from a trail.
 *
 * The CLI keeps the branch and everything on it, but the trail stops
 * tracking the work, so the reviewer is asked first.
 */
export async function unlinkBranch(deps: TrailReviewDependencies): Promise<void> {
	const listed = await listTrails(deps);

	if (!listed) {
		return;
	}

	const pick = await choose(
		trailPicks(listed.trails),
		'Which trail do you want to unlink a branch from?',
		'The branch and its code are kept; the trail stops tracking it',
	);

	if (!pick || pick.kind !== 'trail') {
		return;
	}

	const branch = await vscode.window.showInputBox({
		title: 'Unlink a branch from the trail',
		prompt: `#${pick.trail.number} ${pick.trail.title ?? ''}`.trim(),
		placeHolder: 'The branch to unlink',
		ignoreFocusOut: true,
	});

	if (!branch || branch.trim().length === 0) {
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(
		`Unlink ${branch.trim()} from trail #${pick.trail.number}? The branch and its code are kept.`,
		{ modal: true },
		'Unlink',
	);

	if (confirmed !== 'Unlink') {
		return;
	}

	const result = await deps.trails.unlink(pick.selector, branch.trim());

	if (result.kind === 'failed') {
		await vscode.window.showErrorMessage(
			`Entirely could not unlink ${branch.trim()} from trail #${pick.trail.number}: ${result.detail}`,
		);
		return;
	}

	await vscode.window.showInformationMessage(
		`Entirely unlinked ${branch.trim()} from trail #${pick.trail.number}.`,
	);
}

/**
 * The selector the CLI takes for a trail.
 *
 * Exposed so that the wiring can be checked without a running editor.
 */
export function trailSelectorFor(trail: Trail): TrailSelector {
	return { kind: 'trail', number: trail.number };
}
