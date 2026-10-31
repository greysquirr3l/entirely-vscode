import {
	asTrailPick,
	changePicks,
	confirmTrailDepth,
	describeApplyRefusal,
	describeChange,
	describeDepthFailure,
	describeDepthOutcome,
	discussionLabel,
	discussionMarkdown,
	findingLabel,
	mayEditMessage,
	pickFromTarget,
	threadTargetOf,
	type ActingLogin,
	type DepthAction,
	type DepthConfirmation,
	type DepthOutcome,
	type DepthSubject,
	type DiscussionMessage,
	type Trail,
	type TrailComment,
	type TrailEdit,
	type TrailFinding,
	type TrailPick,
	type UnsavedFile,
} from '../lib/entire';
import { truncatePrompt } from '../lib/entire/text';
import type { FindingLifecycle } from '../services/trailFindings';
import type { TrailAuthoringService } from '../services/trailAuthoring';
import type { TrailDiscussionService } from '../services/trailDiscussions';
import type { TrailFindingService } from '../services/trailFindings';
import type { TrailService } from '../services/trailService';
import type { TrailWatchService } from '../services/trailWatch';
import { watchKey } from '../services/trailWatch';

/** What a flow asks the person, and how it tells them. */
export interface TrailDepthUi {
	pickTrail(trails: readonly Trail[]): Promise<Trail | undefined>;
	pickChange(picks: readonly TrailPick[]): Promise<TrailPick | undefined>;
	pickDiscussion(discussions: readonly TrailComment[]): Promise<TrailComment | undefined>;
	pickMessage(messages: readonly DiscussionMessage[]): Promise<DiscussionMessage | undefined>;
	pickFinding(findings: readonly TrailFinding[]): Promise<TrailFinding | undefined>;
	/** A line of text. `undefined` means the person dismissed the box. */
	input(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly placeHolder?: string;
		readonly validate?: (value: string) => string | undefined;
	}): Promise<string | undefined>;
	choice<T extends string>(
		title: string,
		items: readonly { readonly label: string; readonly description?: string; readonly value: T }[],
	): Promise<T | undefined>;
	/** `primary` for the main button, `alternative` for the second, `undefined` when dismissed. */
	confirm(prompt: DepthConfirmation): Promise<'primary' | 'alternative' | undefined>;
	/** The files the editor holds with unsaved changes. */
	unsavedFiles(): readonly UnsavedFile[];
	/** Opens a read-only document. Its text is review text: it opens only on a command and is never logged. */
	show(kind: 'trail-discussion' | 'trail-finding', name: string, text: string): Promise<void>;
	/** Tells the person. `copy` offers a command line to put on the clipboard. */
	notify(level: 'info' | 'warn' | 'error', message: string, copy?: string): void;
	withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
}

/** What the flows need. */
export interface TrailDepthDependencies {
	readonly trails: TrailService;
	readonly authoring: TrailAuthoringService;
	readonly discussions: TrailDiscussionService;
	readonly findings: TrailFindingService;
	readonly watch: TrailWatchService;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<ActingLogin | undefined>;
	readonly ui: TrailDepthUi;
	/** Called after a trail was created or changed, so the trails are read again. */
	readonly changed: (pick?: TrailPick) => void;
	/** Called after a write to a change's discussions or findings, so those rows are read again. */
	readonly threadsChanged: (key?: string) => void;
	/** Fills in the changes of the listed trails, which the CLI's list does not carry. */
	readonly withChanges?: (trails: readonly Trail[]) => Promise<readonly Trail[]>;
	/** The checked-out branch, when the editor's git extension names it. */
	readonly currentBranch?: () => string | undefined;
	/** The name of the workspace folder, for the question before an apply. */
	readonly folderName: () => string;
	/** True while a change is running, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

/** How a flow ended. */
export type DepthResult = 'cancelled' | 'busy' | 'no-login' | 'unavailable' | 'done' | 'unconfirmed' | 'failed';

const sharedRunning = { active: false };

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who this would be done as. Sign in first.';

async function guarded(deps: TrailDepthDependencies, work: () => Promise<DepthResult>): Promise<DepthResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		deps.ui.notify('info', 'A trail change is already running.');
		return 'busy';
	}
	running.active = true;
	try {
		return await work();
	} finally {
		running.active = false;
	}
}

