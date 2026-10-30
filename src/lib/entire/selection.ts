import type { ActivityEntry, ActivityRepository, ActivityStat } from './activityOutput';
import { sessionRows, type DetailRow, type SessionSnapshot } from './sessionDetailRows';
import { describeGate, type GatedChange, type GatedTrail } from './trailGate';
import type { Trail, TrailChange, TrailGate } from './trail';
import type { TrailPick } from './trailPick';
import { pluralise, truncatePrompt } from './text';
import type { Session } from './types';

/** Which view a selection was made in. The Explorer's copy of Sessions counts as Sessions. */
export type SelectionSource = 'sessions' | 'trails' | 'activity' | 'command';

/**
 * Something the user can select and see in the Details viewer.
 *
 * A selection is plain data, so it can be the argument of a tree item's
 * command, and it carries everything the row knew when it was drawn.
 */
export type Selection =
	| { readonly kind: 'session'; readonly session: Session }
	| { readonly kind: 'trail'; readonly entry: GatedTrail }
	| { readonly kind: 'change'; readonly trail: Trail; readonly entry: GatedChange }
	| { readonly kind: 'commit'; readonly entry: ActivityEntry }
	| { readonly kind: 'activity-session'; readonly entry: ActivityEntry }
	| {
			readonly kind: 'repository';
			readonly repository: ActivityRepository;
			readonly scope: string;
			readonly stats: readonly ActivityStat[];
	  };

/** What the viewer shows for one selection. */
export interface DetailModel {
	readonly key: string;
	readonly kind: Selection['kind'];
	/** The short name, as shown in the viewer's description. */
	readonly title: string;
	/** The first row, naming the item. Sessions have none: their rows start with the agent. */
	readonly heading?: string;
	readonly rows: readonly DetailRow[];
	/** Text that is only ever shown in a generated document, never in a row or the log. */
	readonly body?: string;
	/** What the review actions in the viewer act on. */
	readonly pick?: TrailPick;
	readonly session?: SessionSnapshot;
}

/** What the viewer is showing. */
export type ViewerState =
	| { readonly kind: 'empty' }
	/** Something was chosen that is not an item the viewer can show, and this says so. */
	| { readonly kind: 'notice'; readonly message: string }
	| { readonly kind: 'loading'; readonly selection: Selection; readonly model: DetailModel }
	| {
			readonly kind: 'ready';
			readonly selection: Selection;
			readonly model: DetailModel;
			/** When the content was read, if it is being shown from the cache. */
			readonly asOf?: number;
			/** The content is shown while a newer copy is read. */
			readonly refreshing?: boolean;
			/** Why the newer copy could not be read. The content shown is the older one. */
			readonly refreshFailure?: string;
	  }
	| {
			readonly kind: 'failed';
			readonly selection: Selection;
			readonly model: DetailModel;
			readonly reason: string;
	  }
	| {
			readonly kind: 'gone';
			readonly selection: Selection;
			readonly model: DetailModel;
			readonly reason: string;
	  };

/** What a trail read supplies beyond the listing row. */
export interface ShownTrail {
	readonly trail: Trail;
}

/** The key a selection is cached and de-duplicated under. */
export function selectionKey(selection: Selection): string {
	switch (selection.kind) {
		case 'session':
			return `session:${selection.session.id}`;
		case 'trail':
			return `trail:${selection.entry.trail.number}`;
		case 'change':
			return `change:${selection.entry.change.repository}/${selection.entry.change.number}`;
		case 'commit':
			return `commit:${selection.entry.id ?? selection.entry.text}@${selection.entry.repo ?? ''}`;
		case 'activity-session':
			return `activity:${selection.entry.text}`;
		case 'repository':
			return `repo:${selection.repository.name}`;
	}
}

/** Which view a key's row lives in. */
export function viewOfKey(key: string): 'sessions' | 'trails' | 'activity' {
	if (key.startsWith('session:')) {
		return 'sessions';
	}
	return key.startsWith('trail:') || key.startsWith('change:') ? 'trails' : 'activity';
}

const LONGEST_TITLE = 60;

function shortened(text: string): string {
	return truncatePrompt(text, LONGEST_TITLE);
}

