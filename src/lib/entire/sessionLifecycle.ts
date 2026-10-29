import { END_OF_OPTIONS } from './operand';
import { readFlagTable, type HelpFlag } from './search';
import type { Session } from './types';

/** The four things the extension can do to a session's life. */
export type LifecycleAction = 'stop' | 'attach' | 'adopt' | 'resume';

/** The flags a lifecycle command needs, or why they could not be found. */
export type LifecyclePlan<T> =
	| ({ readonly ok: true } & T)
	| { readonly ok: false; readonly detail: string };

function flagsOf(help: string, fallback: readonly HelpFlag[]): readonly HelpFlag[] {
	const table = readFlagTable(help);
	return table.length > 0 ? table : fallback;
}

function findFlag(
	flags: readonly HelpFlag[],
	pattern: RegExp,
	exclude: readonly HelpFlag[] = [],
): HelpFlag | undefined {
	return flags.find(flag => !exclude.includes(flag) && pattern.test(flag.description));
}

function unreadable(action: LifecycleAction, what: string): { readonly ok: false; readonly detail: string } {
	return {
		ok: false,
		detail: `this version of the Entire CLI does not describe a ${what} for 'session ${action}'; update the CLI`,
	};
}

/** What stopping a session needs from the help. */
export interface StopFlags {
	/** The flag that skips the CLI's own prompt, which needs a terminal. */
	readonly skipPrompt: string;
}

/**
 * Finds the flag that skips the CLI's prompt, by what its help line says.
 *
 * The extension asks the user itself, naming the session, so the CLI's own
 * prompt (which needs a terminal and fails without one) is skipped.
 */
export function planStopFlags(help: string, fallback: readonly HelpFlag[] = []): LifecyclePlan<StopFlags> {
	const skip = findFlag(flagsOf(help, fallback), /\bskip\b.*\bconfirm/i);
	return skip ? { ok: true, skipPrompt: skip.name } : unreadable('stop', 'flag that skips the confirmation');
}

/** What attaching a session needs from the help. */
export interface AttachFlags {
	/** Names the commit to link to. */
	readonly commit: string;
	/** Lets the command change something, after the user has agreed. */
	readonly proceed: string;
}

/** Finds the commit flag and the flag that agrees to what attach described. */
export function planAttachFlags(help: string, fallback: readonly HelpFlag[] = []): LifecyclePlan<AttachFlags> {
	const flags = flagsOf(help, fallback);
	const proceed = findFlag(flags, /\bskip\b.*\bconfirm/i);
	if (!proceed) {
		return unreadable('attach', 'flag that agrees to the change');
	}
	const commit = findFlag(flags, /\bcommit\b/i, [proceed]);
	if (!commit) {
		return unreadable('attach', 'flag that names a commit');
	}
	return { ok: true, commit: commit.name, proceed: proceed.name };
}

/** What adopting a session needs from the help. */
export interface AdoptFlags {
	/** Names the worktree that tracks the session now. */
	readonly from: string;
	/** Confirms the adoption without a prompt. */
	readonly confirm: string;
}

/** Finds the source-worktree flag and the flag that confirms without prompting. */
export function planAdoptFlags(help: string, fallback: readonly HelpFlag[] = []): LifecyclePlan<AdoptFlags> {
	const flags = flagsOf(help, fallback);
	const from = findFlag(flags, /\bworktree\b/i);
	if (!from) {
		return unreadable('adopt', 'flag that names the source worktree');
	}
	const confirm = findFlag(flags, /\bconfirm\b.*\bwithout prompting\b/i, [from]);
	if (!confirm) {
		return unreadable('adopt', 'flag that confirms without prompting');
	}
	return { ok: true, from: from.name, confirm: confirm.name };
}

/** Resume takes no flag of the extension's: the branch is its operand. */
export interface ResumeFlags {
	/** What resume is given: the branch, as an operand. */
	readonly operand: 'branch';
}

/**
 * Checks the help describes a command that resumes by branch.
 *
 * Nothing is passed beyond the branch, so the CLI's own prompts (whether to
 * start the agent, whether to reset to an older checkpoint) reach the user in
 * the terminal where they can answer them.
 */
export function planResumeFlags(help: string): LifecyclePlan<ResumeFlags> {
	return /\bbranch\b/i.test(help) ? { ok: true, operand: 'branch' } : unreadable('resume', 'branch to resume');
}

const COMMIT_REF = /^[A-Za-z0-9_][A-Za-z0-9._\/~^@{}+-]{0,199}$/;

