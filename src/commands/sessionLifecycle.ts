import * as fs from 'fs';

import {
	describeResume,
	describeUnsavedRefusal,
	isLive,
	isStoppable,
	nameSession,
	resumable,
	type ResumeResult,
	type Session,
	type SessionSource,
} from '../lib/entire';
import type { SessionLifecycleSource } from '../services/sessionLifecycle';
import { resumeSession, type ResumeLauncher } from '../services/sessionResume';

/** What a lifecycle command asks the person. */
export interface Confirmation {
	readonly message: string;
	readonly detail: string;
	/** The label of the button that goes ahead. */
	readonly action: string;
}

/** A session chosen by id, which the Sessions view may not list. */
export interface ChosenSession {
	readonly id: string;
	readonly session?: Session;
}

/** The questions and answers of a lifecycle command. */
export interface LifecycleUi {
	/** True only when the person chose to go ahead. */
	confirm(prompt: Confirmation): Promise<boolean>;
	chooseSession(title: string, sessions: readonly Session[]): Promise<Session | undefined>;
	/** Offers the sessions and a way to type an id the CLI knows but the tree does not list. */
	chooseSessionOrId(title: string, sessions: readonly Session[]): Promise<ChosenSession | undefined>;
	/** A commit, a ref, or `HEAD` when the person takes the default. */
	chooseCommit(): Promise<string | undefined>;
	/** Workspace files the editor holds with unsaved changes, as names the person knows. */
	unsavedFiles(): readonly string[];
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
}

/** What the lifecycle commands need. */
export interface LifecycleDependencies {
	readonly lifecycle: SessionLifecycleSource;
	readonly sessions: SessionSource;
	readonly ui: LifecycleUi;
	/** Re-reads the Sessions view. */
	readonly refresh: () => Promise<void>;
	readonly workspaceRoot: () => string | undefined;
	readonly launch: ResumeLauncher;
	/** How long, in milliseconds, to watch for a resumed session. */
	readonly resumeWatchMs: () => number;
	readonly pollMs?: number;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	/** Branches whose resume is being watched now. Shared so a second Resume is noticed. */
	readonly watching?: Set<string>;
	/** Stops resume watches, e.g. on deactivate. */
	readonly signal?: AbortSignal;
}

/** How a command ended, for the caller that wants to know. */
/** `unconfirmed` is a resume that ran but whose session was not seen to come back. */
export type LifecycleResult = 'cancelled' | 'done' | 'failed' | 'unconfirmed';

/** Branches being watched when the caller gives no set of its own. */
const sharedWatching = new Set<string>();

async function listed(deps: LifecycleDependencies): Promise<readonly Session[]> {
	return (await deps.sessions()).sessions;
}

/**
 * Stops a session, after the person has confirmed which one.
 *
 * Stopping ends live capture and writes no checkpoint, so the prompt names
 * the session and nothing runs until the person says yes.
 */
export async function stopSession(deps: LifecycleDependencies, target?: Session): Promise<LifecycleResult> {
	const session = target ?? (await deps.ui.chooseSession('Stop which session?', (await listed(deps)).filter(isStoppable)));
	if (!session) {
		return 'cancelled';
	}
	if (!isStoppable(session)) {
		await deps.ui.inform(`${nameSession(session)} has already ended.`);
		return 'cancelled';
	}

	const confirmed = await deps.ui.confirm({
		message: `Stop session ${nameSession(session)}?`,
		detail:
			'Entire stops capturing this session. No checkpoint is written, so commit first if work is pending. ' +
			'An agent still running keeps running, untracked.',
		action: 'Stop Session',
	});
	if (!confirmed) {
		return 'cancelled';
	}

	const outcome = await deps.lifecycle.stop(session.id);
	await deps.refresh();
	if (outcome.kind === 'done') {
		await deps.ui.inform(`Stopped ${nameSession(session)}.`);
		return 'done';
	}
	await deps.ui.warn(`Could not stop ${nameSession(session)}: ${failureText(outcome)}.`);
	return 'failed';
}

/**
 * Attaches a session to a commit.
 *
 * The CLI describes what linking would change, including whether it would
 * rewrite unpushed commits. That description is what the person agrees to,
 * and only then is the command run for real.
 */
export async function attachSession(deps: LifecycleDependencies, target?: Session): Promise<LifecycleResult> {
	const chosen: ChosenSession | undefined = target
		? { id: target.id, session: target }
		: await deps.ui.chooseSessionOrId('Attach which session?', await listed(deps));
	if (!chosen) {
		return 'cancelled';
	}
	const name = chosen.session ? nameSession(chosen.session) : chosen.id;

	const commit = await deps.ui.chooseCommit();
	if (commit === undefined) {
		return 'cancelled';
	}

	const preview = await deps.lifecycle.previewAttach(chosen.id, commit);
	if (preview.kind === 'failed') {
		await deps.ui.warn(`Could not attach ${name} to ${commit}: ${preview.detail}.`);
		return 'failed';
	}
	if (preview.kind === 'done') {
		await deps.refresh();
		await deps.ui.inform(`Attached ${name} to ${commit}. ${preview.summary}`.trim());
		return 'done';
	}

	const confirmed = await deps.ui.confirm({
		message: `Attach session ${name} to ${commit}?`,
		detail: preview.preview,
		action: 'Attach Session',
	});
	if (!confirmed) {
		return 'cancelled';
	}

	const outcome = await deps.lifecycle.attach(chosen.id, commit);
	await deps.refresh();
	if (outcome.kind === 'done') {
		await deps.ui.inform(`Attached ${name} to ${commit}. ${outcome.summary}`.trim());
		return 'done';
	}
	await deps.ui.warn(`Could not attach ${name} to ${commit}: ${failureText(outcome)}.`);
	return 'failed';
}