function resultOf(outcome: DepthOutcome): DepthResult {
	switch (outcome.kind) {
		case 'done':
			return 'done';
		case 'failed':
			return 'failed';
		default:
			return 'unconfirmed';
	}
}

function trailLabel(trail: Trail): string {
	return `trail #${trail.number} "${truncatePrompt(trail.title ?? 'Untitled trail', 60)}"`;
}

/** Confirms where the rules say to, runs once, reports from the fresh read, and tells the views. */
async function perform(
	deps: TrailDepthDependencies,
	acting: ActingLogin,
	options: {
		readonly action?: DepthAction;
		readonly subject: DepthSubject;
		readonly progress: string;
		readonly run: () => Promise<DepthOutcome>;
		readonly after: () => void;
	},
): Promise<DepthResult> {
	const question = options.action ? confirmTrailDepth(options.action, acting) : undefined;
	if (question && (await deps.ui.confirm(question)) === undefined) {
		return 'cancelled';
	}
	const outcome = await deps.ui.withProgress(options.progress, () => options.run());
	options.after();
	deps.ui.notify(outcome.kind === 'done' ? 'info' : outcome.kind === 'failed' ? 'error' : 'warn', describeDepthOutcome(options.subject, outcome, acting));
	return resultOf(outcome);
}

async function signedIn(deps: TrailDepthDependencies): Promise<ActingLogin | undefined> {
	const acting = await deps.acting();
	if (!acting) {
		deps.ui.notify('warn', NO_LOGIN);
	}
	return acting;
}

/** The trails of the workspace's repository, with the failure said when they cannot be read. */
async function listTrails(deps: TrailDepthDependencies): Promise<readonly Trail[] | undefined> {
	const workspace = await deps.trails.workspace();
	if (workspace.kind === 'failed') {
		deps.ui.notify('error', `Entirely could not work out which trails this workspace belongs to: ${workspace.detail}`);
		return undefined;
	}
	const list = await deps.trails.list(workspace.value.project, workspace.value.repository);
	if (list.kind === 'failed') {
		deps.ui.notify('error', `Entirely could not list the trails of ${workspace.value.project}: ${describeDepthFailure(list.detail, list.detail, { project: workspace.value.project })}`);
		return undefined;
	}
	return list.value.items;
}

async function changeToActOn(deps: TrailDepthDependencies, given: TrailPick | undefined): Promise<TrailPick | undefined> {
	if (given?.kind === 'change') {
		return given;
	}
	const listed = await listTrails(deps);
	if (!listed) {
		return undefined;
	}
	const trails = deps.withChanges ? await deps.withChanges(listed) : listed;
	const picks = changePicks(trails);
	if (picks.length === 0) {
		deps.ui.notify('info', 'Entirely found no changes on the trails of this repository.');
		return undefined;
	}
	const picked = await deps.ui.pickChange(picks);
	return picked?.kind === 'change' ? picked : undefined;
}

async function trailToActOn(deps: TrailDepthDependencies, given: TrailPick | undefined): Promise<TrailPick | undefined> {
	if (given) {
		return asTrailPick(given);
	}
	const listed = await listTrails(deps);
	if (!listed) {
		return undefined;
	}
	if (listed.length === 0) {
		deps.ui.notify('info', 'Entirely found no trails in this repository.');
		return undefined;
	}
	const trail = await deps.ui.pickTrail(listed);
	return trail ? { kind: 'trail', trail, selector: { kind: 'trail', number: trail.number } } : undefined;
}

