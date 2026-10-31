import { pickFlags, readChoices, type FlagPick, type FlagWant } from './controlPlaneFlags';
import { END_OF_OPTIONS } from './operand';
import type { HelpFlag } from './search';

/**
 * The flags the trail depth commands need, found by what the CLI's own
 * help says about them.
 *
 * No flag is written here as a literal. Each is picked from the help of
 * the command it is sent to, by a pattern over its name and then over its
 * help line, so a CLI that renames a flag is followed and a CLI that
 * drops a required one is reported as needing an update. Typed text is
 * always its own argument after its flag, never joined to it, so the
 * runner can leave it out of the reported command line. Ids that came
 * from the CLI are operands after the end of options.
 */

/** Flags of `trail create`. The title is required; the rest are offered when the help lists them. */
export const TRAIL_CREATE_WANTS = {
	title: { name: /^--title$/, description: /^trail title\b/i, required: true },
	body: { name: /^--body$/, description: /^trail description\b/i },
	type: { name: /^--type$/, description: /^type\b/i },
	priority: { name: /^--priority$/, description: /^priority\b/i },
	noBranch: { name: /^--no-branch$/, description: /^create intent scoped\b/i },
} as const satisfies Record<string, FlagWant>;

/** Flags of `trail update`. Which are required depends on which fields the edit changes. */
export const TRAIL_UPDATE_WANTS = {
	title: { name: /^--title$/, description: /^trail title\b/i },
	body: { name: /^--body$/, description: /^trail description\b/i },
	type: { name: /^--type$/, description: /^type\b/i },
	priority: { name: /^--priority$/, description: /^priority\b/i },
	status: { name: /^--status$/, description: /^lifecycle status\b/i },
	assignee: { name: /^--assignee$/, description: /\breplaces the complete list\b/i },
	addAssignee: { name: /^--add-assignee$/, description: /^add assignee/i },
	removeAssignee: { name: /^--remove-assignee$/, description: /^remove assignee/i },
} as const satisfies Record<string, FlagWant>;

/** Flags of the discussion writes (`comment add`, `reply`, `edit`). The body is required. */
export const COMMENT_WRITE_WANTS = {
	body: { name: /^--(?:body|message|text)$/, description: /\bmessage body\b/i, required: true },
	title: { name: /^--title$/, description: /\bdiscussion title\b/i },
} as const satisfies Record<string, FlagWant>;

/** The flag that confirms a message deletion. The CLI may prompt on a terminal without it, so it is required. */
export const DELETE_WANTS = {
	force: { name: /^--(?:force|yes)$/, description: /\bconfirm\b/i, required: true },
} as const satisfies Record<string, FlagWant>;

/** The flag that makes a read print JSON. */
export const JSON_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
} as const satisfies Record<string, FlagWant>;

/** Flags of `finding list`. */
export const FINDING_LIST_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	status: { name: /^--status$/, description: /\blifecycle status\b/i },
	includeDismissed: { name: /dismissed/i, description: /\bdismissed findings\b/i },
} as const satisfies Record<string, FlagWant>;

/** Flags of the finding writes (`dismiss`, `reopen`, `resolve`, `update`). */
export const FINDING_WRITE_WANTS = {
	reason: { name: /^--(?:message|reason)$/, description: /\bstatus reason\b/i },
	body: { name: /^--body$/, description: /\bfinding body\b/i },
	severity: { name: /^--severity$/, description: /\bfinding severity\b/i },
	confidence: { name: /^--confidence$/, description: /\bconfidence\b/i },
	json: { name: /json/i, description: /\bjson\b/i },
} as const satisfies Record<string, FlagWant>;

/** Flags of `finding apply`. The check is required, because the extension checks before it changes the tree. */
export const FINDING_APPLY_WANTS = {
	check: { name: /^--check$/, description: /\bonly check\b/i, required: true },
	resolve: { name: /^--resolve$/, description: /\bmark the finding resolved\b/i },
} as const satisfies Record<string, FlagWant>;

/** Flags of `trail watch`. The once flag is named only so it can be told apart from the JSON flag; it is never sent. */
export const WATCH_WANTS = {
	json: { name: /json/i, description: /\bjson line\b|\bjson\b/i },
	once: { name: /^--once$/, description: /\bone sse connection\b/i },
} as const satisfies Record<string, FlagWant>;

