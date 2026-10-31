import {
	TRAIL_DEPTH_COMMANDS,
	discussionArguments,
	isAttributedTo,
	planDiscussionWrite,
	planJsonRead,
	typedFlags,
	validateOperandId,
	type ActingLogin,
	type DepthOutcome,
	type DiscussionInput,
	type DiscussionView,
	type TrailComment,
	type TrailSelector,
} from '../lib/entire';
import { renderCommandLine } from './cli';
import { TrailDepthReader } from './trailDepthReads';
import { depthFailure, failureText, readCommandHelp, type DepthDependencies } from './trailDepthSupport';
import type { TrailResult } from './trailService';

/** The writes to a discussion. */
export type DiscussionWrite = Exclude<DiscussionInput, { readonly kind: 'show' }>;

const COMMANDS: Readonly<Record<DiscussionWrite['kind'], string>> = {
	add: TRAIL_DEPTH_COMMANDS.commentAdd,
	reply: TRAIL_DEPTH_COMMANDS.commentReply,
	edit: TRAIL_DEPTH_COMMANDS.commentEdit,
	delete: TRAIL_DEPTH_COMMANDS.commentDelete,
	resolve: TRAIL_DEPTH_COMMANDS.commentResolve,
	unresolve: TRAIL_DEPTH_COMMANDS.commentUnresolve,
};

/** What a discussion was before a write, for the comparison after it. */
interface Before {
	readonly known: ReadonlySet<string>;
	readonly rows: ReadonlyMap<string, TrailComment>;
}

function sameText(left: string | undefined, right: string): boolean {
	return (left ?? '').trim() === right.trim();
}

/**
 * Starts, replies to, edits, deletes, resolves and reopens discussions.
 *
 * Every write runs once as the confirmed login and is never retried. The
 * typed text is its own argument, left out of the reported command line,
 * and nothing the CLI prints is kept. A write is reported only after a
 * fresh read shows it, and one recorded under another handle is reported
 * as that handle's. A refusal from an agent session is reported as such:
 * there is no finding to fall back to for a reply, an edit, a delete or a
 * resolve, and none is posted for a start from here.
 *
 * Verified against a fake CLI only. The shape of `comment show` and the
 * wording of the refusal for these verbs are unobserved on the real CLI.
 */
export class TrailDiscussionService {
	private readonly reader: TrailDepthReader;

	constructor(private readonly deps: DepthDependencies) {
		this.reader = new TrailDepthReader(deps);
	}

	/** The discussions of a change. */
	list(selector: TrailSelector, context?: string): Promise<TrailResult<readonly TrailComment[]>> {
		return this.reader.discussions(selector, context);
	}

	/** One discussion and its messages, in memory only. */
	show(selector: TrailSelector, id: string, context?: string): Promise<TrailResult<DiscussionView>> {
		return this.reader.discussion(selector, id, context);
	}