/** The discussion a command is about: the row's, or one the person picks from the change's. */
async function discussionToActOn(deps: TrailDepthDependencies, pick: TrailPick, given: TrailComment | undefined, acting: ActingLogin): Promise<TrailComment | undefined> {
	if (given) {
		return given;
	}
	const listed = await deps.discussions.list(pick.selector, acting.name);
	if (listed.kind === 'failed') {
		deps.ui.notify('error', `Entirely could not read the discussions of ${describeChange(pick.kind === 'change' ? pick.change : { repository: '', number: 0, branch: '' })}: ${describeDepthFailure(listed.detail, listed.detail, { login: acting.handle })}`);
		return undefined;
	}
	if (listed.value.length === 0) {
		deps.ui.notify('info', 'This change has no discussions yet.');
		return undefined;
	}
	return deps.ui.pickDiscussion(listed.value);
}

async function findingToActOn(deps: TrailDepthDependencies, pick: TrailPick, given: TrailFinding | undefined, acting: ActingLogin): Promise<TrailFinding | undefined> {
	if (given) {
		return given;
	}
	const listed = await deps.findings.list(pick.selector, acting.name);
	if (listed.kind === 'failed') {
		deps.ui.notify('error', `Entirely could not read the findings: ${describeDepthFailure(listed.detail, listed.detail, { login: acting.handle })}`);
		return undefined;
	}
	if (listed.value.length === 0) {
		deps.ui.notify('info', 'This change has no findings.');
		return undefined;
	}
	return deps.ui.pickFinding(listed.value);
}

function keyOf(pick: TrailPick): string | undefined {
	return pick.kind === 'change' ? `${pick.change.repository}/${pick.change.number}` : undefined;
}

const REQUIRED = (value: string): string | undefined => (value.trim().length === 0 ? 'Write something first.' : undefined);

/** Creates a trail for the current branch, or an intent-only trail, after naming the login and what is published. */
export async function createTrail(deps: TrailDepthDependencies): Promise<DepthResult> {
	return guarded(deps, async () => {
		const { ui } = deps;
		const options = await deps.authoring.createOptions();
		if (!options.ok) {
			ui.notify('error', `Entirely cannot create a trail: ${options.detail}`);
			return 'unavailable';
		}
		const workspace = await deps.trails.workspace();
		if (workspace.kind === 'failed') {
			ui.notify('error', `Entirely could not work out which project this workspace belongs to: ${workspace.detail}`);
			return 'failed';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}

		const title = await ui.input({ title: 'Create a trail', prompt: `The trail's title, in ${workspace.value.repository}.`, validate: REQUIRED });
		if (title === undefined) {
			return 'cancelled';
		}
		let body: string | undefined;
		if (options.offered.includes('body')) {
			body = await ui.input({ title: 'Create a trail', prompt: 'A description (optional; leave empty for none).' });
			if (body === undefined) {
				return 'cancelled';
			}
		}
		let intentOnly = false;
		if (options.offered.includes('noBranch')) {
			const mode = await ui.choice('Create a trail for', [
				{ label: 'For the current branch', description: 'Publishes your current branch', value: 'branch' as const },
				{ label: 'Intent only (no branch)', description: 'Records the idea in this repository without a branch', value: 'intent' as const },
			]);
			if (mode === undefined) {
				return 'cancelled';
			}
			intentOnly = mode === 'intent';
		}
		const type = await optionalChoice(deps, 'Type', options.offered.includes('type') ? options.choices.type : []);
		if (type === null) {
			return 'cancelled';
		}
		const priority = await optionalChoice(deps, 'Priority', options.offered.includes('priority') ? options.choices.priority : []);
		if (priority === null) {
			return 'cancelled';
		}

		const draft = {
			title: title.trim(),
			body: body && body.trim().length > 0 ? body.trim() : undefined,
			type,
			priority,
			intentOnly,
		};
		const question = confirmTrailDepth(
			{ kind: 'create-trail', title: draft.title, intentOnly, repository: workspace.value.repository, branch: deps.currentBranch?.() },
			acting,
		);
		if (question && (await ui.confirm(question)) === undefined) {
			return 'cancelled';
		}

		const outcome = await ui.withProgress(`Creating the trail as ${acting.handle}…`, () => deps.authoring.create(draft, acting, workspace.value));
		deps.changed();
		const subject: DepthSubject = {
			past: `created trail${outcome.kind === 'done' && outcome.trail ? ` #${outcome.trail.number}` : ''} "${truncatePrompt(draft.title, 60)}"`,
			ask: `create the trail "${truncatePrompt(draft.title, 60)}"`,
		};
		ui.notify(outcome.kind === 'done' ? 'info' : outcome.kind === 'failed' ? 'error' : 'warn', describeDepthOutcome(subject, outcome, acting));
		return resultOf(outcome);
	});
}