/** The name of the selected item, for the viewer's description. */
export function detailTitle(selection: Selection): string {
	switch (selection.kind) {
		case 'session': {
			const { agent, lastPrompt } = selection.session;
			return lastPrompt ? `${agent} — ${truncatePrompt(lastPrompt)}` : agent;
		}
		case 'trail':
			return `#${selection.entry.trail.number} ${selection.entry.trail.title ?? 'Untitled trail'}`;
		case 'change':
			return `${selection.entry.change.repository}/${selection.entry.change.number}`;
		case 'commit': {
			const { id, title, text } = selection.entry;
			return id ? `${id} ${shortened(title ?? '')}`.trim() : shortened(text);
		}
		case 'activity-session':
			return shortened(selection.entry.text);
		case 'repository':
			return selection.repository.name;
	}
}

/** The words for a state, shown as a row or at the top of the generated document. */
export function describeViewerNote(state: ViewerState): string | undefined {
	switch (state.kind) {
		case 'empty':
			return undefined;
		case 'notice':
			return state.message;
		case 'loading':
			return `Loading ${state.model.title}…`;
		case 'failed':
			return `Could not load ${state.model.title}: ${state.reason}`;
		case 'gone':
			return state.reason;
		case 'ready':
			return state.refreshFailure ? `Could not refresh: ${state.refreshFailure}` : undefined;
	}
}

/** The words for an item the CLI says is gone. */
export function describeGone(title: string): string {
	return `${title} is no longer available. It may have been merged or deleted.`;
}

/**
 * Whether the CLI's reason says the trail or change is not there.
 *
 * A project the login cannot see also says "not found", and that is a
 * question of access, not of the item having gone.
 */
export function isGoneFailure(reason: string): boolean {
	if (/project (is )?not (found|accessible)/i.test(reason)) {
		return false;
	}
	return /\b(trail|change)\b[^\n]*\bnot found\b|\bno (such )?(trail|change)\b|does not exist|\b404\b/i.test(reason);
}

const LONG_LIVED: readonly Selection['kind'][] = ['commit', 'activity-session', 'repository'];

/**
 * How long a loaded detail is kept, in seconds.
 *
 * What cannot change is kept ten times as long: an Activity row is
 * rendered from text already in memory, and an ended session's record no
 * longer moves. A lifetime of zero keeps nothing.
 */
export function lifetimeSeconds(model: DetailModel, selection: Selection, base: number): number {
	if (base <= 0) {
		return 0;
	}
	if (LONG_LIVED.includes(selection.kind)) {
		return base * 10;
	}
	if (selection.kind === 'session') {
		const status = model.session?.info?.status ?? model.session?.session.status ?? selection.session.status;
		return status === 'ended' ? base * 10 : base;
	}
	return base;
}

/** Whether something loaded at `loadedAt` can still be shown without reading it again. */
export function isFresh(loadedAt: number, now: number, ttlSeconds: number): boolean {
	return ttlSeconds > 0 && now - loadedAt < ttlSeconds * 1000;
}

/** The time of day, as `HH:MM:SS`. */
export function formatClock(milliseconds: number): string {
	const at = new Date(milliseconds);
	const two = (value: number): string => String(value).padStart(2, '0');
	return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a command argument is a selection.
 *
 * Commands can be run by anything, so the argument is checked before it
 * is trusted.
 */
export function isSelection(value: unknown): value is Selection {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return false;
	}
	switch (value.kind) {
		case 'session':
			return isRecord(value.session) && typeof value.session.id === 'string' && typeof value.session.agent === 'string';
		case 'trail':
			return isRecord(value.entry) && isRecord(value.entry.trail) && typeof value.entry.trail.number === 'number';
		case 'change':
			return (
				isRecord(value.trail) &&
				isRecord(value.entry) &&
				isRecord(value.entry.change) &&
				typeof value.entry.change.repository === 'string' &&
				typeof value.entry.change.number === 'number'
			);
		case 'commit':
		case 'activity-session':
			return isRecord(value.entry) && typeof value.entry.text === 'string';
		case 'repository':
			return isRecord(value.repository) && typeof value.repository.name === 'string' && Array.isArray(value.stats);
		default:
			return false;
	}
}

