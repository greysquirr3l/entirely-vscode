import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';

import type { AgentHookSource } from './agentIntegrations';
import type { CliRunner } from './cli';

import {
	HOOK_EVENTS,
	resolveHookName,
	type CliHookName,
	type EditorHookEvent,
	type HookEventRoute,
} from '../lib/entire/hookEvents';

export { HOOK_EVENTS, resolveHookName };
export type { CliHookName, EditorHookEvent, HookEventRoute };

/**
 * The payload, in the editor's dialect.
 *
 * The CLI reads every field by trying both spellings, so the shape is
 * forgiving. The two fields that decide the dialect are `hookEventName`
 * and `transcript_path`: a payload carrying them is read as an editor
 * payload, and one carrying `transcriptPath` or a numeric `timestamp` is
 * read as a CLI payload instead. So the camel-case spelling of the
 * transcript path is never used, and the timestamp is never sent.
 */
export interface HookPayload {
	readonly sessionId: string;
	readonly transcript_path: string;
	readonly hookEventName: string;
	readonly cwd: string;
	readonly prompt?: string;
	readonly reason?: string;
	readonly stopReason?: string;
	readonly agentId?: string;
	readonly agentName?: string;
	readonly agentDescription?: string;
}

/** What the bridge needs to know about an event. */
export interface HookEventDetails {
	/**
	 * The session the event belongs to.
	 *
	 * The transcript path is derived from it, so it has to be the same
	 * session the agent is writing its transcript for: the CLI compares the
	 * two and treats a mismatch as another agent's session.
	 */
	readonly sessionId?: string;
	/** The working directory the agent is working in. */
	readonly cwd?: string;
	/** The prompt the user submitted. */
	readonly prompt?: string;
	/** Why the agent stopped. */
	readonly reason?: string;
	/** The reason the turn ended, when only the turn ended. */
	readonly stopReason?: string;
	/** The agent's id, for the events that name one. */
	readonly agentId?: string;
	/** The agent's name. */
	readonly agentName?: string;
	/** What the agent was asked to do. */
	readonly agentDescription?: string;
	/** Whether the stop ends the session rather than the turn. */
	readonly terminal?: boolean;
}

/**
 * Where the agent keeps its transcripts.
 *
 * The agent writes them under its own home, in a directory named for the
 * session, so the session and the transcript always agree.
 */
export function copilotHome(
	env: NodeJS.ProcessEnv = process.env,
	homeDir: string = os.homedir(),
): string {
	const configured = env.COPILOT_HOME;
	if (configured && configured.length > 0) {
		return configured;
	}
	return path.join(homeDir, '.copilot');
}

/** The transcript of a session. */
export function transcriptPath(sessionId: string, home: string): string {
	return path.join(home, 'session-state', sessionId, 'events.jsonl');
}

/**
 * The directory whose hook files the editor loads and fires itself.
 *
 * An agent whose hooks live here is already reported by the editor, so the
 * bridge does not send the same events again.
 */
export const EDITOR_LOADED_HOOKS_DIRECTORY = '.github/hooks/';

/**
 * What became of an event for one agent.
 *
 * `delivered` means the CLI accepted the hook command for the agent the
 * editor's events belong to, nothing more. It is never true for an agent
 * the editor's payload layout does not match.
 */
export interface HookDelivery {
	readonly agent: string;
	readonly delivered: boolean;
	/** Why it was not delivered. */
	readonly skipped?: 'not-bridged' | 'already-reported' | 'failed';
}

/** What the bridge needs to do its job. */
export interface HookBridgeOptions {
	readonly runner: CliRunner;
	/** Which agent the editor's events are addressed to, and which installed agents they are not. */
	readonly agents: AgentHookSource;
	/** The workspace root the agents' hooks are installed in. */
	readonly workspaceRoot: () => string | undefined;
	/** The environment the agent's home is read from. */
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * The saved login the CLI is acting as.
	 *
	 * The CLI's flag does not reach the processes it spawns, so the hook
	 * is told which login to act as through the environment instead.
	 */
	readonly context?: () => string | undefined;
	/** The user's home directory. */
	readonly homeDir?: string;
	/** Records a delivery, for the output channel. */
	readonly log?: (line: string) => void;
	/** Reports a configuration problem that can prevent editor events from being delivered. */
	readonly warn?: (line: string) => void;
}

