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
	/**
	 * The model the session is running, when the CLI reports one.
	 *
	 * This is whatever the user picked, which may be a model from a
	 * provider the extension has never heard of, or a local one. It is
	 * kept as the string it is.
	 */
	readonly model?: string;
}

/**
 * Whether and how the workspace is tracked by Entire.
 *
 * The CLI reports an untracked workspace with an `error` field. That is an
 * answer, not a failure, and it is modelled here as its own state so it
 * can never be confused with the command having failed.
 *
 * The distinction that matters to the user is whether the workspace can be
 * tracked at all. A directory that is not a git repository cannot be, and
 * offering to set it up there would be pointless. A git repository that
 * Entire has not been set up for can be, and the extension offers to do it.
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
			/**
			 * Where checkpoints are uploaded, as the CLI names the remote.
			 *
			 * A git remote name for checkpoints that go to this repository,
			 * and `owner/repo` for checkpoints that go to a repository of
			 * their own.
			 */
			readonly checkpointSyncRemote?: string;
			/**
			 * Where the CLI says that choice came from.
			 *
			 * Kept as the CLI's own words, because the CLI is free to add
			 * another way of choosing a destination.
			 */
			readonly checkpointSyncRemoteSource?: string;
			/** Whether checkpoint pushes are turned off. */
			readonly checkpointPushDisabled?: boolean;
	  }
	| {
			/** The workspace is not a git repository, so Entire cannot track it. */
			readonly kind: 'not-a-repository';
			readonly enabled: false;
	  }
	| {
			/**
			 * The workspace is a git repository that Entire has not been set
			 * up for, or has been set up for and then turned off.
			 */
			readonly kind: 'not-set-up';
			readonly enabled: false;
			/** Why the CLI says it is not set up. */
			readonly reason: string;
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

/**
 * A checkpoint: a frozen record of agent work.
 *
 * The CLI reports these on the current branch. Every checkpoint belongs to
 * the agent that produced it, and carries the message the agent was given.
 */
export interface Checkpoint {
	/** The checkpoint's identifier: twelve hex characters or a ULID. */
	readonly id: string;
	/** The message the agent was given, when it has one. */
	readonly message?: string;
	/** The agent that produced the work. */
	readonly agent?: string;
	/** When the checkpoint was recorded. */
	readonly date?: Timestamp;
	/** The session the checkpoint came from, when it came from one. */
	readonly sessionId?: string;
	/** Every session folded into the checkpoint. */
	readonly sessionIds: readonly string[];
	/** How many sessions the checkpoint holds. */
	readonly sessionCount: number;
	/** Whether the checkpoint records a subagent task rather than a turn. */
	readonly isTaskCheckpoint: boolean;
	/** Whether the checkpoint is a resume point with only logs. */
	readonly isLogsOnly: boolean;
}

/** One session inside a checkpoint. */
export interface CheckpointSession {
	/** The session's position in the checkpoint, newest last. */
	readonly index: number;
	readonly sessionId?: string;
	readonly agent?: string;
	/** The model the session used, recorded verbatim. */
	readonly model?: ModelId;
	/** What kind of session it was, when the CLI says. */
	readonly kind?: string;
	readonly createdAt?: Timestamp;
	/** The files the session touched. */
	readonly filesTouched: readonly string[];
}

/**
 * The CLI's account of one checkpoint.
 *
 * The envelope names the files the checkpoint touched, which is what the
 * extension needs to open a diff.
 */
export interface CheckpointDetail {
	readonly id: string;
	/** How the checkpoint was stored. */
	readonly strategy?: string;
	readonly branch?: string;
	/** Every file the checkpoint touched. */
	readonly filesTouched: readonly string[];
	readonly sessionCount: number;
	readonly sessions: readonly CheckpointSession[];
	/** Whether some of the checkpoint could not be read. */
	readonly partial: boolean;
	/** Why the task records could not be read, when they could not. */
	readonly tasksError?: string;
}