/** Whether a source name is one the service knows. */
export function isSelectionSource(value: unknown): value is SelectionSource {
	return value === 'sessions' || value === 'trails' || value === 'activity' || value === 'command';
}

/** The selector of a change, for the commands that take one. */
function changePick(trail: Trail, change: TrailChange): TrailPick {
	return {
		kind: 'change',
		trail,
		change,
		selector: { kind: 'change', repository: change.repository, number: change.number },
	};
}

function gateRows(gate: TrailGate): DetailRow[] {
	if (gate.kind === 'unknown') {
		return [{ label: 'Gate', value: describeGate(gate), tooltip: gate.detail }];
	}
	const rows: DetailRow[] = [
		{ label: 'Gate', value: describeGate(gate) },
		{ label: 'Approvals', value: pluralise(gate.approvals, 'approval') },
	];
	if (gate.kind !== 'open' && gate.blockers.length > 0) {
		rows.push({ label: 'Blockers', value: pluralise(gate.blockers.length, 'blocker'), lines: gate.blockers });
	}
	return rows;
}

function trailRows(trail: Trail): DetailRow[] {
	const rows: DetailRow[] = [
		{ label: 'Trail', value: `#${trail.number} ${trail.title ?? 'Untitled trail'}` },
		{ label: 'Trail status', value: trail.status },
	];
	if (trail.type) {
		rows.push({ label: 'Type', value: trail.type });
	}
	if (trail.priority) {
		rows.push({ label: 'Priority', value: trail.priority });
	}
	if (trail.url) {
		rows.push({ label: 'Trail page', value: trail.url, link: trail.url });
	}
	if (trail.body && trail.body.trim().length > 0) {
		rows.push({ label: 'Description', value: 'Has a description (open in editor to read it)' });
	}
	return rows;
}

/**
 * What a change shows: the listing row's fields and, once `trail show`
 * has answered, the parent trail's.
 *
 * Nothing here comes from anywhere else. Base branch, head commit,
 * approvers, comment counts and linked items need other reads or are not
 * decoded, so they are not shown.
 */
export function buildChangeDetail(
	selection: Extract<Selection, { kind: 'change' }>,
	shown?: ShownTrail,
): DetailModel {
	const { change, gate } = selection.entry;
	const trail = shown?.trail ?? selection.trail;

	const rows: DetailRow[] = [
		{ label: 'Change', value: `${change.repository}/${change.number}` },
		{ label: 'Branch', value: change.branch },
	];
	if (change.status) {
		rows.push({ label: 'Change status', value: change.status });
	}
	if (change.hasCodeChanges !== undefined) {
		rows.push({ label: 'Code changes', value: change.hasCodeChanges ? 'Yes' : 'No' });
	}
	rows.push(...gateRows(gate));
	if (change.url) {
		rows.push({ label: 'Change page', value: change.url, link: change.url });
	}
	rows.push(...trailRows(trail));

	const siblings = trail.changes.filter(other => other.id !== change.id);
	if (siblings.length > 0) {
		rows.push({
			label: 'Other changes',
			value: pluralise(siblings.length, 'change'),
			lines: siblings.map(other => `${other.repository}/${other.number} · ${other.branch}${other.status ? ` · ${other.status}` : ''}`),
		});
	}

	return {
		key: selectionKey(selection),
		kind: 'change',
		title: detailTitle(selection),
		heading: change.title ?? change.branch,
		rows,
		body: trail.body,
		pick: changePick(trail, change),
	};
}

/** What a project trail shows: its fields and its changes with their gates. */
export function buildTrailDetail(
	selection: Extract<Selection, { kind: 'trail' }>,
	shown?: ShownTrail,
): DetailModel {
	const trail = shown?.trail ?? selection.entry.trail;
	const rows: DetailRow[] = [{ label: 'Trail', value: `#${trail.number}` }, ...trailRows(trail).slice(1)];

	if (selection.entry.changes.length > 0) {
		rows.push({
			label: 'Changes',
			value: pluralise(selection.entry.changes.length, 'change'),
			lines: selection.entry.changes.map(
				({ change, gate }) => `${change.repository}/${change.number} · ${change.branch} · ${describeGate(gate)}`,
			),
		});
	}

	return {
		key: selectionKey(selection),
		kind: 'trail',
		title: detailTitle(selection),
		heading: trail.title ?? 'Untitled trail',
		rows,
		body: trail.body,
		pick: { kind: 'trail', trail, selector: { kind: 'trail', number: trail.number } },
	};
}