/**
 * Reports editor-side agent activity to Entire.
 *
 * The bridge speaks the CLI's hook protocol: it invokes
 * `entire hooks <editor agent> <event>` with the event as JSON on stdin, and
 * the CLI does the writing. Nothing here ever throws, and nothing here
 * ever waits on the user: a hook that has not finished must never stand
 * between the user and the thing they asked for.
 */
export class HookBridge {
	private readonly sessionIds = new Map<string, string>();
	private readonly notBridgedNoted = new Set<string>();
	private readonly editorAgentIssuesNoted = new Set<string>();

	constructor(private readonly options: HookBridgeOptions) {}

	/**
	 * The session id for a workspace.
	 *
	 * It stays the same for the lifetime of the extension's session, so a
	 * turn's events pair up with each other.
	 */
	sessionId(workspaceRoot: string | undefined): string {
		const key = workspaceRoot ?? '';

		const existing = this.sessionIds.get(key);
		if (existing) {
			return existing;
		}

		const created = randomUUID();
		this.sessionIds.set(key, created);
		return created;
	}

	/**
	 * Reports an event without waiting for it.
	 *
	 * This is what the editor calls: the user's action is complete whether
	 * or not the hook has been delivered.
	 */
	post(event: EditorHookEvent, details: HookEventDetails = {}): void {
		void this.deliver(event, details).catch(() => undefined);
	}

	/**
	 * Reports an event and waits for the delivery.
	 *
	 * Returns true when the event reached at least one agent. A failure is
	 * never an error the user sees: a missing CLI, a broken CLI or a CLI
	 * that rejects the event are all the same thing to the editor, which is
	 * that nothing happened.
	 */
	async deliver(event: EditorHookEvent, details: HookEventDetails = {}): Promise<boolean> {
		const results = await this.deliverToAgents(event, details);
		return results.some(result => result.delivered);
	}

	/**
	 * Reports an event to the agent whose payload layout matches the editor's.
	 *
	 * Every other installed agent is named in the result as not bridged and is
	 * never invoked: those agents run their own hooks, and a hook verb with the
	 * same name as an editor event does not make their payload layout the same.
	 * The CLI accepts a payload it cannot read and records nothing, so there
	 * would be no way to tell. The editor's agent is also left alone when its
	 * hook file is one the editor loads itself, which would double the events.
	 */
	async deliverToAgents(
		event: EditorHookEvent,
		details: HookEventDetails = {},
	): Promise<readonly HookDelivery[]> {
		try {
			return await this.sendAll(event, details);
		} catch {
			return [];
		}
	}

	/** Does the work of delivering one event. */
	private async sendAll(
		event: EditorHookEvent,
		details: HookEventDetails,
	): Promise<readonly HookDelivery[]> {
		if (!resolveHookName(event, details.terminal ?? false)) {
			// The CLI has no hook that will carry this event, and it drops
			// such an event without a word. Sending it would lose it
			// quietly, so it is not sent.
			return [];
		}

		const targets = await this.options.agents.targets();
		if (targets.editorAgentIssue) {
			this.noteEditorAgentIssue(targets.editorAgentIssue);
		}
		if (!targets.ok) {
			return [];
		}

		const results: HookDelivery[] = [];
		for (const other of targets.notBridged) {
			this.noteNotBridged(other.agent, other.reason);
			results.push({ agent: other.agent, delivered: false, skipped: 'not-bridged' });
		}
		const target = targets.bridged;
		if (!target) {
			return results;
		}
		if (target.installed && target.files.some(file => file.startsWith(EDITOR_LOADED_HOOKS_DIRECTORY))) {
			// The editor reads this agent's hook file itself, so the same
			// activity is already being reported. Reporting it again
			// would double it.
			results.push({ agent: target.agent, delivered: false, skipped: 'already-reported' });
			return results;
		}
		const delivered = await this.send(target.agent, event, details);
		results.push(delivered ? { agent: target.agent, delivered } : { agent: target.agent, delivered, skipped: 'failed' });
		return results;
	}

