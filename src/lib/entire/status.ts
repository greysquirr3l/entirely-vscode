import {
	decodeArray,
	decodeRecord,
	fields,
	optionalString,
	requireString,
	requireStringArray,
	type DecodeResult,
	type Fields,
} from './decode';
import type { ActiveSession, WorkspaceStatus } from './types';

/** Decodes one entry of the CLI's `active_sessions` array. */
function decodeActiveSession(value: unknown, path: string): DecodeResult<ActiveSession> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const agent = requireString(read, 'agent');
	if (!agent.ok) {
		return agent;
	}

	const sessionId = requireString(read, 'session_id');
	if (!sessionId.ok) {
		return sessionId;
	}

	const worktreePath = requireString(read, 'worktree_path');
	if (!worktreePath.ok) {
		return worktreePath;
	}

	const status = requireString(read, 'status');
	if (!status.ok) {
		return status;
	}

	const branch = optionalString(read, 'branch');
	if (!branch.ok) {
		return branch;
	}

	return {
		ok: true,
		value: {
			agent: agent.value,
			sessionId: sessionId.value,
			worktreePath: worktreePath.value,
			branch: branch.value,
			status: status.value,
		},
	};
}

/**
 * Decodes the payload of `entire status --json`.
 *
 * The CLI sends two shapes. A tracked repository has `agents` and
 * `active_sessions` as arrays and an `agent_help` field; a repository
 * Entire does not track has both as null and an `error` field instead.
 * The error is an answer, not a failure, so it becomes its own state.
 */
export function decodeWorkspaceStatus(value: unknown): DecodeResult<WorkspaceStatus> {
	const record = decodeRecord(value, 'status');
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, 'status');

	const enabled = read.record['enabled'];
	if (typeof enabled !== 'boolean') {
		return {
			ok: false,
			issue: {
				kind: 'wrong-type',
				path: 'status.enabled',
				detail: `expected a boolean, got ${enabled === null ? 'null' : `a ${typeof enabled}`}`,
			},
		};
	}

	if (!enabled) {
		const reason = optionalString(read, 'error');
		if (!reason.ok) {
			return reason;
		}
		if (reason.value !== undefined) {
			return { ok: true, value: { kind: 'untracked', enabled: false, reason: reason.value } };
		}
		return { ok: true, value: { kind: 'disabled', enabled: false } };
	}

	const agents = requireStringArray(read, 'agents');
	if (!agents.ok) {
		return agents;
	}

	const sessions = decodeArray(read.record['active_sessions'], 'status.active_sessions');
	if (!sessions.ok) {
		return sessions;
	}

	const activeSessions: ActiveSession[] = [];
	for (let index = 0; index < sessions.value.length; index++) {
		const session = decodeActiveSession(sessions.value[index], `status.active_sessions[${index}]`);
		if (!session.ok) {
			return session;
		}
		activeSessions.push(session.value);
	}

	const agentHelp = optionalString(read, 'agent_help');
	if (!agentHelp.ok) {
		return agentHelp;
	}

	return {
		ok: true,
		value: {
			kind: 'tracked',
			enabled: true,
			agents: agents.value,
			activeSessions,
			agentHelp: agentHelp.value,
		},
	};
}

/** Whether the status says the workspace is tracked. */
export function isTracked(status: WorkspaceStatus): boolean {
	return status.kind === 'tracked';
}