/** What a commit line shows: the CLI's own columns, kept whole. */
export function buildCommitDetail(selection: Extract<Selection, { kind: 'commit' }>): DetailModel {
	const { id, title, repo, detail, text } = selection.entry;
	const rows: DetailRow[] = [];
	if (id) {
		rows.push({ label: 'Commit', value: id });
	}
	rows.push({
		label: 'Title',
		value: title && title.length > 0 ? title : text,
		tooltip: 'As the CLI printed it. The activity view may cut a long title short.',
	});
	if (repo) {
		rows.push({ label: 'Repository', value: repo });
	}
	if (detail) {
		rows.push({ label: 'Details', value: detail, tooltip: 'Agent, size and checkpoint count, as the CLI printed them.' });
	}
	return {
		key: selectionKey(selection),
		kind: 'commit',
		title: detailTitle(selection),
		heading: title && title.length > 0 ? title : text,
		rows,
	};
}

/** What a session line in Activity shows: the text, and why there is no more. */
export function buildActivitySessionDetail(
	selection: Extract<Selection, { kind: 'activity-session' }>,
): DetailModel {
	return {
		key: selectionKey(selection),
		kind: 'activity-session',
		title: detailTitle(selection),
		heading: shortened(selection.entry.text),
		rows: [
			{ label: 'Entry', value: selection.entry.text },
			{
				label: 'Session',
				value: 'The CLI’s activity view does not give a session id',
				tooltip: 'Find the session in the Sessions view.',
			},
		],
	};
}

/** What a repository row in Activity shows. */
export function buildRepositoryDetail(selection: Extract<Selection, { kind: 'repository' }>): DetailModel {
	const { repository, scope, stats } = selection;
	const rows: DetailRow[] = [{ label: 'Repository', value: repository.name }];
	if (repository.count !== undefined) {
		rows.push({ label: 'Count', value: String(repository.count), tooltip: 'As the CLI printed it beside the repository.' });
	}
	rows.push({ label: 'Scope', value: scope });
	if (stats.length > 0) {
		rows.push({
			label: 'Overview',
			value: pluralise(stats.length, 'figure'),
			lines: stats.map(stat => `${stat.label.charAt(0)}${stat.label.slice(1).toLowerCase()}: ${stat.value}${stat.caption ? ` (${stat.caption})` : ''}`),
		});
	}
	return {
		key: selectionKey(selection),
		kind: 'repository',
		title: detailTitle(selection),
		heading: repository.name,
		rows,
	};
}

/** What a session shows, as far as it has been read. */
export function buildSessionDetail(selection: Extract<Selection, { kind: 'session' }>, snapshot?: SessionSnapshot): DetailModel {
	const read = snapshot ?? { session: selection.session };
	return {
		key: selectionKey(selection),
		kind: 'session',
		title: detailTitle(selection),
		rows: sessionRows(read),
		session: read,
	};
}

/** What shows the moment a row is selected, before anything is read. */
export function initialDetail(selection: Selection): DetailModel {
	switch (selection.kind) {
		case 'session':
			return buildSessionDetail(selection);
		case 'trail':
			return buildTrailDetail(selection);
		case 'change':
			return buildChangeDetail(selection);
		case 'commit':
			return buildCommitDetail(selection);
		case 'activity-session':
			return buildActivitySessionDetail(selection);
		case 'repository':
			return buildRepositoryDetail(selection);
	}
}

/** The row that says why a trail's own fields could not be read. */
export function unavailableRow(reason: string): DetailRow {
	return {
		label: 'Trail details',
		value: 'Trail details need a newer Entire CLI',
		tooltip: reason,
		command: { command: 'entirely.setUp', arguments: [] },
	};
}

/** The model with one more row, for a note that belongs under the rest. */
export function withRow(model: DetailModel, row: DetailRow): DetailModel {
	return { ...model, rows: [...model.rows, row] };
}
