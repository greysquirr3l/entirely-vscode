import {
	decodeRecord,
	fields,
	optionalNumber,
	optionalString,
	optionalStringArray,
	optionalTimestamp,
	type DecodeResult,
} from './decode';
import { decodeSession } from './session';
import type { Session, Timestamp } from './types';

/**
 * A session as `entire session info --json` reports it.
 *
 * The list payload carries the same core fields, so this is a session with
 * the parts only the detail command knows. The CLI says the payload holds no
 * transcript bytes: the transcript is a separate, explicit request.
 *
 * The `tokens` block is deliberately not decoded: `session info` sends all
 * zeros for a session with no recorded usage. Usage comes from `session tokens`.
 */
export interface SessionInfo extends Session {
	/** When the session ended. Absent for a session still running. */
	readonly endedAt?: Timestamp;
	/** The newest checkpoint made from the session. */
	readonly lastCheckpointId?: string;
	/** The files the session touched, when the CLI lists them. */
	readonly filesTouched?: readonly string[];
}

/** Decodes the payload of `entire session info <id> --json`. */
export function decodeSessionInfo(value: unknown): DecodeResult<SessionInfo> {
	const session = decodeSession(value, 'session');
	if (!session.ok) {
		return session;
	}

	// decodeSession has already proved the payload is an object.
	const record = decodeRecord(value, 'session');
	if (!record.ok) {
		return record;
	}
	const read = fields(record.value, 'session');

	const endedAt = optionalTimestamp(read, 'ended_at');
	if (!endedAt.ok) {
		return endedAt;
	}

	const lastCheckpointId = optionalString(read, 'last_checkpoint_id');
	if (!lastCheckpointId.ok) {
		return lastCheckpointId;
	}

	const filesTouched = optionalStringArray(read, 'files_touched');
	if (!filesTouched.ok) {
		return filesTouched;
	}

	return {
		ok: true,
		value: {
			...session.value,
			endedAt: endedAt.value,
			lastCheckpointId: lastCheckpointId.value,
			filesTouched: filesTouched.value,
		},
	};
}

/** A session id is passed to the CLI as an operand, so its shape is checked first. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether a string can safely be handed to the CLI as a session id. */
export function isSessionId(value: string): boolean {
	return SESSION_ID.test(value);
}
