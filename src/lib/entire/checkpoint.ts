import {
	decodeArray,
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalRaw,
	optionalString,
	optionalStringArray,
	optionalTimestamp,
	requireString,
	type DecodeResult,
} from './decode';
import type { Checkpoint, CheckpointDetail, CheckpointSession } from './types';

/**
 * The two shapes the CLI gives a checkpoint id.
 *
 * The CLI says so itself: *"invalid checkpoint ID %q: must be 12 lowercase
 * hex characters or a 26-character ULID"*. The two are read out of the
 * installed CLI rather than guessed at, and this is the reading of that
 * sentence.
 */
const HEX_ID = /^[0-9a-f]{12}$/;

/**
 * A ULID, as the CLI writes one.
 *
 * A ULID is 26 characters of Crockford base32 — the digits and the
 * letters, without `I`, `L`, `O` or `U` — and the first character
 * carries the top of a 48-bit timestamp, so it can only be a digit up to
 * `7`. The CLI checks exactly this.
 */
const ULID_ID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Whether this is a checkpoint id the CLI would recognise.
 *
 * The id is the CLI's to mint, and the extension never mints one of its
 * own. A value that does not have the CLI's shape did not come from a
 * checkpoint, and a ref must not be built from it.
 */
export function isCheckpointId(id: string): boolean {
	return HEX_ID.test(id) || ULID_ID.test(id);
}

/**
 * The git ref that holds a checkpoint.
 *
 * The CLI keeps one ref per checkpoint under a namespace of its own, and
 * shards them by the last two characters of the id so the refs spread evenly
 * across directories rather than piling into one.
 *
 * The extension has to know where the forge keeps things — it is a client
 * of that forge, not a bystander — so the rule lives here, in one place.
 *
 * Returns undefined for an id the CLI would not recognise. The id came
 * from the CLI, so this is a check on the extension's own reading of the
 * CLI's shape rather than a defence against a hostile forge — but a ref
 * built from a value that is not a checkpoint id would point at
 * something other than the checkpoint, and git's own refusal of `..` in
 * a ref is not a check the extension should be relying on.
 */
export function checkpointRef(id: string): string | undefined {
	if (!isCheckpointId(id)) {
		return undefined;
	}

	const shard = id.slice(-2);
	return `refs/entire/checkpoints/${shard}/${id}`;
}

/** Decodes one checkpoint as the CLI lists it. */
export function decodeCheckpoint(value: unknown, path = 'checkpoint'): DecodeResult<Checkpoint> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'checkpoint_id');
	if (!id.ok) {
		return id;
	}

	const message = optionalString(read, 'message');
	if (!message.ok) {
		return message;
	}

	const agent = optionalString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const date = optionalTimestamp(read, 'date');
	if (!date.ok) {
		return date;
	}

	const sessionId = optionalString(read, 'session_id');
	if (!sessionId.ok) {
		return sessionId;
	}

	const sessionIds = optionalStringArray(read, 'session_ids');
	if (!sessionIds.ok) {
		return sessionIds;
	}

	const sessionCount = optionalNumber(read, 'session_count');
	if (!sessionCount.ok) {
		return sessionCount;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			message: message.value,
			agent: agent.value,
			date: date.value,
			sessionId: sessionId.value,
			sessionIds: sessionIds.value ?? [],
			sessionCount: sessionCount.value ?? sessionIds.value?.length ?? 0,
			isTaskCheckpoint: optionalBoolean(read, 'is_task_checkpoint') ?? false,
			isLogsOnly: optionalBoolean(read, 'is_logs_only') ?? false,
			imported: false,
		},
	};
}

/** Decodes the list of checkpoints the CLI reports. */
export function decodeCheckpointList(
	value: unknown,
	path = 'checkpoints',
): DecodeResult<readonly Checkpoint[]> {
	const array = decodeArray(value, path);
	if (!array.ok) {
		return array;
	}

	const checkpoints: Checkpoint[] = [];

	for (let index = 0; index < array.value.length; index++) {
		const decoded = decodeCheckpoint(array.value[index], `${path}[${index}]`);
		if (!decoded.ok) {
			return decoded;
		}
		checkpoints.push(decoded.value);
	}

	return { ok: true, value: checkpoints };
}

/** Decodes one session inside a checkpoint's envelope. */
function decodeCheckpointSession(
	value: unknown,
	path: string,
): DecodeResult<CheckpointSession> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const sessionId = optionalString(read, 'session_id');
	if (!sessionId.ok) {
		return sessionId;
	}

	const agent = optionalString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const filesTouched = optionalStringArray(read, 'files_touched');
	if (!filesTouched.ok) {
		return filesTouched;
	}

	const createdAt = optionalTimestamp(read, 'created_at');
	if (!createdAt.ok) {
		return createdAt;
	}

	const model = optionalString(read, 'model');
	if (!model.ok) {
		return model;
	}

	const kind = optionalString(read, 'kind');
	if (!kind.ok) {
		return kind;
	}

	const index = optionalNumber(read, 'index');
	if (!index.ok) {
		return index;
	}

	return {
		ok: true,
		value: {
			index: index.value ?? 0,
			sessionId: sessionId.value,
			agent: agent.value,
			model: model.value,
			kind: kind.value,
			createdAt: createdAt.value,
			filesTouched: filesTouched.value ?? [],
		},
	};
}

/** Decodes the envelope the CLI reports for a single checkpoint. */
export function decodeCheckpointDetail(
	value: unknown,
	path = 'checkpoint',
): DecodeResult<CheckpointDetail> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'checkpoint_id');
	if (!id.ok) {
		return id;
	}

	const filesTouched = optionalStringArray(read, 'files_touched');
	if (!filesTouched.ok) {
		return filesTouched;
	}

	const sessions = decodeArray(optionalRaw(read, 'sessions') ?? [], `${path}.sessions`);
	if (!sessions.ok) {
		return sessions;
	}

	const decodedSessions: CheckpointSession[] = [];
	for (let index = 0; index < sessions.value.length; index++) {
		const decoded = decodeCheckpointSession(sessions.value[index], `${path}.sessions[${index}]`);
		if (!decoded.ok) {
			return decoded;
		}
		decodedSessions.push(decoded.value);
	}

	const sessionCount = optionalNumber(read, 'session_count');
	if (!sessionCount.ok) {
		return sessionCount;
	}

	const strategy = optionalString(read, 'strategy');
	if (!strategy.ok) {
		return strategy;
	}

	const branch = optionalString(read, 'branch');
	if (!branch.ok) {
		return branch;
	}

	const tasksError = optionalString(read, 'tasks_error');
	if (!tasksError.ok) {
		return tasksError;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			strategy: strategy.value,
			branch: branch.value,
			filesTouched: filesTouched.value ?? [],
			sessionCount: sessionCount.value ?? decodedSessions.length,
			sessions: decodedSessions,
			partial: optionalBoolean(read, 'partial') ?? false,
			tasksError: tasksError.value,
		},
	};
}
