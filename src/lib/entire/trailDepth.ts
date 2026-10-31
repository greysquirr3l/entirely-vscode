import type { AccountContext } from './accountContext';
import { cliReason, isProjectInvisible } from './cliFailure';
import { describeActingLogin, type ControlConfirmation } from './controlPlaneActions';
import { isAttributedTo, refusesCommentFromAgentSession } from './trailReview';
import type { TrailEdit } from './trailDepthFlags';
import type { UnsavedFile } from './trailReview';

/**
 * The rules the trail depth actions follow: what needs a question first,
 * how a discussion is read, and how a failure or an outcome is worded.
 * Everything here is plain TypeScript, so it is tested without an editor
 * and without a network.
 */

/** The login an action is confirmed as and then run as. */
export type ActingLogin = Pick<AccountContext, 'name' | 'handle'>;

/** A question with a second way to say yes. */
export interface DepthConfirmation extends ControlConfirmation {
	/** A second button that agrees to something more, such as resolving after an apply. */
	readonly alternative?: string;
}

/** What a trail looked like before an update, for the question that precedes it. */
export interface TrailBefore {
	readonly status?: string;
	readonly assignees?: readonly string[];
}

/** One thing the trail depth flows do. The kinds that need no question are here so the table is one place. */
export type DepthAction =
	| { readonly kind: 'create-trail'; readonly title: string; readonly intentOnly: boolean; readonly repository: string; readonly branch?: string }
	| { readonly kind: 'update-trail'; readonly trail: string; readonly edit: TrailEdit; readonly before?: TrailBefore }
	| { readonly kind: 'delete-message'; readonly discussion: string; readonly change: string }
	| { readonly kind: 'dismiss-finding'; readonly finding: string; readonly severity?: string }
	| { readonly kind: 'apply-finding'; readonly finding: string; readonly folder: string }
	| {
			readonly kind:
				| 'start-discussion'
				| 'reply-discussion'
				| 'edit-message'
				| 'resolve-discussion'
				| 'reopen-discussion'
				| 'resolve-finding'
				| 'reopen-finding'
				| 'update-finding'
				| 'watch-change';
			readonly target: string;
	  };

/** Whether an edit closes the trail. */
export function closesTrail(edit: TrailEdit): boolean {
	return edit.status === 'closed';
}

/** Whether an edit replaces or clears the assignee list. Adding and removing one assignee does not. */
export function replacesAssignees(edit: TrailEdit): boolean {
	return edit.assignees !== undefined;
}

/**
 * Whether an action asks first.
 *
 * The rule is the review actions': ask where the change is hard to undo
 * or moves the working tree, and let the text the person just typed be
 * the consent everywhere else.
 */
export function requiresConfirmation(action: DepthAction): boolean {
	switch (action.kind) {
		case 'create-trail':
		case 'delete-message':
		case 'apply-finding':
			return true;
		case 'update-trail':
			return closesTrail(action.edit) || replacesAssignees(action.edit);
		case 'dismiss-finding':
			return action.severity?.trim().toLowerCase() === 'high';
		default:
			return false;
	}
}

function assigneeList(assignees: readonly string[] | undefined): string {
	return assignees === undefined ? 'not known' : assignees.length === 0 ? 'nobody' : assignees.join(', ');
}

/**
 * The question asked before an action, or nothing for an action that needs none.
 *
 * Every question names what it affects, the login it will act as, and
 * that the change is made on Entire.
 */
export function confirmTrailDepth(action: DepthAction, acting: ActingLogin): DepthConfirmation | undefined {
	if (!requiresConfirmation(action)) {
		return undefined;
	}
	const as = `Acting as ${describeActingLogin(acting)}.`;

	switch (action.kind) {
		case 'create-trail': {
			const publish = action.intentOnly
				? 'No branch is published: the trail records intent only.'
				: `The CLI publishes ${action.branch ? `your branch ${action.branch}` : 'your current branch'} to the remote first (on the base branch it derives a new branch from the title). It does not commit your changes or change your checkout.`;
			return {
				message: `Create the trail "${action.title}" on Entire?`,
				detail: `${as} This creates a trail in ${action.repository} on Entire, visible to everyone who can see the project. ${publish}`,
				action: 'Create Trail',
			};
		}
		case 'update-trail': {
			const lines: string[] = [as];
			if (closesTrail(action.edit)) {
				lines.push(`Its status changes from ${action.before?.status ?? 'its current value'} to closed on Entire, visible to everyone.`);
			}
			if (replacesAssignees(action.edit)) {
				const next = assigneeList(action.edit.assignees);
				lines.push(
					action.edit.assignees && action.edit.assignees.length === 0
						? `All assignees are cleared on Entire (it is ${assigneeList(action.before?.assignees)} now).`
						: `The assignee list on Entire is replaced as a whole: it is ${assigneeList(action.before?.assignees)} now and becomes ${next}.`,
				);
			}
			return {
				message: closesTrail(action.edit) ? `Close ${action.trail} on Entire?` : `Replace the assignees of ${action.trail} on Entire?`,
				detail: lines.join(' '),
				action: closesTrail(action.edit) ? 'Close Trail' : 'Replace Assignees',
			};
		}
		case 'delete-message':
			return {
				message: `Delete this message from the discussion '${action.discussion}' on ${action.change}?`,
				detail: `${as} The message is removed on Entire for everyone and cannot be recovered from the editor.`,
				action: 'Delete Message',
			};
		case 'dismiss-finding':
			return {
				message: `Dismiss the high-severity finding '${action.finding}'?`,
				detail: `${as} Dismissing hides it from the default list of findings on Entire for everyone. Reopening it brings it back. Dismissing a high-severity finding is a review decision.`,
				action: 'Dismiss Finding',
			};
		case 'apply-finding':
			return {
				message: `Apply the suggestion for '${action.finding}' to your working tree?`,
				detail: `${as} The CLI changes files in ${action.folder}; it does not commit, and nothing on Entire changes unless you choose Apply and Resolve. You can review the change in Source Control and revert it there.`,
				action: 'Apply',
				alternative: 'Apply and Resolve',
			};
		default:
			return undefined;
	}
}

