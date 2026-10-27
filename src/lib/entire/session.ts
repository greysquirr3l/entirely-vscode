import {
	decodeArray,
	decodeRecord,
	fields,
	optionalNumber,
	optionalString,
	optionalTimestamp,
	requireString,
	type DecodeResult,
} from './decode';
import type { Session } from './types';

/** Decodes one session as the CLI reports it. */
export function decodeSession(value: unknown, path = 'session'): DecodeResult<Session> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'session_id');
	if (!id.ok) {
		return id;
	}

	const agent = requireString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const status = requireString(read, 'status');
	if (!status.ok) {
		return status;
	}

	const worktreePath = requireString(read, 'worktree_path');
	if (!worktreePath.ok) {
		return worktreePath;
	}

	const branch = optionalString(read, 'branch');
	if (!branch.ok) {
		return branch;
	}

	const startedAt = optionalTimestamp(read, 'started_at');
	if (!startedAt.ok) {
		return startedAt;
	}

	const lastActive = optionalTimestamp(read, 'last_active');
	if (!lastActive.ok) {
		return lastActive;
	}

	const turns = optionalNumber(read, 'turns');
	if (!turns.ok) {
		return turns;
	}

	const pendingTurns = optionalNumber(read, 'pending_turns');
	if (!pendingTurns.ok) {
		return pendingTurns;
	}

	const checkpoints = optionalNumber(read, 'checkpoints');
	if (!checkpoints.ok) {
		return checkpoints;
	}

	const lastPrompt = optionalString(read, 'last_prompt');
	if (!lastPrompt.ok) {
		return lastPrompt;
	}

	// The model is an opaque string. It is recorded exactly as the CLI
	// recorded it, with no filtering and no validation.
	const model = optionalString(read, 'model');
	if (!model.ok) {
		return model;
	}

	const resolution = optionalString(read, 'resolution');
	if (!resolution.ok) {
		return resolution;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			agent: agent.value,
			status: status.value,
			worktreePath: worktreePath.value,
			branch: branch.value,
			startedAt: startedAt.value,
			lastActive: lastActive.value,
			turns: turns.value,
			pendingTurns: pendingTurns.value,
			checkpoints: checkpoints.value,
			lastPrompt: lastPrompt.value,
			model: model.value,
			resolution: resolution.value,
		},
	};
}

/**
 * Decodes the payload of `entire session list --json`.
 *
 * The CLI returns an array, and an empty array is a valid answer: a
 * repository with no sessions is not an error.
 */
export function decodeSessionList(value: unknown): DecodeResult<readonly Session[]> {
	const array = decodeArray(value, 'sessions');
	if (!array.ok) {
		return array;
	}

	const sessions: Session[] = [];
	for (let index = 0; index < array.value.length; index++) {
		const session = decodeSession(array.value[index], `sessions[${index}]`);
		if (!session.ok) {
			return session;
		}
		sessions.push(session.value);
	}

	return { ok: true, value: sessions };
}

/**
 * Decodes the payload of `entire session current --json`.
 *
 * The command reports no session as null, which is an answer rather than a
 * failure, so it decodes to undefined.
 */
export function decodeCurrentSession(value: unknown): DecodeResult<Session | undefined> {
	if (value === null || value === undefined) {
		return { ok: true, value: undefined };
	}
	return decodeSession(value, 'session');
}