function plan<K extends string>(
	command: string,
	help: string,
	wants: Readonly<Record<K, FlagWant>>,
	fallback: readonly HelpFlag[] = [],
): FlagPick<K> {
	return pickFlags(command, help, fallback, wants);
}

/** What a trail's creation needs from the help. `intentOnly` makes the no-branch flag required. */
export function planTrailCreate(help: string, intentOnly: boolean): FlagPick<keyof typeof TRAIL_CREATE_WANTS> {
	const picked = plan('trail create', help, TRAIL_CREATE_WANTS);
	if (picked.ok && intentOnly && !picked.flags.noBranch) {
		return {
			ok: false,
			detail: "this version of the Entire CLI does not describe the noBranch flag of 'trail create'; update the CLI",
		};
	}
	return picked;
}

/** The fields of a trail an update can change. */
export type TrailEditField = keyof typeof TRAIL_UPDATE_WANTS;

/** What a trail's update needs from the help: a flag for every field the edit changes. */
export function planTrailUpdate(
	help: string,
	changed: readonly TrailEditField[],
): FlagPick<TrailEditField> {
	const picked = plan('trail update', help, TRAIL_UPDATE_WANTS);
	if (!picked.ok) {
		return picked;
	}
	const missing = changed.find(field => !picked.flags[field]);
	return missing
		? { ok: false, detail: `this version of the Entire CLI does not describe the ${missing} flag of 'trail update'; update the CLI` }
		: picked;
}

/** What a discussion write needs from the help. */
export function planDiscussionWrite(
	command: string,
	help: string,
	needs: { readonly body: boolean; readonly force: boolean },
): FlagPick<'body' | 'title' | 'force'> {
	const wants: Record<'body' | 'title' | 'force', FlagWant> = {
		body: { ...COMMENT_WRITE_WANTS.body, required: needs.body },
		title: COMMENT_WRITE_WANTS.title,
		force: { ...DELETE_WANTS.force, required: needs.force },
	};
	return plan(command, help, wants);
}

/** What a read that prints JSON needs from the help. */
export function planJsonRead(command: string, help: string): FlagPick<'json'> {
	return plan(command, help, JSON_WANTS);
}

/** What the finding listing needs from the help. */
export function planFindingList(help: string): FlagPick<keyof typeof FINDING_LIST_WANTS> {
	return plan('trail finding list', help, FINDING_LIST_WANTS);
}

/** What a finding write needs from the help. */
export function planFindingWrite(
	command: string,
	help: string,
	needs: readonly (keyof typeof FINDING_WRITE_WANTS)[],
): FlagPick<keyof typeof FINDING_WRITE_WANTS> {
	const picked = plan(command, help, FINDING_WRITE_WANTS);
	if (!picked.ok) {
		return picked;
	}
	const missing = needs.find(key => !picked.flags[key]);
	return missing
		? { ok: false, detail: `this version of the Entire CLI does not describe the ${missing} flag of '${command}'; update the CLI` }
		: picked;
}

/** What applying a finding needs from the help. */
export function planFindingApply(help: string, resolve: boolean): FlagPick<keyof typeof FINDING_APPLY_WANTS> {
	const picked = plan('trail finding apply', help, FINDING_APPLY_WANTS);
	if (picked.ok && resolve && !picked.flags.resolve) {
		return {
			ok: false,
			detail: "this version of the Entire CLI does not describe the resolve flag of 'trail finding apply'; update the CLI",
		};
	}
	return picked;
}

/** What watching needs from the help. */
export function planWatch(help: string): FlagPick<keyof typeof WATCH_WANTS> {
	return plan('trail watch', help, WATCH_WANTS);
}

/** The commands the depth flows run, as the CLI names them. */
export const TRAIL_DEPTH_COMMANDS = {
	create: 'trail create',
	update: 'trail update',
	watch: 'trail watch',
	commentAdd: 'trail comment add',
	commentList: 'trail comment list',
	commentShow: 'trail comment show',
	commentReply: 'trail comment reply',
	commentEdit: 'trail comment edit',
	commentDelete: 'trail comment delete',
	commentResolve: 'trail comment resolve',
	commentUnresolve: 'trail comment unresolve',
	findingList: 'trail finding list',
	findingShow: 'trail finding show',
	findingApply: 'trail finding apply',
	findingDismiss: 'trail finding dismiss',
	findingReopen: 'trail finding reopen',
	findingResolve: 'trail finding resolve',
	findingUpdate: 'trail finding update',
} as const;

