import {
	TRAIL_DEPTH_COMMANDS,
	changedFields,
	choicesOf,
	describeFlag,
	planTrailCreate,
	planTrailUpdate,
	trailCreateArguments,
	trailUpdateArguments,
	typedFlags,
	type ActingLogin,
	type DepthOutcome,
	type Trail,
	type TrailDraft,
	type TrailEdit,
	type TrailEditField,
	type TrailSelector,
} from '../lib/entire';
import { depthFailure, failureText, readCommandHelp, type DepthDependencies } from './trailDepthSupport';
import type { TrailWorkspace } from './trailService';

/** What the CLI's help says a create or an update offers, read fresh each time. */
export type FieldOptions =
	| {
			readonly ok: true;
			/** The names of the flags the help lists, in the extension's own keys. */
			readonly offered: readonly string[];
			/** The values the help names for a field. A field with no list is free text. */
			readonly choices: Readonly<Record<'type' | 'priority' | 'status', readonly string[]>>;
	  }
	| { readonly ok: false; readonly detail: string };

/** How creating a trail ended. */
export type CreateOutcome = DepthOutcome & { readonly trail?: Trail };

/** The comparison used for titles and bodies: the CLI may trim what it stores. */
function same(left: string | undefined, right: string): boolean {
	return (left ?? '').trim() === right.trim();
}

function sameLogins(left: readonly string[], right: readonly string[]): boolean {
	const normal = (logins: readonly string[]): string => [...new Set(logins.map(login => login.toLowerCase()))].sort().join('\n');
	return normal(left) === normal(right);
}

/**
 * Creates and updates trails.
 *
 * Each change is made once, as the login that was confirmed, and never
 * retried. Typed text goes to the CLI as arguments of their own and is
 * left out of the reported command line; what the CLI prints is withheld.
 * A change is reported only after a fresh read shows it. Verified against
 * a fake CLI only: the real service was not asked to create or change a trail.
 */
export class TrailAuthoringService {
	constructor(private readonly deps: DepthDependencies) {}

	/** What `trail create` offers, from its help. A CLI without the command or its title flag is reported. */
	async createOptions(): Promise<FieldOptions> {
		const help = await readCommandHelp(this.deps.runner, TRAIL_DEPTH_COMMANDS.create, this.deps.workspaceRoot());
		if (!help.ok) {
			return help;
		}
		const picked = planTrailCreate(help.raw, false);
		if (!picked.ok) {
			return picked;
		}
		const offered = Object.entries(picked.flags).flatMap(([key, flag]) => (flag ? [key] : []));
		return { ok: true, offered, choices: this.choiceLists(picked.table, picked.flags) };
	}

	/** What `trail update` offers, from its help. */
	async updateOptions(): Promise<FieldOptions> {
		const help = await readCommandHelp(this.deps.runner, TRAIL_DEPTH_COMMANDS.update, this.deps.workspaceRoot());
		if (!help.ok) {
			return help;
		}
		const picked = planTrailUpdate(help.raw, []);
		if (!picked.ok) {
			return picked;
		}
		const offered = Object.entries(picked.flags).flatMap(([key, flag]) => (flag ? [key] : []));
		return { ok: true, offered, choices: this.choiceLists(picked.table, picked.flags) };
	}

	private choiceLists(
		table: Parameters<typeof describeFlag>[0],
		flags: Readonly<Partial<Record<string, string>>>,
	): Readonly<Record<'type' | 'priority' | 'status', readonly string[]>> {
		const of = (key: TrailEditField | 'type' | 'priority' | 'status'): readonly string[] => choicesOf(describeFlag(table, flags[key]));
		return { type: of('type'), priority: of('priority'), status: of('status') };
	}

	/**
	 * Creates a trail.
	 *
	 * The list of the repository's trails is read first, so that the trail
	 * is told apart from the ones already there, and read again afterwards.
	 * A trail is reported done only when exactly one new trail carries the
	 * typed title. A failure after which a new trail is there is partly
	 * done: the CLI's rule is to link the branch rather than create again.
	 */
	async create(draft: TrailDraft, acting: ActingLogin, workspace: TrailWorkspace): Promise<CreateOutcome> {
		const command = TRAIL_DEPTH_COMMANDS.create;
		const cwd = this.deps.workspaceRoot();
		const help = await readCommandHelp(this.deps.runner, command, cwd);
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planTrailCreate(help.raw, draft.intentOnly);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}

