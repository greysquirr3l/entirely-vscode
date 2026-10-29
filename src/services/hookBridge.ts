import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { CliRunner } from './cli';

/**
 * The editor events the bridge reports.
 *
 * These are the names the editor uses. They are not the names the CLI
 * uses, and the CLI checks the pairing and drops a mismatch without a
 * word, so the mapping between the two is kept in one table below.
 */
export type EditorHookEvent =
	| 'SessionStart'
	| 'UserPromptSubmit'
	| 'Stop'
	| 'PreToolUse'
	| 'PostToolUse'
	| 'SubagentStart'
	| 'SubagentStop'
	| 'PreCompact'
	| 'ErrorOccurred';

/** The verbs the CLI's hook command accepts. */
export type CliHookName =
	| 'session-start'
	| 'user-prompt-submitted'
	| 'agent-stop'
	| 'session-end'
	| 'pre-tool-use'
	| 'post-tool-use'
	| 'subagent-start'
	| 'subagent-stop'
	| 'error-occurred';

/** One row of the mapping table. */
export interface HookEventRoute {
	/** The editor event. */
	readonly event: EditorHookEvent;
	/** The CLI verb that carries it, when the CLI has one. */
	readonly hook?: CliHookName;
	/**
	 * The CLI verb for the terminal form of the event.
	 *
	 * The editor overloads one `Stop` event for both the end of a turn and
	 * the end of a session, and the two are told apart by reason.
	 */
	readonly terminalHook?: CliHookName;
}

/**
 * The mapping from editor events to CLI verbs.
 *
 * This table is the only place the mapping lives, so it can be read in one
 * go and tested as a whole.
 *
 * `PreCompact` has no verb: the CLI has no hook that will carry it, and it
 * drops such an event without a word, so sending one would lose it
 * quietly. The editor's `Stop` is the one event that has two verbs.
 */
export const HOOK_EVENTS: readonly HookEventRoute[] = [
	{ event: 'SessionStart', hook: 'session-start' },
	{ event: 'UserPromptSubmit', hook: 'user-prompt-submitted' },
	{ event: 'Stop', hook: 'agent-stop', terminalHook: 'session-end' },
	{ event: 'PreToolUse', hook: 'pre-tool-use' },
	{ event: 'PostToolUse', hook: 'post-tool-use' },
	{ event: 'SubagentStart', hook: 'subagent-start' },
	{ event: 'SubagentStop', hook: 'subagent-stop' },
	{ event: 'ErrorOccurred', hook: 'error-occurred' },
	{ event: 'PreCompact' },
];

/**
 * The CLI verb that carries an editor event.
 *
 * Returns undefined when the CLI has no verb for the event, which is the
 * signal not to send it at all.
 */
export function resolveHookName(
	event: EditorHookEvent,
	terminal = false,
): CliHookName | undefined {
	const route = HOOK_EVENTS.find(candidate => candidate.event === event);
	if (!route) {
		return undefined;
	}

	if (terminal && route.terminalHook) {
		return route.terminalHook;
	}

	return route.hook;
}

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

/** Where the CLI installs its own hooks for Copilot CLI. */
export const CLI_HOOKS_FILE = path.join('.github', 'hooks', 'entire.json');

/** What the bridge needs to do its job. */
export interface HookBridgeOptions {
	readonly runner: CliRunner;
	/** The workspace root, where the CLI's own hooks would be installed. */
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
}

/**
 * Reports editor-side agent activity to Entire.
 *
 * The bridge speaks the CLI's hook protocol: it invokes
 * `entire hooks copilot-cli <event>` with the event as JSON on stdin, and
 * the CLI does the writing. Nothing here ever throws, and nothing here
 * ever waits on the user: a hook that has not finished must never stand
 * between the user and the thing they asked for.
 */
export class HookBridge {
	private readonly sessionIds = new Map<string, string>();

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
	 * Returns true when the event was delivered. A failure is never an
	 * error the user sees: a missing CLI, a broken CLI or a CLI that
	 * rejects the event are all the same thing to the editor, which is
	 * that nothing happened.
	 */
	async deliver(event: EditorHookEvent, details: HookEventDetails = {}): Promise<boolean> {
		try {
			return await this.send(event, details);
		} catch {
			return false;
		}
	}

	/** Does the work of delivering one event. */
	private async send(event: EditorHookEvent, details: HookEventDetails): Promise<boolean> {
		const verb = resolveHookName(event, details.terminal ?? false);
		if (!verb) {
			// The CLI has no hook that will carry this event, and it drops
			// such an event without a word. Sending it would lose it
			// quietly, so it is not sent.
			return false;
		}

		const workspaceRoot = this.options.workspaceRoot();
		if (this.cliHooksInstalled(workspaceRoot)) {
			// The CLI's own hooks are installed, so the same activity is
			// already being reported. Reporting it again would double it.
			return false;
		}

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

		const result = await this.options.runner.run(['hooks', 'copilot-cli', verb], {
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

		this.options.log?.(`${verb} ${sessionId}`);
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

	/** Whether the CLI's own hooks are installed in this workspace. */
	private cliHooksInstalled(workspaceRoot: string | undefined): boolean {
		if (!workspaceRoot) {
			return false;
		}

		try {
			return fs.existsSync(path.join(workspaceRoot, CLI_HOOKS_FILE));
		} catch {
			return false;
		}
	}
}
