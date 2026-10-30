import {
	buildChangeDetail,
	buildTrailDetail,
	countToolCalls,
	describeGone,
	initialDetail,
	isGoneFailure,
	unavailableRow,
	withRow,
	buildSessionDetail,
	type DetailModel,
	type Selection,
	type SessionSnapshot,
	type TrailSelector,
} from '../lib/entire';
import type { LoadOutcome, SelectionLoader } from './selection';
import type { SessionDetailSource } from './sessionDetail';
import type { TokenUsageSource } from './tokenUsage';
import type { TrailCapability, TrailDetail, TrailResult } from './trailService';

/** The trail reads the viewer needs. */
export interface TrailReader {
	showCapability(): Promise<TrailCapability>;
	show(selector: TrailSelector): Promise<TrailResult<TrailDetail>>;
}

export interface SelectionLoaderDependencies {
	readonly detail: SessionDetailSource;
	readonly usage: TokenUsageSource;
	readonly trails: TrailReader;
}

type Chosen<K extends Selection['kind']> = Extract<Selection, { kind: K }>;

/** Whether `session info` says the session is not there, in the words the CLI or the id check use. */
function sessionIsGone(detail: string): boolean {
	return /not found|no such session|does not exist/i.test(detail);
}

/**
 * Reads a session in the steps it always was: the record, the token usage,
 * then the tool calls from the transcript. Each step shows as it arrives.
 * The transcript itself is never kept, only its counts.
 */
async function loadSession(
	deps: SelectionLoaderDependencies,
	selection: Chosen<'session'>,
	progress: (model: DetailModel) => void,
): Promise<LoadOutcome> {
	const id = selection.session.id;
	let snapshot: SessionSnapshot = { session: selection.session };
	const show = (next: SessionSnapshot): void => {
		snapshot = next;
		progress(buildSessionDetail(selection, snapshot));
	};

	show({ ...snapshot, usage: { kind: 'loading' } });
	const usage = deps.usage.session(id);
	const found = await deps.detail.info(id);
	if (found.kind === 'failed') {
		if (sessionIsGone(found.detail)) {
			return { kind: 'gone', reason: describeGone(buildSessionDetail(selection).title) };
		}
		show({ ...snapshot, infoFailure: found.detail });
	} else {
		show({ ...snapshot, session: found.info, info: found.info, infoFailure: undefined });
	}

	const read = await usage;
	show({
		...snapshot,
		usage: read.kind === 'found' ? { kind: 'ready', report: read.report } : { kind: 'failed', detail: read.detail },
	});
	if (found.kind === 'failed') {
		return { kind: 'ready', model: buildSessionDetail(selection, snapshot) };
	}

	show({ ...snapshot, toolCalls: { kind: 'loading' } });
	const transcript = await deps.detail.transcript(found.info);
	show({
		...snapshot,
		toolCalls:
			transcript.kind === 'failed'
				? { kind: 'failed', detail: transcript.detail }
				: {
						kind: 'ready',
						counts: countToolCalls(transcript.loaded.transcript.items),
						truncated: transcript.loaded.truncated,
					},
	});
	return { kind: 'ready', model: buildSessionDetail(selection, snapshot) };
}

/** The words for a CLI that cannot run `trail show`. */
function describeUnavailable(capability: Extract<TrailCapability, { kind: 'unavailable' }>): string {
	switch (capability.reason) {
		case 'absent':
		case 'broken':
		case 'spawn-failed':
			return `The Entire CLI is not available: ${capability.detail}`;
		case 'exit-code':
			return 'This Entire CLI does not have `trail show`.';
		default:
			return capability.detail;
	}
}

/**
 * Reads a trail or a change with the one `trail show`.
 *
 * The row paints from the listing, so a CLI that cannot show a trail still
 * leaves the listing's fields and one row saying why the rest is missing.
 * The change's gate is the listing's: the merge check is not run again.
 */
async function loadTrail(
	trails: TrailReader,
	selection: Chosen<'trail'> | Chosen<'change'>,
): Promise<LoadOutcome> {
	const listed = initialDetail(selection);

	const capability = await trails.showCapability();
	if (capability.kind === 'unavailable') {
		// A timeout or a cancel says nothing about the CLI, so only the
		// reasons that do are treated as the CLI lacking the command.
		if (capability.reason === 'timeout' || capability.reason === 'cancelled') {
			return { kind: 'failed', reason: capability.detail };
		}
		return {
			kind: 'ready',
			model: withRow(listed, unavailableRow(describeUnavailable(capability))),
			cache: false,
		};
	}

	const selector: TrailSelector =
		selection.kind === 'change'
			? { kind: 'change', repository: selection.entry.change.repository, number: selection.entry.change.number }
			: { kind: 'trail', number: selection.entry.trail.number };

	const shown = await trails.show(selector);
	if (shown.kind === 'failed') {
		return isGoneFailure(shown.detail)
			? { kind: 'gone', reason: describeGone(listed.title) }
			: { kind: 'failed', reason: shown.detail };
	}

	const trail = shown.value.trail;
	if (selection.kind === 'change') {
		const { change } = selection.entry;
		const listedHere = trail.changes.some(
			other => other.id === change.id || (other.repository === change.repository && other.number === change.number),
		);
		// An answer that lists no changes may simply not carry them, so only
		// a list that names others and leaves this one out says it is gone.
		if (trail.changes.length > 0 && !trail.partial && !listedHere) {
			return { kind: 'gone', reason: describeGone(listed.title) };
		}
		return { kind: 'ready', model: buildChangeDetail(selection, { trail }) };
	}
	return { kind: 'ready', model: buildTrailDetail(selection, { trail }) };
}

/**
 * The reader behind the Details viewer.
 *
 * A session is read in its three steps, a trail or a change with one
 * `trail show`, and an Activity row from the text already in memory: it
 * starts no CLI command at all.
 */
export function createSelectionLoader(deps: SelectionLoaderDependencies): SelectionLoader {
	return async (selection, progress) => {
		switch (selection.kind) {
			case 'session':
				return loadSession(deps, selection, progress);
			case 'trail':
			case 'change':
				return loadTrail(deps.trails, selection);
			case 'commit':
			case 'activity-session':
			case 'repository':
				return { kind: 'ready', model: initialDetail(selection) };
		}
	};
}