/** A choice from a list the help named, with a way to let the CLI decide. `null` means the person dismissed it. */
async function optionalChoice(deps: TrailDepthDependencies, title: string, values: readonly string[]): Promise<string | undefined | null> {
	if (values.length === 0) {
		return undefined;
	}
	const picked = await deps.ui.choice(title, [
		{ label: 'None (let the CLI decide)', value: '' },
		...values.map(value => ({ label: value, value })),
	]);
	if (picked === undefined) {
		return null;
	}
	return picked.length > 0 ? picked : undefined;
}

const FIELD_LABELS = {
	title: 'Title',
	body: 'Description',
	type: 'Type',
	priority: 'Priority',
	status: 'Status',
	addAssignee: 'Add assignee',
	removeAssignee: 'Remove assignee',
	assignee: 'Replace assignee list',
} as const;

function logins(text: string): string[] {
	return text
		.split(/[\s,]+/)
		.map(login => login.trim())
		.filter(login => login.length > 0);
}

/** Changes one field of a trail. Closing it, or replacing its assignee list, asks first. */
export async function updateTrail(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const { ui } = deps;
		const options = await deps.authoring.updateOptions();
		if (!options.ok) {
			ui.notify('error', `Entirely cannot update a trail: ${options.detail}`);
			return 'unavailable';
		}
		const pick = await trailToActOn(deps, pickFromTarget(target));
		if (!pick) {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}

		const shown = await deps.trails.show(pick.selector, acting.name);
		if (shown.kind === 'failed') {
			ui.notify('error', `Entirely could not read ${trailLabel(pick.trail)}: ${describeDepthFailure(shown.detail, shown.detail, { login: acting.handle })}`);
			return 'failed';
		}
		const current = shown.value.trail;

		const fields = (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).filter(field => options.offered.includes(field));
		const items: { label: string; value: string }[] = fields.map(field => ({ label: FIELD_LABELS[field], value: field }));
		if (options.offered.includes('assignee')) {
			items.push({ label: 'Clear all assignees', value: 'clear' });
		}
		const field = await ui.choice<string>(`Update ${trailLabel(current)}`, items);
		if (field === undefined) {
			return 'cancelled';
		}

		const edit = await readEdit(deps, field, current, options.choices);
		if (!edit) {
			return 'cancelled';
		}

		const label = trailLabel(current);
		return perform(deps, acting, {
			action: { kind: 'update-trail', trail: label, edit, before: { status: current.status, assignees: current.assignees } },
			subject: { past: `updated ${label}`, ask: `update ${label}` },
			progress: `Updating the trail as ${acting.handle}…`,
			run: () => deps.authoring.update(pick.selector, edit, acting),
			after: () => deps.changed(pick),
		});
	});
}

async function readEdit(
	deps: TrailDepthDependencies,
	field: string,
	current: Trail,
	choices: Readonly<Record<'type' | 'priority' | 'status', readonly string[]>>,
): Promise<TrailEdit | undefined> {
	const { ui } = deps;
	switch (field) {
		case 'title': {
			const value = await ui.input({ title: 'Update the title', prompt: trailLabel(current), value: current.title ?? '', validate: REQUIRED });
			return value === undefined ? undefined : { title: value.trim() };
		}
		case 'body': {
			const value = await ui.input({ title: 'Update the description', prompt: trailLabel(current), value: current.body ?? '' });
			return value === undefined ? undefined : { body: value };
		}
		case 'type':
		case 'priority':
		case 'status': {
			const values = choices[field];
			const value =
				values.length > 0
					? await ui.choice<string>(`Set the ${field}`, values.map(item => ({ label: item, value: item })))
					: await ui.input({ title: `Set the ${field}`, prompt: trailLabel(current), validate: REQUIRED });
			return value === undefined ? undefined : { [field]: value.trim() };
		}
		case 'addAssignee':
		case 'removeAssignee':
		case 'assignee': {
			const verb = field === 'addAssignee' ? 'Add' : field === 'removeAssignee' ? 'Remove' : 'Replace the list with';
			const value = await ui.input({
				title: `${verb} assignees`,
				prompt: 'Logins, separated by commas.',
				validate: text => (logins(text).length === 0 ? 'Write at least one login.' : undefined),
			});
			if (value === undefined) {
				return undefined;
			}
			const list = logins(value);
			return field === 'addAssignee' ? { addAssignees: list } : field === 'removeAssignee' ? { removeAssignees: list } : { assignees: list };
		}
		case 'clear':
			return { assignees: [] };
		default:
			return undefined;
	}
}