		const before = await this.deps.trails.list(workspace.project, workspace.repository, acting.name, true);
		if (before.kind === 'failed') {
			return { kind: 'failed', detail: await depthFailure(this.deps, before.detail, before.detail, acting) };
		}
		const known = new Set(before.value.items.map(trail => trail.number));

		const args = trailCreateArguments(picked.flags, draft);
		const result = await this.deps.runner.run(args, {
			...this.deps.trails.actionOptions(typedFlags(picked.flags, ['title', 'body']), acting.name),
		});

		const after = await this.deps.trails.list(workspace.project, workspace.repository, acting.name);
		const appeared =
			after.kind === 'ok'
				? after.value.items.filter(trail => !known.has(trail.number) && same(trail.title, draft.title))
				: [];

		if (!result.ok) {
			if (appeared.length >= 1) {
				return {
					kind: 'partly-done',
					trail: appeared[0],
					advice: `The trail exists, so do not create it again: link the branch to trail #${appeared[0].number} with "Link a Branch to a Trail" (the CLI's own rule).`,
				};
			}
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}
		if (after.kind === 'failed') {
			return { kind: 'unconfirmed', detail: 'The list of trails could not be read again, so check the web UI.' };
		}
		if (appeared.length === 1) {
			return { kind: 'done', trail: appeared[0] };
		}
		return {
			kind: 'unconfirmed',
			detail:
				appeared.length === 0
					? 'The CLI reported success but the trail is not in the list. Check the web UI.'
					: 'More than one new trail carries that title, so Entirely cannot say which is yours. Check the web UI.',
		};
	}

	/**
	 * Updates a trail.
	 *
	 * An edit that changes nothing is refused before the CLI is asked
	 * anything. The trail is read again afterwards and the update is done
	 * only if every changed field equals its new value there.
	 */
	async update(selector: TrailSelector, edit: TrailEdit, acting: ActingLogin): Promise<DepthOutcome> {
		const fields = changedFields(edit);
		if (fields.length === 0) {
			return { kind: 'failed', detail: 'there is nothing to change.' };
		}
		const command = TRAIL_DEPTH_COMMANDS.update;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planTrailUpdate(help.raw, fields);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}

		const args = await this.deps.trails.selectorArgs(command, selector, trailUpdateArguments(picked.flags, edit));
		const result = await this.deps.runner.run(
			args,
			this.deps.trails.actionOptions(typedFlags(picked.flags, ['title', 'body', 'assignee', 'addAssignee', 'removeAssignee']), acting.name),
		);
		if (!result.ok) {
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}

		const shown = await this.deps.trails.show(selector, acting.name);
		if (shown.kind === 'failed') {
			return { kind: 'unconfirmed', detail: 'The trail could not be read again.' };
		}
		const trail = shown.value.trail;
		const wrong: string[] = [];
		if (edit.title !== undefined && !same(trail.title, edit.title)) {
			wrong.push('title');
		}
		if (edit.body !== undefined && !same(trail.body, edit.body)) {
			wrong.push('description');
		}
		if (edit.type !== undefined && trail.type !== edit.type) {
			wrong.push('type');
		}
		if (edit.priority !== undefined && trail.priority !== edit.priority) {
			wrong.push('priority');
		}
		if (edit.status !== undefined && trail.status !== edit.status) {
			wrong.push('status');
		}
		const logins = trail.assignees;
		if (edit.assignees !== undefined && (logins === undefined || !sameLogins(logins, edit.assignees))) {
			wrong.push('assignees');
		}
		if (edit.addAssignees && edit.addAssignees.length > 0) {
			const held = new Set((logins ?? []).map(login => login.toLowerCase()));
			if (logins === undefined || !edit.addAssignees.every(login => held.has(login.toLowerCase()))) {
				wrong.push('added assignees');
			}
		}
		if (edit.removeAssignees && edit.removeAssignees.length > 0) {
			const held = new Set((logins ?? []).map(login => login.toLowerCase()));
			if (logins === undefined || edit.removeAssignees.some(login => held.has(login.toLowerCase()))) {
				wrong.push('removed assignees');
			}
		}
		return wrong.length === 0
			? { kind: 'done' }
			: { kind: 'unconfirmed', detail: `The fresh read does not show the new ${wrong.join(', ')}.` };
	}
}