function sameFolder(left: string, right: string | undefined): boolean {
	if (right === undefined) {
		return false;
	}
	const real = (folder: string): string => {
		try {
			return fs.realpathSync(folder);
		} catch {
			return folder;
		}
	};
	return real(left) === real(right);
}

/**
 * Adopts a session that is running in another worktree.
 *
 * The session tree is refreshed afterwards, and the report says whether
 * the session is listed for this workspace now, not just that the CLI
 * exited cleanly.
 */
export async function adoptSession(deps: LifecycleDependencies, target?: Session): Promise<LifecycleResult> {
	const elsewhere = (session: Session): boolean => isLive(session) && !sameFolder(session.worktreePath, deps.workspaceRoot());
	const session = target ?? (await deps.ui.chooseSession('Adopt which session?', (await listed(deps)).filter(elsewhere)));
	if (!session) {
		return 'cancelled';
	}
	if (!elsewhere(session)) {
		await deps.ui.inform(`${nameSession(session)} is not an active session in another worktree, so there is nothing to adopt.`);
		return 'cancelled';
	}

	const confirmed = await deps.ui.confirm({
		message: `Adopt session ${nameSession(session)}?`,
		detail:
			`Entire moves the live session from ${session.worktreePath} into this workspace and ` +
			'seeds it with the uncommitted changes here, so the next commit links to it.',
		action: 'Adopt Session',
	});
	if (!confirmed) {
		return 'cancelled';
	}

	const outcome = await deps.lifecycle.adopt(session.id, session.worktreePath);
	await deps.refresh();
	if (outcome.kind !== 'done') {
		await deps.ui.warn(`Could not adopt ${nameSession(session)}: ${failureText(outcome)}.`);
		return 'failed';
	}

	const now = (await listed(deps)).find(candidate => candidate.id === session.id);
	if (now && sameFolder(now.worktreePath, deps.workspaceRoot())) {
		await deps.ui.inform(`Adopted ${nameSession(now)}. It is in the Sessions view now.`);
	} else {
		await deps.ui.inform(
			`The CLI adopted ${session.id}, but the Sessions view does not list it for this workspace yet. Refresh to check.`,
		);
	}
	return 'done';
}

/**
 * Resumes a stopped session's branch in a terminal, and reports what was seen.
 *
 * See `resumeSession` for how the outcome is worked out.
 */
export async function resumeStoppedSession(deps: LifecycleDependencies, target?: Session): Promise<LifecycleResult> {
	const session = target ?? (await deps.ui.chooseSession('Resume which session?', resumable(await listed(deps))));
	if (!session) {
		return 'cancelled';
	}
	if (session.branch === undefined) {
		await deps.ui.warn(`${nameSession(session)} is not on a branch, so there is no branch to resume.`);
		return 'failed';
	}

	const watching = deps.watching ?? sharedWatching;
	if (watching.has(session.branch)) {
		await deps.ui.inform(`A resume of ${session.branch} is already being watched. Check its terminal.`);
		return 'cancelled';
	}

	const unsaved = deps.ui.unsavedFiles();
	if (unsaved.length > 0) {
		await deps.ui.warn(describeUnsavedRefusal(session.branch, unsaved));
		return 'cancelled';
	}

	const confirmed = await deps.ui.confirm({
		message: `Resume ${session.branch}?`,
		detail:
			`This checks out the branch ${session.branch} in this workspace and restores the session's log. ` +
			'It opens a terminal where Entire may ask you questions.',
		action: 'Resume',
	});
	if (!confirmed) {
		return 'cancelled';
	}
	// Taken after the awaits above, so two quick clicks cannot both pass the check.
	if (watching.has(session.branch)) {
		await deps.ui.inform(`A resume of ${session.branch} is already being watched. Check its terminal.`);
		return 'cancelled';
	}

	watching.add(session.branch);
	let result: ResumeResult;
	try {
		result = await resumeSession(
			{
				lifecycle: deps.lifecycle,
				sessions: deps.sessions,
				launch: deps.launch,
				watchMs: deps.resumeWatchMs,
				pollMs: deps.pollMs,
				sleep: deps.sleep,
				signal: deps.signal,
			},
			session.branch,
		);
	} finally {
		watching.delete(session.branch);
	}
	await deps.refresh();

	const message = describeResume(session.branch, result);
	if (result.kind === 'failed') {
		await deps.ui.warn(message);
		return 'failed';
	}
	await deps.ui.inform(message);
	return result.kind === 'active' ? 'done' : result.kind === 'already-active' ? 'cancelled' : 'unconfirmed';
}

function failureText(outcome: { readonly kind: string; readonly detail?: string }): string {
	return outcome.detail ?? 'the CLI did not say why';
}