/** How an action ended. */
export type DepthOutcome =
	| { readonly kind: 'done' }
	| { readonly kind: 'unconfirmed'; readonly detail: string }
	| { readonly kind: 'other-author'; readonly author: string }
	| { readonly kind: 'partly-done'; readonly advice: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** What an action was, in the two tenses a report needs. */
export interface DepthSubject {
	/** `replied to the discussion 'Fix'`. */
	readonly past: string;
	/** `reply to the discussion 'Fix'`. */
	readonly ask: string;
}

/** The sentence reported after an action. It names the login, and never quotes what the CLI printed. */
export function describeDepthOutcome(subject: DepthSubject, outcome: DepthOutcome, acting: ActingLogin): string {
	const login = describeActingLogin(acting);
	switch (outcome.kind) {
		case 'done':
			return `Entirely ${subject.past} as ${login}.`;
		case 'other-author':
			return `Entirely asked the CLI to ${subject.ask}, but the CLI recorded it under ${outcome.author} rather than the login Entirely acted as (${login}).`;
		case 'unconfirmed':
			return `Entirely asked the CLI to ${subject.ask} as ${login}, but a fresh read did not show it. ${outcome.detail}`;
		case 'partly-done':
			return `Entirely asked the CLI to ${subject.ask} as ${login}, and the CLI reported a failure, but part of it is there. ${outcome.advice}`;
		case 'failed':
			return `Entirely could not ${subject.ask} as ${login}: ${outcome.detail}`;
	}
}

/** Whether the CLI refused because it runs in an agent session. */
export function isAgentSessionRefusal(stderr: string): boolean {
	return (
		refusesCommentFromAgentSession(stderr) ||
		/refusing\s+`entire trail comment \w+`/i.test(stderr) ||
		(/agent session/i.test(stderr) && /refus/i.test(stderr))
	);
}

/** What the extension says for a refusal from an agent session. */
export const AGENT_SESSION_REFUSAL =
	'the CLI only lets people write in trail discussions, and this editor session is an agent session. Nothing was sent and nothing will be retried.';

/** Who and what a failure was about. */
export interface FailureContext {
	readonly project?: string;
	readonly login?: string;
}

/** What the extension says when a login cannot see the project that holds a trail. */
export function describeNoProjectAccess(context: FailureContext): string {
	const login = context.login ? `The login Entirely acted as (${context.login})` : 'The login Entirely acted as';
	const project = context.project ? `the project ${context.project}` : 'the project that holds this trail';
	return (
		`${login} has no access to ${project}. The CLI reports it as "project not found", and that is how the CLI and the forge behave ` +
		'for a GitHub collaborator on a repository whose trails live in someone else\'s personal project: the repository is visible, the project is not. ' +
		'Entirely cannot change that from the editor. Review the work in Entire\'s web UI, or move the repository to a GitHub organisation that both people belong to. ' +
		'If another saved login can see the project, set entirely.cliContext to it.'
	);
}

const SANDBOX = /keychain|keyring|network is not allowed/i;
const UNKNOWN_COMMAND = /unknown (?:sub)?command|unknown flag|unknown shorthand flag|no such (?:command|flag)/i;

/**
 * The one place a failure of a trail depth command is worded.
 *
 * In order: a project the login cannot see, a refusal from an agent
 * session, a CLI that does not know the command or flag, a keyring or
 * network the sandbox blocked (which is not being signed out, so no
 * sign-in is advised), and then the CLI's own reason.
 */
export function describeDepthFailure(detail: string, stderr: string, context: FailureContext = {}): string {
	if (isProjectInvisible(stderr)) {
		return describeNoProjectAccess(context);
	}
	if (isAgentSessionRefusal(stderr)) {
		return AGENT_SESSION_REFUSAL;
	}
	if (UNKNOWN_COMMAND.test(stderr)) {
		return 'this version of the Entire CLI does not know that command or flag; update the CLI';
	}
	if (SANDBOX.test(stderr)) {
		return 'the CLI could not reach the keyring or the network, which usually means the editor is sandboxed. That is not the same as being signed out, so signing in again will not help; allow the CLI to run unsandboxed.';
	}
	const reason = cliReason(stderr);
	return reason.length > 0 ? reason : detail;
}

/** The longest id the extension passes to the CLI. */
const MAX_ID_LENGTH = 128;

/**
 * Why an id from the CLI cannot be passed on, or nothing when it can.
 *
 * An id came out of the CLI's own JSON, and goes back to it as an operand.
 * One that starts with a dash would be read as a flag, and one with a
 * space or a control character is not an id.
 */
export function validateOperandId(id: string): string | undefined {
	if (id.length === 0) {
		return 'the id is empty';
	}
	if (id.length > MAX_ID_LENGTH) {
		return 'the id is too long';
	}
	if (id.startsWith('-')) {
		return 'the id starts with a dash, which the CLI would read as a flag';
	}
	if (/[\s\u0000-\u001f\u007f]/.test(id)) {
		return 'the id holds a space or a control character';
	}
	return undefined;
}

/** Whether an id can be passed to the CLI as an operand. */
export function isOperandId(id: string): boolean {
	return validateOperandId(id) === undefined;
}

/** One message of a discussion. The body is held in memory only, to prefill an edit. */
export interface DiscussionMessage {
	readonly id: string;
	readonly author?: string;
	readonly body?: string;
	readonly createdAt?: string;
}

/** A discussion as `comment show` answered. */
export interface DiscussionView {
	readonly title?: string;
	/** The messages, or `undefined` when the answer was in a form this version does not read. */
	readonly messages: readonly DiscussionMessage[] | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function authorOf(record: Record<string, unknown>): string | undefined {
	for (const key of ['author', 'authorHandle', 'authorLogin', 'user', 'createdBy']) {
		const value = record[key];
		const direct = text(value);
		if (direct !== undefined && direct.length > 0) {
			return direct;
		}
		if (isRecord(value)) {
			for (const inner of ['handle', 'login', 'username', 'name']) {
				const named = text(value[inner]);
				if (named !== undefined && named.length > 0) {
					return named;
				}
			}
		}
	}
	return undefined;
}

function messageOf(value: unknown): DiscussionMessage | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = text(value.id);
	if (id === undefined || id.length === 0) {
		return undefined;
	}
	let body: string | undefined;
	for (const key of ['body', 'text', 'content', 'message']) {
		body = text(value[key]);
		if (body !== undefined) {
			break;
		}
	}
	return { id, author: authorOf(value), body, createdAt: text(value.createdAt) };
}

/**
 * Reads a discussion tolerantly.
 *
 * The shape of `comment show --json` was not observed, so this looks for
 * a `messages` array (at the top, under `discussion`, or as `items`) of
 * objects with an id and an author, and treats anything else as messages
 * that are unavailable. It never throws and never keeps a field it does
 * not use.
 */
export function decodeDiscussion(value: unknown): DiscussionView {
	if (Array.isArray(value)) {
		return viewOf(undefined, value);
	}
	if (!isRecord(value)) {
		return { messages: undefined };
	}
	const inner = isRecord(value.discussion) ? value.discussion : undefined;
	const title = text(inner?.title) ?? text(value.title);
	const candidates = [value.messages, inner?.messages, value.items];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			return viewOf(title, candidate);
		}
	}
	return { title, messages: undefined };
}