/** What a new trail is made from. */
export interface TrailDraft {
	readonly title: string;
	readonly body?: string;
	readonly type?: string;
	readonly priority?: string;
	/** True for a trail of intent only, with no branch published. */
	readonly intentOnly: boolean;
}

/** What an update changes. A field left out is not touched. */
export interface TrailEdit {
	readonly title?: string;
	readonly body?: string;
	readonly type?: string;
	readonly priority?: string;
	readonly status?: string;
	/** Replaces the complete list. An empty list clears it. */
	readonly assignees?: readonly string[];
	readonly addAssignees?: readonly string[];
	readonly removeAssignees?: readonly string[];
}

type CreateFlags = Readonly<Partial<Record<keyof typeof TRAIL_CREATE_WANTS, string>>>;
type UpdateFlags = Readonly<Partial<Record<TrailEditField, string>>>;

/** `entire trail create`, with the title and the body as arguments of their own. */
export function trailCreateArguments(flags: CreateFlags, draft: TrailDraft): readonly string[] {
	const args: string[] = ['trail', 'create'];
	if (flags.title) {
		args.push(flags.title, draft.title);
	}
	if (flags.body && draft.body && draft.body.length > 0) {
		args.push(flags.body, draft.body);
	}
	if (flags.type && draft.type) {
		args.push(flags.type, draft.type);
	}
	if (flags.priority && draft.priority) {
		args.push(flags.priority, draft.priority);
	}
	if (flags.noBranch && draft.intentOnly) {
		args.push(flags.noBranch);
	}
	return args;
}

/** The fields an edit changes, in a stable order. */
export function changedFields(edit: TrailEdit): readonly TrailEditField[] {
	const fields: TrailEditField[] = [];
	if (edit.title !== undefined) {
		fields.push('title');
	}
	if (edit.body !== undefined) {
		fields.push('body');
	}
	if (edit.type !== undefined) {
		fields.push('type');
	}
	if (edit.priority !== undefined) {
		fields.push('priority');
	}
	if (edit.status !== undefined) {
		fields.push('status');
	}
	if (edit.assignees !== undefined) {
		fields.push('assignee');
	}
	if (edit.addAssignees !== undefined && edit.addAssignees.length > 0) {
		fields.push('addAssignee');
	}
	if (edit.removeAssignees !== undefined && edit.removeAssignees.length > 0) {
		fields.push('removeAssignee');
	}
	return fields;
}

/** The flags of `trail update` for an edit. The trail itself is named by the caller. */
export function trailUpdateArguments(flags: UpdateFlags, edit: TrailEdit): readonly string[] {
	const args: string[] = [];
	const push = (flag: string | undefined, value: string | undefined): void => {
		if (flag && value !== undefined) {
			args.push(flag, value);
		}
	};
	push(flags.title, edit.title);
	push(flags.body, edit.body);
	push(flags.type, edit.type);
	push(flags.priority, edit.priority);
	push(flags.status, edit.status);
	push(flags.assignee, edit.assignees === undefined ? undefined : edit.assignees.join(','));
	push(flags.addAssignee, edit.addAssignees && edit.addAssignees.length > 0 ? edit.addAssignees.join(',') : undefined);
	push(flags.removeAssignee, edit.removeAssignees && edit.removeAssignees.length > 0 ? edit.removeAssignees.join(',') : undefined);
	return args;
}

/** The flags whose values are typed text and so are left out of a reported command line. */
export function typedFlags(flags: Readonly<Record<string, string | undefined>>, keys: readonly string[]): readonly string[] {
	return keys.flatMap(key => {
		const flag = flags[key];
		return flag ? [flag] : [];
	});
}

/** One discussion write or read. */
export type DiscussionInput =
	| { readonly kind: 'add'; readonly body: string; readonly title?: string }
	| { readonly kind: 'reply'; readonly id: string; readonly body: string }
	| { readonly kind: 'edit'; readonly id: string; readonly messageId: string; readonly body: string }
	| { readonly kind: 'delete'; readonly id: string; readonly messageId: string }
	| { readonly kind: 'resolve' | 'unresolve'; readonly id: string }
	| { readonly kind: 'show'; readonly id: string };

type DiscussionFlags = Readonly<Partial<Record<'body' | 'title' | 'force' | 'json', string>>>;