/** Whether a string can safely be handed to the CLI as a commit or ref. */
export function isCommitRef(value: string): boolean {
	return COMMIT_REF.test(value) && !value.includes('..');
}

const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._\/+@#-]{0,199}$/;

/** Whether a string can safely be handed to the CLI as a branch name. */
export function isBranchName(value: string): boolean {
	return BRANCH_NAME.test(value) && !value.includes('..') && !value.endsWith('/') && !value.endsWith('.lock');
}

/** Whether a string is an absolute path that cannot be read as a flag. */
export function isWorktreePath(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 4096 &&
		(value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) &&
		!/[\u0000-\u001f]/.test(value)
	);
}

/** `entire session stop <id>`, past the CLI's prompt. */
export function stopArguments(flags: StopFlags, sessionId: string): readonly string[] {
	return ['session', 'stop', flags.skipPrompt, END_OF_OPTIONS, sessionId];
}

/**
 * `entire session attach`, as a preview or as the change itself.
 *
 * The commit goes in the flag's `=value` form because a value cannot follow
 * the end-of-options separator; the session id does.
 */
export function attachArguments(
	flags: AttachFlags,
	sessionId: string,
	commit: string,
	proceed: boolean,
): readonly string[] {
	const args = ['session', 'attach', `${flags.commit}=${commit}`];
	if (proceed) {
		args.push(flags.proceed);
	}
	args.push(END_OF_OPTIONS, sessionId);
	return args;
}

/** `entire session adopt <id> --from <worktree>`, past the CLI's prompt. */
export function adoptArguments(flags: AdoptFlags, sessionId: string, fromWorktree: string): readonly string[] {
	return ['session', 'adopt', `${flags.from}=${fromWorktree}`, flags.confirm, END_OF_OPTIONS, sessionId];
}

/** `entire session resume <branch>`. */
export function resumeArguments(branch: string): readonly string[] {
	return ['session', 'resume', END_OF_OPTIONS, branch];
}

/** How a lifecycle command ended. */
export type LifecycleOutcome =
	/** The CLI did it, and said this. */
	| { readonly kind: 'done'; readonly summary: string }
	/** The CLI described a change and wants the user's agreement before it makes it. */
	| { readonly kind: 'needs-agreement'; readonly preview: string }
	/** Nothing was done, for this reason. */
	| { readonly kind: 'failed'; readonly detail: string };

const MAX_CLI_TEXT = 1200;

/**
 * Makes what the CLI printed fit in a message.
 *
 * Control characters other than line breaks are dropped (a terminal colour
 * code is not text), and the length is capped.
 */
export function cleanCliText(text: string, maxLength: number = MAX_CLI_TEXT): string {
	const cleaned = text
		.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
		.split('\n')
		.map(line => line.trimEnd())
		.join('\n')
		.trim();
	return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** The words a failure is reported in: what the CLI said, or the run's own account. */
export function failureDetail(stderr: string, stdout: string, fallback: string): string {
	const said = cleanCliText(stderr.trim().length > 0 ? stderr : stdout, 400);
	return said.length > 0 ? said : fallback;
}

/**
 * Whether a refused attach is the CLI asking for agreement.
 *
 * Attach without a terminal changes nothing and exits non-zero, printing
 * what it would do and naming the flag to rerun with. A refusal that never
 * mentions that flag is a failure, not a question.
 */
export function asksForAgreement(output: string, proceedFlag: string): boolean {
	return output.includes(proceedFlag);
}

/** Names a session so a person can tell which one is meant. */
export function nameSession(session: Pick<Session, 'id' | 'agent' | 'branch'>): string {
	const place = session.branch ? ` on ${session.branch}` : '';
	return `${session.id} (${session.agent}${place})`;
}

/** Whether a session is running, as the tree already counts it. */
export function isLive(session: Pick<Session, 'status'>): boolean {
	return session.status === 'active';
}

/**
 * Whether a session still has something to stop.
 *
 * A session whose agent has gone away is stale rather than ended, and
 * stopping it is the way out, so only an ended session is left out.
 */
export function isStoppable(session: Pick<Session, 'status'>): boolean {
	return session.status !== 'ended';
}

/** The sessions that are active on a branch. */
export function activeOnBranch(sessions: readonly Session[], branch: string): readonly Session[] {
	return sessions.filter(session => session.branch === branch && isLive(session));
}

/** The sessions that could be resumed: stopped, and on a branch. */
export function resumable(sessions: readonly Session[]): readonly Session[] {
	return sessions.filter(session => !isLive(session) && session.branch !== undefined && isBranchName(session.branch));
}
