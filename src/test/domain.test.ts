import * as assert from 'assert';

import {
	decodeCurrentSession,
	decodeSession,
	decodeSessionList,
	decodeWorkspaceStatus,
	unwrap,
} from '../lib/entire';

/**
 * The payloads the CLI actually prints, captured from a real CLI.
 *
 * Each fixture is the verbatim shape, including the places where the CLI
 * sends null for a field that is present in the other shape.
 */
const TRACKED_STATUS = {
	enabled: true,
	agents: ['Copilot CLI'],
	active_sessions: [
		{
			agent: 'Copilot CLI',
			session_id: 'abc-123',
			worktree_path: '/work/sandbox',
			branch: 'master',
			status: 'active',
		},
	],
	agent_help: 'entire agent-help',
};

const NOT_A_REPOSITORY_STATUS = {
	enabled: false,
	agents: null,
	active_sessions: null,
	error: 'not a git repository',
};

const NOT_SET_UP_STATUS = {
	enabled: false,
	agents: null,
	active_sessions: null,
	error: 'not set up',
};

const DISABLED_STATUS = {
	enabled: false,
	agents: null,
	active_sessions: null,
};

const SESSION_LIST = [
	{
		session_id: 'abc-123',
		agent: 'Copilot CLI',
		status: 'active',
		branch: 'master',
		worktree_path: '/work/sandbox',
		started_at: '2026-10-26T23:34:45.832442304Z',
		last_active: '2026-10-26T23:34:50.249468583Z',
		turns: 0,
		pending_turns: 0,
		checkpoints: 0,
		last_prompt: 'add a test',
	},
];

suite('Entire workspace status', () => {
	test('decodes a tracked repository', () => {
		const result = decodeWorkspaceStatus(TRACKED_STATUS);
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		assert.strictEqual(result.value.kind, 'tracked');
		assert.strictEqual(result.value.enabled, true);
		assert.deepStrictEqual(result.value.agents, ['Copilot CLI']);
		assert.strictEqual(result.value.activeSessions.length, 1);
		assert.strictEqual(result.value.activeSessions[0].sessionId, 'abc-123');
		assert.strictEqual(result.value.activeSessions[0].agent, 'Copilot CLI');
		assert.strictEqual(result.value.activeSessions[0].worktreePath, '/work/sandbox');
		assert.strictEqual(result.value.activeSessions[0].branch, 'master');
		assert.strictEqual(result.value.activeSessions[0].status, 'active');
		assert.strictEqual(result.value.agentHelp, 'entire agent-help');
	});

	test('decodes a directory that is not a git repository as a state, not a failure', () => {
		const result = decodeWorkspaceStatus(NOT_A_REPOSITORY_STATUS);
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		assert.strictEqual(result.value.kind, 'not-a-repository');
		assert.strictEqual(result.value.enabled, false);
	});

	test('decodes a git repository Entire has not been set up for', () => {
		const result = decodeWorkspaceStatus(NOT_SET_UP_STATUS);
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		assert.strictEqual(result.value.kind, 'not-set-up');
		assert.strictEqual(result.value.enabled, false);
		if (result.value.kind === 'not-set-up') {
			assert.strictEqual(result.value.reason, 'not set up');
		}
	});

	test('decodes a workspace where tracking is off as not set up', () => {
		const result = decodeWorkspaceStatus(DISABLED_STATUS);
		assert.strictEqual(result.ok, true);
		if (result.ok && result.value.kind === 'not-set-up') {
			assert.strictEqual(result.value.enabled, false);
			return;
		}
		assert.fail('expected the not-set-up state');
	});

	test('decodes a tracked repository with no active sessions', () => {
		const result = decodeWorkspaceStatus({
			enabled: true,
			agents: [],
			active_sessions: [],
			agent_help: 'entire agent-help',
		});
		assert.strictEqual(result.ok, true);
		if (result.ok && result.value.kind === 'tracked') {
			assert.deepStrictEqual(result.value.agents, []);
			assert.deepStrictEqual(result.value.activeSessions, []);
		}
	});

	test('reports a payload that is not an object', () => {
		const result = decodeWorkspaceStatus('not a status');
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'not-an-object');
			assert.strictEqual(result.issue.path, 'status');
		}
	});

	test('reports a missing enabled flag', () => {
		const result = decodeWorkspaceStatus({ agents: [] });
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'wrong-type');
			assert.strictEqual(result.issue.path, 'status.enabled');
		}
	});

	test('reports a tracked workspace whose sessions are null', () => {
		const result = decodeWorkspaceStatus({
			enabled: true,
			agents: [],
			active_sessions: null,
		});
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'not-an-array');
			assert.strictEqual(result.issue.path, 'status.active_sessions');
		}
	});
});

