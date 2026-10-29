import type { Session } from './types';
import { nameSession } from './sessionLifecycle';

/**
 * What is known after a resume was started in a terminal.
 *
 * Resume asks questions (whether to start the agent, whether to reset to an
 * older checkpoint), so it runs where the user can answer them, and the
 * extension cannot see the answers. All it can observe is the session list
 * and how the terminal's process ended. The result says only what was seen.
 */
export type ResumeResult =
	/** Nothing was started, for this reason. */
	| { readonly kind: 'failed'; readonly detail: string }
	/** The branch already had an active session, so nothing was started. */
	| { readonly kind: 'already-active'; readonly session: Session }
	/** An active session appeared on the branch. */
	| { readonly kind: 'active'; readonly session: Session }
	/** The terminal ran, and no active session was seen on the branch. */
	| {
			readonly kind: 'not-seen';
			/** The terminal process's exit code, when it had ended and said. */
			readonly exitCode?: number;
			/** Whether the terminal's process had ended when the watch stopped. */
			readonly ended: boolean;
			/** Why the session list could not be read, when it could not. */
			readonly unreadable?: string;
	  };

/** The message that tells the user what happened. */
export function describeResume(branch: string, result: ResumeResult): string {
	switch (result.kind) {
		case 'failed':
			return `Could not resume ${branch}: ${result.detail}.`;
		case 'already-active':
			return `${nameSession(result.session)} is already active, so nothing was resumed.`;
		case 'active':
			return `Resumed: ${nameSession(result.session)} is active again.`;
		case 'not-seen': {
			const lead = result.ended
				? result.exitCode !== undefined && result.exitCode !== 0
					? `The resume for ${branch} ended with exit code ${result.exitCode}.`
					: `The resume for ${branch} ended.`
				: `The resume for ${branch} is still running in its terminal.`;
			const seen = result.unreadable
				? ` The sessions could not be read to check (${result.unreadable}).`
				: ' No active session appeared on that branch.';
			return `${lead}${seen} If you chose not to start the agent, the terminal shows the command to continue.`;
		}
	}
}