function viewOf(title: string | undefined, rows: readonly unknown[]): DiscussionView {
	const messages = rows.flatMap(row => {
		const message = messageOf(row);
		return message ? [message] : [];
	});
	return { title, messages: rows.length > 0 && messages.length === 0 ? undefined : messages };
}

/** Whether a message was written by the acting handle. */
export function isOwnMessage(message: DiscussionMessage, actingHandle: string | undefined): boolean {
	return isAttributedTo(message.author, actingHandle);
}

/**
 * Whether a message is offered for editing.
 *
 * A message with no author in the listing is offered, because the CLI
 * is the one that decides who may edit it.
 */
export function mayEditMessage(message: DiscussionMessage, actingHandle: string | undefined): boolean {
	return message.author === undefined || isOwnMessage(message, actingHandle);
}

/**
 * Why an apply was refused for unsaved work, naming the files.
 *
 * The extension cannot read which files a patch touches, so any unsaved
 * file in the workspace blocks it, as it blocks a checkout.
 */
export function describeApplyRefusal(files: readonly UnsavedFile[]): string {
	const names = files.map(file => file.name ?? file.path);
	const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
	return `Entirely will not apply a suggestion while ${list} ${names.length === 1 ? 'has' : 'have'} unsaved changes. Save or revert ${names.length === 1 ? 'it' : 'them'} first.`;
}