	/** Says once per agent that editor events are not forwarded to it. */
	private noteNotBridged(agent: string, reason: string): void {
		if (this.notBridgedNoted.has(agent)) {
			return;
		}
		this.notBridgedNoted.add(agent);
		this.options.log?.(`not bridged ${agent}: ${reason}`);
	}

	private noteEditorAgentIssue(issue: string): void {
		if (this.editorAgentIssuesNoted.has(issue)) {
			return;
		}
		this.editorAgentIssuesNoted.add(issue);
		this.options.warn?.(issue);
	}

	/** Delivers one event to one agent. */
	private async send(agent: string, event: EditorHookEvent, details: HookEventDetails): Promise<boolean> {
		const verb = resolveHookName(event, details.terminal ?? false);
		if (!verb) {
			return false;
		}

		const workspaceRoot = this.options.workspaceRoot();
		const sessionId = details.sessionId ?? this.sessionId(workspaceRoot);
		const cwd = details.cwd ?? workspaceRoot;
		if (!cwd) {
			return false;
		}

		// The environment carries the login as well as the agent's home.
		// The CLI's flag does not reach the processes it spawns, so the
		// hook is told which login to act as through the environment
		// instead.
		const env = this.environment();

		const payload = this.payloadFor(event, details, sessionId, cwd, env);
		const body = JSON.stringify(payload);

		const result = await this.options.runner.run(['hooks', agent, verb], {
			cwd,
			input: body,
			// The CLI is given the same environment the transcript path was
			// worked out from, so the two can never disagree about where the
			// agent keeps its transcripts.
			env,
		});

		if (!result.ok) {
			return false;
		}

		this.options.log?.(`${agent} ${verb} ${sessionId}`);
		return true;
	}

	/**
	 * The environment the CLI is given.
	 *
	 * The login is named in it, because the CLI's own flag does not
	 * reach the processes it spawns. Without a pinned login the
	 * environment is left exactly as it was.
	 */
	private environment(): NodeJS.ProcessEnv | undefined {
		const context = this.options.context?.();
		if (!context) {
			return this.options.env;
		}

		return { ...(this.options.env ?? process.env), ENTIRE_CONTEXT: context };
	}

	/** Builds the payload for an event. */
	private payloadFor(
		event: EditorHookEvent,
		details: HookEventDetails,
		sessionId: string,
		cwd: string,
		env: NodeJS.ProcessEnv | undefined,
	): HookPayload {
		const home = copilotHome(env, this.options.homeDir);

		const payload: {
			sessionId: string;
			transcript_path: string;
			hookEventName: string;
			cwd: string;
			prompt?: string;
			reason?: string;
			stopReason?: string;
			agentId?: string;
			agentName?: string;
			agentDescription?: string;
		} = {
			sessionId,
			transcript_path: transcriptPath(sessionId, home),
			hookEventName: event,
			cwd,
		};

		if (details.prompt !== undefined) {
			payload.prompt = details.prompt;
		}
		if (details.agentId !== undefined) {
			payload.agentId = details.agentId;
		}
		if (details.agentName !== undefined) {
			payload.agentName = details.agentName;
		}
		if (details.agentDescription !== undefined) {
			payload.agentDescription = details.agentDescription;
		}

		if (event === 'Stop') {
			if (details.terminal) {
				// A reason is what tells the CLI the session has ended
				// rather than the turn.
				payload.reason = details.reason ?? 'session_end';
			} else {
				payload.stopReason = details.stopReason ?? 'end_turn';
			}
		} else if (details.reason !== undefined) {
			payload.reason = details.reason;
		}

		return payload;
	}
}