/** The flags and operands of a discussion command, after the trail. Ids follow the end of options. */
export function discussionArguments(flags: DiscussionFlags, input: DiscussionInput): readonly string[] {
	switch (input.kind) {
		case 'add':
			return [
				...(flags.title && input.title ? [flags.title, input.title] : []),
				...(flags.body ? [flags.body, input.body] : []),
			];
		case 'reply':
			return [...(flags.body ? [flags.body, input.body] : []), END_OF_OPTIONS, input.id];
		case 'edit':
			return [...(flags.body ? [flags.body, input.body] : []), END_OF_OPTIONS, input.id, input.messageId];
		case 'delete':
			return [...(flags.force ? [flags.force] : []), END_OF_OPTIONS, input.id, input.messageId];
		case 'resolve':
		case 'unresolve':
			return [END_OF_OPTIONS, input.id];
		case 'show':
			return [...(flags.json ? [flags.json] : []), END_OF_OPTIONS, input.id];
	}
}

/** One finding command. */
export type FindingInput =
	| { readonly kind: 'list'; readonly any: boolean }
	| { readonly kind: 'show'; readonly id: string }
	| { readonly kind: 'dismiss' | 'reopen' | 'resolve'; readonly id: string; readonly reason?: string }
	| {
			readonly kind: 'update';
			readonly id: string;
			readonly body?: string;
			readonly severity?: string;
			readonly confidence?: number;
	  }
	| { readonly kind: 'apply'; readonly id: string; readonly check: boolean; readonly resolve: boolean };

type FindingFlags = Readonly<
	Partial<Record<'json' | 'status' | 'includeDismissed' | 'reason' | 'body' | 'severity' | 'confidence' | 'check' | 'resolve', string>>
>;

/** What the `status` flag is given to list every finding, read from the flag's own help line. */
export function anyStatusValue(statusHelp: string): string {
	return /\bany\b/i.test(statusHelp) ? 'any' : 'open,resolved,dismissed';
}

/** The flags and operands of a finding command, after the trail. The id follows the end of options. */
export function findingArguments(flags: FindingFlags, input: FindingInput, anyStatus = 'any'): readonly string[] {
	switch (input.kind) {
		case 'list':
			return [
				...(flags.json ? [flags.json] : []),
				...(input.any && flags.status ? [flags.status, anyStatus] : []),
				...(input.any && flags.includeDismissed ? [flags.includeDismissed] : []),
			];
		case 'show':
			return [END_OF_OPTIONS, input.id];
		case 'dismiss':
		case 'reopen':
		case 'resolve':
			return [...(flags.reason && input.reason ? [flags.reason, input.reason] : []), END_OF_OPTIONS, input.id];
		case 'update':
			return [
				...(flags.body && input.body !== undefined ? [flags.body, input.body] : []),
				...(flags.severity && input.severity !== undefined ? [flags.severity, input.severity] : []),
				...(flags.confidence && input.confidence !== undefined ? [flags.confidence, String(input.confidence)] : []),
				END_OF_OPTIONS,
				input.id,
			];
		case 'apply':
			return [
				...(input.check && flags.check ? [flags.check] : []),
				...(!input.check && input.resolve && flags.resolve ? [flags.resolve] : []),
				END_OF_OPTIONS,
				input.id,
			];
	}
}

/** The flags of `trail watch`, after the trail. The once flag is never sent: the CLI reconnects by itself. */
export function watchArguments(flags: Readonly<Partial<Record<keyof typeof WATCH_WANTS, string>>>): readonly string[] {
	return flags.json ? [flags.json] : [];
}

const LISTED = /^[A-Za-z][A-Za-z0-9-]*(?:\s*,\s*[A-Za-z][A-Za-z0-9-]*)+$/;

/**
 * The values a flag's help line names, whether as `one of a, b`, after a colon, or in brackets.
 *
 * The CLI writes `Priority (urgent, high, medium, low, none)` and
 * `Finding severity: high,medium,low`. A line that names no list gives
 * none, and the field is then offered as free text for the CLI to check.
 */
export function choicesOf(description: string): readonly string[] {
	const listed = readChoices(description);
	if (listed.length > 0) {
		return listed;
	}
	for (const match of description.matchAll(/\(([^()]*)\)/g)) {
		const inner = match[1].trim();
		if (LISTED.test(inner)) {
			return inner.split(/\s*,\s*/);
		}
	}
	return [];
}
