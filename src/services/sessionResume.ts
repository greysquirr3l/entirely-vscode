import { activeOnBranch, type ResumeResult, type SessionSource } from '../lib/entire';
import type { ResumeLaunch, SessionLifecycleSource } from './sessionLifecycle';

/** A resume running somewhere the user can answer its questions. */
export interface ResumeProcess {
	/** Whether the process has ended, and the exit code when it said one. */
	status(): { readonly ended: boolean; readonly exitCode?: number };
}

/** Starts the resume where the user can see it. */
export type ResumeLauncher = (launch: Extract<ResumeLaunch, { ok: true }>) => ResumeProcess;

/** What resuming needs. */
export interface ResumeDependencies {
	readonly lifecycle: SessionLifecycleSource;
	readonly sessions: SessionSource;
	readonly launch: ResumeLauncher;
	/** How long, in milliseconds, to watch for the session to come back. */
	readonly watchMs: () => number;
	/** How often, in milliseconds, the session list is read while watching. */
	readonly pollMs?: number;
	/** Waits. Replaceable so a test need not. */
	readonly sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_POLL_MS = 2000;

function wait(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Resumes the session on a branch, and reports what could be seen.
 *
 * The CLI's resume is interactive: it switches branch, restores the log and
 * asks whether to start the agent. So it runs in a terminal, and "the
 * command was sent" is not reported as "the work continues". The outcome is
 * read from the session list: after the terminal starts, the list is read
 * every few seconds, for a bounded time, until a session on the branch is
 * active. This reads only; it never starts or stops anything, and it only
 * happens after the user asked to resume.
 */
export async function resumeSession(deps: ResumeDependencies, branch: string): Promise<ResumeResult> {
	const launch = await deps.lifecycle.prepareResume(branch);
	if (!launch.ok) {
		return { kind: 'failed', detail: launch.detail };
	}

	const before = await deps.sessions();
	const running = activeOnBranch(before.sessions, branch)[0];
	if (running) {
		return { kind: 'already-active', session: running };
	}

	const process = deps.launch(launch);
	const sleep = deps.sleep ?? wait;
	const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
	const deadline = Date.now() + deps.watchMs();
	let unreadable: string | undefined;

	for (;;) {
		const listing = await deps.sessions();
		const found = activeOnBranch(listing.sessions, branch)[0];
		if (found) {
			return { kind: 'active', session: found };
		}
		unreadable = listing.sessions.length === 0 ? listing.emptyReason : undefined;

		const { ended, exitCode } = process.status();
		if (ended || Date.now() >= deadline) {
			return { kind: 'not-seen', ended, exitCode, unreadable };
		}
		await sleep(pollMs);
	}
}
