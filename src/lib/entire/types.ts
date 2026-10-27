/**
 * The domain model of what the Entire CLI reports.
 *
 * These types describe states, not wire formats. A field the CLI sends as
 * null is either absent here or explicitly null — never an empty string
 * standing in for "nothing".
 */

/** An instant as the CLI reported it, parsed and raw. */
export interface Timestamp {
	/** The parsed instant. */
	readonly date: Date;
	/** The original text, kept so it can be displayed as the CLI wrote it. */
	readonly raw: string;
}

/**
 * A model identifier, exactly as the CLI recorded it.
 *
 * This is an opaque string and nothing more. It may be a hosted model, a
 * BYOK model from any provider, a local model, or one the extension has
 * never seen. The extension must not filter, map or validate it, so there
 * is deliberately no union of known models here — a closed list would have
 * to be updated every time a provider shipped something new.
 */
export type ModelId = string;

/** A session the CLI reports as currently active. */
export interface ActiveSession {
	/** The agent running the session. */
	readonly agent: string;
	readonly sessionId: string;
	/** The worktree the session is running in. */
	readonly worktreePath: string;
	/** Absent when the session is not on a branch yet. */
	readonly branch?: string;
	/** The session's status, as the CLI words it. */
	readonly status: string;
}

/**
 * Whether and how the workspace is tracked by Entire.
 *
 * The CLI reports a workspace that is not a git repository with an `error`
 * field. That is an answer, not a failure, and it is modelled here as its
 * own state so it can never be confused with the command having failed.
 */
export type WorkspaceStatus =
	| {
			readonly kind: 'tracked';
			readonly enabled: true;
			/** The agents Entire has installed hooks for. */
			readonly agents: readonly string[];
			readonly activeSessions: readonly ActiveSession[];
			/** The command that prints the CLI's own usage, when it names one. */
			readonly agentHelp?: string;
	  }
	| {
			readonly kind: 'untracked';
			readonly enabled: false;
			/** Why the workspace is not tracked. */
			readonly reason: string;
	  }
	| {
			readonly kind: 'disabled';
			readonly enabled: false;
	  };

/** A session Entire has recorded. */
export interface Session {
	readonly id: string;
	/** The agent that produced the session. */
	readonly agent: string;
	/** The session's status, as the CLI words it. */
	readonly status: string;
	/** The worktree the session belongs to. */
	readonly worktreePath: string;
	/** Absent when the session is not on a branch yet. */
	readonly branch?: string;
	readonly startedAt?: Timestamp;
	readonly lastActive?: Timestamp;
	readonly turns?: number;
	readonly pendingTurns?: number;
	readonly checkpoints?: number;
	/** The last prompt, when the session has one. */
	readonly lastPrompt?: string;
	/** The model the session used, recorded verbatim. */
	readonly model?: ModelId;
	/** How the CLI resolved this session, on the commands that say so. */
	readonly resolution?: string;
}