	/**
	 * The command line that shows a discussion in a terminal, for the person to copy.
	 *
	 * Offered when the answer to `comment show` is not one Entirely reads.
	 * The flags come from the CLI's help, as everywhere else.
	 */
	async commandLine(selector: TrailSelector, id: string): Promise<string | undefined> {
		if (validateOperandId(id)) {
			return undefined;
		}
		const command = TRAIL_DEPTH_COMMANDS.commentShow;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return undefined;
		}
		const picked = planJsonRead(command, help.raw);
		if (!picked.ok) {
			return undefined;
		}
		const args = await this.deps.trails.selectorArgs(command, selector, discussionArguments(picked.flags, { kind: 'show', id }));
		return renderCommandLine('entire', args);
	}

	/** Runs one write and checks it against a fresh read. */
	async write(selector: TrailSelector, input: DiscussionWrite, acting: ActingLogin): Promise<DepthOutcome> {
		if (input.kind !== 'add') {
			const problem = validateOperandId(input.id);
			if (problem) {
				return { kind: 'failed', detail: `${problem}.` };
			}
		}
		if (input.kind === 'edit' || input.kind === 'delete') {
			const problem = validateOperandId(input.messageId);
			if (problem) {
				return { kind: 'failed', detail: `${problem}.` };
			}
		}

		const command = COMMANDS[input.kind];
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planDiscussionWrite(command, help.raw, {
			body: input.kind === 'add' || input.kind === 'reply' || input.kind === 'edit',
			force: input.kind === 'delete',
		});
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}

		const before = await this.snapshot(selector, acting);
		if (before.kind === 'failed') {
			return { kind: 'failed', detail: await depthFailure(this.deps, before.detail, before.detail, acting) };
		}

		const args = await this.deps.trails.selectorArgs(command, selector, discussionArguments(picked.flags, input));
		const result = await this.deps.runner.run(args, this.deps.trails.actionOptions(typedFlags(picked.flags, ['body', 'title']), acting.name));
		if (!result.ok) {
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}
		return this.verify(selector, input, before.value, acting);
	}

	private async snapshot(selector: TrailSelector, acting: ActingLogin): Promise<TrailResult<Before>> {
		const rows = await this.reader.discussions(selector, acting.name);
		if (rows.kind === 'failed') {
			return rows;
		}
		return {
			kind: 'ok',
			value: { known: new Set(rows.value.map(row => row.id)), rows: new Map(rows.value.map(row => [row.id, row] as const)) },
		};
	}

	private async verify(selector: TrailSelector, input: DiscussionWrite, before: Before, acting: ActingLogin): Promise<DepthOutcome> {
		const rows = await this.reader.discussions(selector, acting.name);
		if (rows.kind === 'failed') {
			return { kind: 'unconfirmed', detail: 'The discussions could not be read again.' };
		}
		const list = rows.value;
		const row = input.kind === 'add' ? undefined : list.find(item => item.id === input.id);

		switch (input.kind) {
			case 'add': {
				const added = list.filter(item => !before.known.has(item.id));
				if (added.length === 0) {
					return { kind: 'unconfirmed', detail: 'No new discussion appears in the list. Check the web UI.' };
				}
				const own = added.find(item => isAttributedTo(item.lastMessageAuthor, acting.handle));
				if (own) {
					return { kind: 'done' };
				}
				const author = added[added.length - 1].lastMessageAuthor;
				return author ? { kind: 'other-author', author } : { kind: 'unconfirmed', detail: 'The new discussion names no author, so it cannot be attributed to you.' };
			}
			case 'reply': {
				if (!row) {
					return { kind: 'unconfirmed', detail: 'The discussion is no longer in the list.' };
				}
				return verifyReply(before.rows.get(input.id), row, acting);
			}
			case 'edit': {
				const view = await this.reader.discussion(selector, input.id, acting.name);
				const message = view.kind === 'ok' ? view.value.messages?.find(item => item.id === input.messageId) : undefined;
				if (view.kind === 'failed' || view.value.messages === undefined) {
					return { kind: 'unconfirmed', detail: 'The discussion could not be read in a form Entirely understands, so the new text could not be checked.' };
				}
				if (!message) {
					return { kind: 'unconfirmed', detail: 'The message is no longer in the discussion.' };
				}
				if (!sameText(message.body, input.body)) {
					return { kind: 'unconfirmed', detail: 'The message does not show the new text.' };
				}
				return message.author !== undefined && !isAttributedTo(message.author, acting.handle)
					? { kind: 'other-author', author: message.author }
					: { kind: 'done' };
			}
			case 'delete': {
				if (!row) {
					// The discussion went with its last message.
					return { kind: 'done' };
				}
				const view = await this.reader.discussion(selector, input.id, acting.name);
				if (view.kind === 'failed' || view.value.messages === undefined) {
					return { kind: 'unconfirmed', detail: 'The discussion could not be read again, so the deletion could not be checked.' };
				}
				return view.value.messages.some(item => item.id === input.messageId)
					? { kind: 'unconfirmed', detail: 'The message is still in the discussion.' }
					: { kind: 'done' };
			}
			case 'resolve':
			case 'unresolve': {
				if (!row) {
					return { kind: 'unconfirmed', detail: 'The discussion is no longer in the list.' };
				}
				return row.resolved === (input.kind === 'resolve')
					? { kind: 'done' }
					: { kind: 'unconfirmed', detail: `The discussion still shows as ${row.resolved ? 'resolved' : 'open'}.` };
			}
		}
	}
}

/** A reply is done when the count grew by one and the last message is the acting handle's. */
function verifyReply(previous: TrailComment | undefined, row: TrailComment, acting: ActingLogin): DepthOutcome {
	if (previous?.messageCount === undefined || row.messageCount === undefined) {
		return { kind: 'unconfirmed', detail: 'The listing does not say how many messages the discussion holds, so the reply cannot be told from an earlier one.' };
	}
	if (row.messageCount !== previous.messageCount + 1) {
		return { kind: 'unconfirmed', detail: 'The discussion does not hold one more message.' };
	}
	if (row.lastMessageAuthor === undefined) {
		return { kind: 'unconfirmed', detail: 'The discussion names no last author, so the reply cannot be attributed to you.' };
	}
	return isAttributedTo(row.lastMessageAuthor, acting.handle) ? { kind: 'done' } : { kind: 'other-author', author: row.lastMessageAuthor };
}