/** Starts a discussion on a change. */
export async function startDiscussion(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const body = await deps.ui.input({ title: 'Start a discussion', prompt: describeChange(pick.change), placeHolder: 'What do you want to raise?', validate: REQUIRED });
		if (body === undefined) {
			return 'cancelled';
		}
		const title = await deps.ui.input({ title: 'Start a discussion', prompt: 'A title (optional; leave empty for none).' });
		if (title === undefined) {
			return 'cancelled';
		}
		const name = describeChange(pick.change);
		return perform(deps, acting, {
			action: { kind: 'start-discussion', target: name },
			subject: { past: `started a discussion on ${name}`, ask: `start a discussion on ${name}` },
			progress: `Writing as ${acting.handle}…`,
			run: () => deps.discussions.write(pick.selector, { kind: 'add', body: body.trim(), title: title.trim().length > 0 ? title.trim() : undefined }, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Replies to a discussion. */
export async function replyToDiscussion(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const discussion = await discussionToActOn(deps, pick, thread?.discussion, acting);
		if (!discussion) {
			return 'cancelled';
		}
		const label = discussionLabel(discussion);
		const body = await deps.ui.input({ title: 'Reply to the discussion', prompt: label, validate: REQUIRED });
		if (body === undefined) {
			return 'cancelled';
		}
		return perform(deps, acting, {
			action: { kind: 'reply-discussion', target: label },
			subject: { past: `replied to the discussion '${label}'`, ask: `reply to the discussion '${label}'` },
			progress: `Writing as ${acting.handle}…`,
			run: () => deps.discussions.write(pick.selector, { kind: 'reply', id: discussion.id, body: body.trim() }, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Reads a discussion's messages, saying so plainly when the CLI's answer is not one Entirely reads. */
async function messagesOf(
	deps: TrailDepthDependencies,
	pick: TrailPick,
	discussion: TrailComment,
	acting: ActingLogin,
): Promise<readonly DiscussionMessage[] | undefined> {
	const view = await deps.discussions.show(pick.selector, discussion.id, acting.name);
	if (view.kind === 'failed') {
		deps.ui.notify('error', `Entirely could not read the discussion: ${describeDepthFailure(view.detail, view.detail, { login: acting.handle })}`);
		return undefined;
	}
	if (view.value.messages === undefined) {
		deps.ui.notify(
			'warn',
			'The CLI answered in a form this version of Entirely does not read, so the messages cannot be listed here. Use the CLI in a terminal for this.',
			await deps.discussions.commandLine(pick.selector, discussion.id),
		);
		return undefined;
	}
	return view.value.messages;
}

/** Edits one of the acting login's own messages. */
export async function editMessage(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const discussion = await discussionToActOn(deps, pick, thread?.discussion, acting);
		if (!discussion) {
			return 'cancelled';
		}
		const messages = await messagesOf(deps, pick, discussion, acting);
		if (!messages) {
			return 'failed';
		}
		const mine = messages.filter(message => mayEditMessage(message, acting.handle));
		if (mine.length === 0) {
			deps.ui.notify('info', `None of the messages in this discussion is ${acting.handle}'s, so there is nothing to edit.`);
			return 'cancelled';
		}
		const message = mine.length === 1 ? mine[0] : await deps.ui.pickMessage(mine);
		if (!message) {
			return 'cancelled';
		}
		const label = discussionLabel(discussion);
		const body = await deps.ui.input({ title: 'Edit your message', prompt: label, value: message.body ?? '', validate: REQUIRED });
		if (body === undefined) {
			return 'cancelled';
		}
		if (body.trim() === (message.body ?? '').trim()) {
			deps.ui.notify('info', 'The text is the same, so nothing was sent.');
			return 'cancelled';
		}
		return perform(deps, acting, {
			action: { kind: 'edit-message', target: label },
			subject: { past: `edited a message in the discussion '${label}'`, ask: `edit a message in the discussion '${label}'` },
			progress: `Writing as ${acting.handle}…`,
			run: () => deps.discussions.write(pick.selector, { kind: 'edit', id: discussion.id, messageId: message.id, body: body.trim() }, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Deletes a message, after a question that says it cannot be undone. */
export async function deleteMessage(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const discussion = await discussionToActOn(deps, pick, thread?.discussion, acting);
		if (!discussion) {
			return 'cancelled';
		}
		const messages = await messagesOf(deps, pick, discussion, acting);
		if (!messages) {
			return 'failed';
		}
		if (messages.length === 0) {
			deps.ui.notify('info', 'This discussion holds no messages.');
			return 'cancelled';
		}
		const message = messages.length === 1 ? messages[0] : await deps.ui.pickMessage(messages);
		if (!message) {
			return 'cancelled';
		}
		const label = discussionLabel(discussion);
		const name = describeChange(pick.change);
		return perform(deps, acting, {
			action: { kind: 'delete-message', discussion: label, change: name },
			subject: { past: `deleted a message from the discussion '${label}'`, ask: `delete a message from the discussion '${label}'` },
			progress: `Deleting as ${acting.handle}…`,
			run: () => deps.discussions.write(pick.selector, { kind: 'delete', id: discussion.id, messageId: message.id }, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Resolves a discussion or reopens it. */
export async function setDiscussionResolved(deps: TrailDepthDependencies, resolved: boolean, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const discussion = await discussionToActOn(deps, pick, thread?.discussion, acting);
		if (!discussion) {
			return 'cancelled';
		}
		const label = discussionLabel(discussion);
		return perform(deps, acting, {
			action: { kind: resolved ? 'resolve-discussion' : 'reopen-discussion', target: label },
			subject: resolved
				? { past: `resolved the discussion '${label}'`, ask: `resolve the discussion '${label}'` }
				: { past: `reopened the discussion '${label}'`, ask: `reopen the discussion '${label}'` },
			progress: `Working as ${acting.handle}…`,
			run: () => deps.discussions.write(pick.selector, { kind: resolved ? 'resolve' : 'unresolve', id: discussion.id }, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Opens a discussion and its messages in a read-only document. */
export async function showDiscussion(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const discussion = await discussionToActOn(deps, pick, thread?.discussion, acting);
		if (!discussion) {
			return 'cancelled';
		}
		const view = await deps.discussions.show(pick.selector, discussion.id, acting.name);
		if (view.kind === 'failed') {
			deps.ui.notify('error', `Entirely could not read the discussion: ${describeDepthFailure(view.detail, view.detail, { login: acting.handle })}`);
			return 'failed';
		}
		if (view.value.messages === undefined) {
			deps.ui.notify(
				'warn',
				'The CLI answered in a form this version of Entirely does not read. Copy the command to read the discussion in a terminal.',
				await deps.discussions.commandLine(pick.selector, discussion.id),
			);
			return 'failed';
		}
		await deps.ui.show('trail-discussion', discussionLabel(discussion), discussionMarkdown(describeChange(pick.change), discussion.title, view.value));
		return 'done';
	});
}

/** Resolves, dismisses or reopens a finding, with an optional reason. Dismissing a high-severity finding asks first. */
export async function setFindingStatus(deps: TrailDepthDependencies, change: FindingLifecycle, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const finding = await findingToActOn(deps, pick, thread?.finding, acting);
		if (!finding) {
			return 'cancelled';
		}
		const label = findingLabel(finding);
		const reason = await deps.ui.input({ title: `${change === 'resolve' ? 'Resolve' : change === 'dismiss' ? 'Dismiss' : 'Reopen'} the finding`, prompt: 'A reason (optional; leave empty for none).' });
		if (reason === undefined) {
			return 'cancelled';
		}
		const words = { resolve: ['resolved', 'resolve'], dismiss: ['dismissed', 'dismiss'], reopen: ['reopened', 'reopen'] } as const;
		const action: DepthAction =
			change === 'dismiss'
				? { kind: 'dismiss-finding', finding: label, severity: finding.severity }
				: { kind: change === 'resolve' ? 'resolve-finding' : 'reopen-finding', target: label };
		return perform(deps, acting, {
			action,
			subject: { past: `${words[change][0]} the finding '${label}'`, ask: `${words[change][1]} the finding '${label}'` },
			progress: `Working as ${acting.handle}…`,
			run: () => deps.findings.setStatus(pick.selector, finding.id, change, reason.trim().length > 0 ? reason.trim() : undefined, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Changes a finding's body, severity or confidence. */
export async function updateFinding(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const options = await deps.findings.updateOptions();
		if (!options.ok) {
			deps.ui.notify('error', `Entirely cannot update a finding: ${options.detail}`);
			return 'unavailable';
		}
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const finding = await findingToActOn(deps, pick, thread?.finding, acting);
		if (!finding) {
			return 'cancelled';
		}
		const labels = { body: 'Body', severity: 'Severity', confidence: 'Confidence' } as const;
		const field = await deps.ui.choice(`Update '${findingLabel(finding)}'`, options.fields.map(item => ({ label: labels[item], value: item })));
		if (field === undefined) {
			return 'cancelled';
		}
		let fields: { body?: string; severity?: string; confidence?: number };
		if (field === 'body') {
			const value = await deps.ui.input({ title: 'Update the finding', prompt: 'The finding body.', value: finding.body ?? '', validate: REQUIRED });
			if (value === undefined) {
				return 'cancelled';
			}
			fields = { body: value.trim() };
		} else if (field === 'severity') {
			const value =
				options.severities.length > 0
					? await deps.ui.choice<string>('Set the severity', options.severities.map(item => ({ label: item, value: item })))
					: await deps.ui.input({ title: 'Set the severity', prompt: 'The severity.', validate: REQUIRED });
			if (value === undefined) {
				return 'cancelled';
			}
			fields = { severity: value.trim() };
		} else {
			const value = await deps.ui.input({
				title: 'Set the confidence',
				prompt: 'A number from 0.0 to 1.0.',
				validate: text => {
					const number = Number(text);
					return text.trim().length > 0 && Number.isFinite(number) && number >= 0 && number <= 1 ? undefined : 'Write a number from 0.0 to 1.0.';
				},
			});
			if (value === undefined) {
				return 'cancelled';
			}
			fields = { confidence: Number(value) };
		}
		const label = findingLabel(finding);
		return perform(deps, acting, {
			action: { kind: 'update-finding', target: label },
			subject: { past: `updated the finding '${label}'`, ask: `update the finding '${label}'` },
			progress: `Working as ${acting.handle}…`,
			run: () => deps.findings.update(pick.selector, finding.id, fields, acting),
			after: () => deps.threadsChanged(keyOf(pick)),
		});
	});
}

/** Opens the CLI's text for a finding in a read-only document. */
export async function showFinding(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const finding = await findingToActOn(deps, pick, thread?.finding, acting);
		if (!finding) {
			return 'cancelled';
		}
		const text = await deps.findings.show(pick.selector, finding.id, acting);
		if (text.kind === 'failed') {
			deps.ui.notify('error', `Entirely could not read the finding: ${text.detail}`);
			return 'failed';
		}
		await deps.ui.show('trail-finding', findingLabel(finding), text.value);
		return 'done';
	});
}

/**
 * Applies a finding's suggested change to the working tree.
 *
 * Unsaved work in the editor refuses the apply and the CLI is not run.
 * The CLI's check runs first, and a patch that does not apply leaves the
 * tree alone and shows the CLI's reason. Only then is the question asked,
 * and the apply runs once as the confirmed login.
 */
export async function applyFinding(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	return guarded(deps, async () => {
		const { ui } = deps;
		const thread = threadTargetOf(target);
		const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
		if (!pick || pick.kind !== 'change') {
			return 'cancelled';
		}
		const unsaved = ui.unsavedFiles();
		if (unsaved.length > 0) {
			ui.notify('error', describeApplyRefusal(unsaved));
			return 'failed';
		}
		const acting = await signedIn(deps);
		if (!acting) {
			return 'no-login';
		}
		const finding = await findingToActOn(deps, pick, thread?.finding, acting);
		if (!finding) {
			return 'cancelled';
		}
		const label = findingLabel(finding);

		const checked = await ui.withProgress('Checking that the suggestion applies…', () => deps.findings.check(pick.selector, finding.id, acting));
		if (checked.kind === 'refused') {
			ui.notify('error', `The suggestion for '${label}' was not applied and your files are untouched: ${checked.detail}`);
			return 'failed';
		}

		const question = confirmTrailDepth({ kind: 'apply-finding', finding: label, folder: deps.folderName() }, acting);
		const answer = question ? await ui.confirm(question) : undefined;
		if (answer === undefined) {
			return 'cancelled';
		}
		const resolve = answer === 'alternative';
		const outcome = await ui.withProgress(`Applying as ${acting.handle}…`, () => deps.findings.apply(pick.selector, finding.id, { resolve }, acting));
		deps.threadsChanged(keyOf(pick));
		if (outcome.kind === 'failed') {
			ui.notify('error', `Entirely could not apply the suggestion for '${label}': ${outcome.detail}`);
			return 'failed';
		}
		const applied = 'The CLI reported the suggestion applied. Review it in Source Control.';
		if (!resolve || !outcome.resolved) {
			ui.notify('info', applied);
			return 'done';
		}
		ui.notify(outcome.resolved.kind === 'done' ? 'info' : 'warn', `${applied} ${describeDepthOutcome({ past: `resolved the finding '${label}'`, ask: `resolve the finding '${label}'` }, outcome.resolved, acting)}`);
		return outcome.resolved.kind === 'done' ? 'done' : 'unconfirmed';
	});
}

/** Starts following a change's events. */
export async function watchChange(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	const thread = threadTargetOf(target);
	const pick = await changeToActOn(deps, thread?.pick ?? pickFromTarget(target));
	if (!pick || pick.kind !== 'change') {
		return 'cancelled';
	}
	const started = await deps.watch.start(pick.selector);
	const name = describeChange(pick.change);
	switch (started.kind) {
		case 'started':
			return 'done';
		case 'already':
			deps.ui.notify('info', `Entirely is already watching ${name}.`);
			return 'cancelled';
		case 'limit':
			deps.ui.notify('warn', `Entirely already watches ${started.limit} ${started.limit === 1 ? 'change' : 'changes'}. Stop another watch first, or raise entirely.trailWatchLimit.`);
			return 'failed';
		case 'unavailable':
			deps.ui.notify('error', `Entirely cannot watch ${name}: ${started.detail}`);
			return 'unavailable';
	}
}

/** Stops following a change. */
export async function stopWatching(deps: TrailDepthDependencies, target?: unknown): Promise<DepthResult> {
	const thread = threadTargetOf(target);
	const given = thread?.pick ?? pickFromTarget(target);
	if (given?.kind === 'change') {
		return deps.watch.stop(watchKey(given.selector)) ? 'done' : 'cancelled';
	}
	const keys = deps.watch.keys();
	if (keys.length === 0) {
		deps.ui.notify('info', 'Entirely is not watching any change.');
		return 'cancelled';
	}
	const key = await deps.ui.choice('Stop watching', keys.map(item => ({ label: item, value: item })));
	return key !== undefined && deps.watch.stop(key) ? 'done' : 'cancelled';
}

/** Stops every watch. */
export function stopAllWatches(deps: TrailDepthDependencies): DepthResult {
	if (deps.watch.count === 0) {
		deps.ui.notify('info', 'Entirely is not watching any change.');
		return 'cancelled';
	}
	deps.watch.stopAll();
	return 'done';
}
