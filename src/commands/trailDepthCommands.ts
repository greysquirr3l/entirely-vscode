import * as vscode from 'vscode';

import {
	applyFinding,
	createTrail,
	deleteMessage,
	editMessage,
	replyToDiscussion,
	setDiscussionResolved,
	setFindingStatus,
	showDiscussion,
	showFinding,
	startDiscussion,
	stopAllWatches,
	stopWatching,
	updateFinding,
	updateTrail,
	watchChange,
	type TrailDepthDependencies,
} from './trailDepth';

/** What registering the commands needs besides the flows' own dependencies. */
export interface TrailDepthCommandDependencies extends TrailDepthDependencies {
	/** Reads a group of a change's rows again, after a read failed. */
	readonly retryThreads: (target: unknown) => void;
}

/**
 * Registers the trail depth commands.
 *
 * Every command is reached by the person choosing it, from a row's inline
 * actions, a view's title or the palette; none is run for them. The watch
 * service is disposed with the extension, which ends every watch process.
 * Each command accepts the tree row it was run from, so a row needs no
 * picker, and falls back to pickers when run from the palette.
 */
export function registerTrailDepthCommands(context: vscode.ExtensionContext, deps: TrailDepthCommandDependencies): void {
	context.subscriptions.push(
		deps.watch,
		vscode.commands.registerCommand('entirely.trailCreate', async () => {
			await createTrail(deps);
		}),
		vscode.commands.registerCommand('entirely.trailUpdate', async (target?: unknown) => {
			await updateTrail(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailWatch', async (target?: unknown) => {
			await watchChange(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailStopWatching', async (target?: unknown) => {
			await stopWatching(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailStopAllWatches', () => {
			stopAllWatches(deps);
		}),
		vscode.commands.registerCommand('entirely.trailStartDiscussion', async (target?: unknown) => {
			await startDiscussion(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailReplyToDiscussion', async (target?: unknown) => {
			await replyToDiscussion(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailEditMessage', async (target?: unknown) => {
			await editMessage(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailDeleteMessage', async (target?: unknown) => {
			await deleteMessage(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailResolveDiscussion', async (target?: unknown) => {
			await setDiscussionResolved(deps, true, target);
		}),
		vscode.commands.registerCommand('entirely.trailReopenDiscussion', async (target?: unknown) => {
			await setDiscussionResolved(deps, false, target);
		}),
		vscode.commands.registerCommand('entirely.trailShowDiscussion', async (target?: unknown) => {
			await showDiscussion(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailResolveFinding', async (target?: unknown) => {
			await setFindingStatus(deps, 'resolve', target);
		}),
		vscode.commands.registerCommand('entirely.trailDismissFinding', async (target?: unknown) => {
			await setFindingStatus(deps, 'dismiss', target);
		}),
		vscode.commands.registerCommand('entirely.trailReopenFinding', async (target?: unknown) => {
			await setFindingStatus(deps, 'reopen', target);
		}),
		vscode.commands.registerCommand('entirely.trailUpdateFinding', async (target?: unknown) => {
			await updateFinding(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailApplyFinding', async (target?: unknown) => {
			await applyFinding(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailShowFinding', async (target?: unknown) => {
			await showFinding(deps, target);
		}),
		vscode.commands.registerCommand('entirely.trailRetryThreads', (target?: unknown) => {
			deps.retryThreads(target);
		}),
	);
}
