import {
	decodeRecord,
	fields,
	optionalNumber,
	optionalRaw,
	optionalString,
	optionalStringArray,
	optionalTimestamp,
	type DecodeResult,
} from './decode';
import { decodeSession } from './session';
import type { Session, Timestamp } from './types';

/** The token counts the CLI recorded for a session. Every count is optional. */
export interface SessionTokens {
	readonly total?: number;
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
}

/**
 * A session as `entire session info --json` reports it.
 *
 * The list payload carries the same core fields, so this is a session with
 * the parts only the detail command knows. The CLI says the payload holds no
 * transcript bytes: the transcript is a separate, explicit request.
 */
export interface SessionInfo extends Session {
	/** When the session ended. Absent for a session still running. */
	readonly endedAt?: Timestamp;
	/** The newest checkpoint made from the session. */
	readonly lastCheckpointId?: string;
	readonly tokens?: SessionTokens;
	/** The files the session touched, when the CLI lists them. */
	readonly filesTouched?: readonly string[];
}

/** Reads the token block, ignoring any count that is not a number. */
function decodeTokens(value: unknown): SessionTokens | undefined {
	const record = decodeRecord(value, 'tokens');
	if (!record.ok) {
		return undefined;
	}

	const read = fields(record.value, 'tokens');
	const count = (key: string): number | undefined => {
		const result = optionalNumber(read, key);
		return result.ok ? result.value : undefined;
	};

	return {
		total: count('total'),
		input: count('input'),
		output: count('output'),
		cacheRead: count('cache_read'),
		cacheWrite: count('cache_write'),
	};
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
			tokens: decodeTokens(optionalRaw(read, 'tokens')),
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