suite('Entire sessions', () => {
	test('decodes the session list the CLI prints', () => {
		const result = decodeSessionList(SESSION_LIST);
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		assert.strictEqual(result.value.length, 1);
		const session = result.value[0];
		assert.strictEqual(session.id, 'abc-123');
		assert.strictEqual(session.agent, 'Copilot CLI');
		assert.strictEqual(session.status, 'active');
		assert.strictEqual(session.branch, 'master');
		assert.strictEqual(session.worktreePath, '/work/sandbox');
		assert.strictEqual(session.turns, 0);
		assert.strictEqual(session.pendingTurns, 0);
		assert.strictEqual(session.checkpoints, 0);
		assert.strictEqual(session.lastPrompt, 'add a test');
	});

	test('parses timestamps and keeps the raw text', () => {
		const result = decodeSessionList(SESSION_LIST);
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		const startedAt = result.value[0].startedAt;
		assert.ok(startedAt);
		assert.strictEqual(startedAt.raw, '2026-10-26T23:34:45.832442304Z');
		assert.strictEqual(startedAt.date.toISOString(), '2026-10-26T23:34:45.832Z');
	});

	test('decodes a session that is missing its branch and last prompt', () => {
		const result = decodeSession({
			session_id: 'abc-123',
			agent: 'Copilot CLI',
			status: 'active',
			worktree_path: '/work/sandbox',
		});
		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}

		assert.strictEqual(result.value.branch, undefined);
		assert.strictEqual(result.value.lastPrompt, undefined);
		assert.strictEqual(result.value.turns, undefined);
	});

	test('decodes a session whose optional fields are null', () => {
		const result = decodeSession({
			session_id: 'abc-123',
			agent: 'Copilot CLI',
			status: 'active',
			worktree_path: '/work/sandbox',
			branch: null,
			last_prompt: null,
			turns: null,
			started_at: null,
		});
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.branch, undefined);
			assert.strictEqual(result.value.lastPrompt, undefined);
			assert.strictEqual(result.value.turns, undefined);
			assert.strictEqual(result.value.startedAt, undefined);
		}
	});

	test('decodes an empty session list', () => {
		const result = decodeSessionList([]);
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.deepStrictEqual(result.value, []);
		}
	});

	test('reports a session list that is not an array', () => {
		const result = decodeSessionList({ sessions: [] });
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'not-an-array');
			assert.strictEqual(result.issue.path, 'sessions');
		}
	});

	test('reports a session that is missing its id', () => {
		const result = decodeSession({ agent: 'Copilot CLI', status: 'active' });
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'missing');
			assert.strictEqual(result.issue.path, 'session.session_id');
		}
	});

	test('reports a session whose id is the wrong kind', () => {
		const result = decodeSession({ session_id: 42, agent: 'Copilot CLI' });
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.kind, 'wrong-type');
			assert.strictEqual(result.issue.path, 'session.session_id');
		}
	});

	test('reports a timestamp that cannot be parsed', () => {
		const result = decodeSession({
			session_id: 'abc-123',
			agent: 'Copilot CLI',
			status: 'active',
			worktree_path: '/work/sandbox',
			started_at: 'not a date',
		});
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.issue.path, 'session.started_at');
		}
	});

	test('decodes the current session, with its resolution', () => {
		const result = decodeCurrentSession({
			...SESSION_LIST[0],
			resolution: 'worktree',
		});
		assert.strictEqual(result.ok, true);
		if (result.ok && result.value) {
			assert.strictEqual(result.value.resolution, 'worktree');
			assert.strictEqual(result.value.id, 'abc-123');
		}
	});

	test('decodes a current session of null as no session', () => {
		const result = decodeCurrentSession(null);
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value, undefined);
		}
	});
});

suite('Entire model identifiers', () => {
	// The model is an opaque string. These cases prove there is no closed
	// union of known models and no validation of what the CLI recorded.
	const MODELS = [
		'minimax/MiniMax-M3.1-Flash-Preview',
		'kimi-k2.7-code',
		'Qwen 3 Coder (Ollama)',
		'gpt-4o',
		'anthropic/claude-sonnet-4',
		'',
		'a model name with spaces',
	];

	for (const model of MODELS) {
		test(`accepts the model ${JSON.stringify(model)}`, () => {
			const result = decodeSession({
				session_id: 'abc-123',
				agent: 'Copilot CLI',
				status: 'active',
				worktree_path: '/work/sandbox',
				model,
			});

			assert.strictEqual(result.ok, true);
			if (result.ok) {
				assert.strictEqual(result.value.model, model);
				assert.strictEqual(typeof result.value.model, 'string');
			}
		});
	}

	test('leaves the model absent when the session has none', () => {
		const result = decodeSession({
			session_id: 'abc-123',
			agent: 'Copilot CLI',
			status: 'active',
			worktree_path: '/work/sandbox',
		});
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.model, undefined);
		}
	});
});

suite('Entire decode unwrapping', () => {
	test('returns the value when the payload was read', () => {
		const result = decodeWorkspaceStatus({
			enabled: true,
			agents: [],
			active_sessions: [],
		});
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(unwrap(result).kind, 'tracked');
		}
	});

	test('throws when the payload could not be read', () => {
		const result = decodeWorkspaceStatus('not a status');
		assert.strictEqual(result.ok, false);
		assert.throws(() => unwrap(result), /status: expected an object/);
	});
});
