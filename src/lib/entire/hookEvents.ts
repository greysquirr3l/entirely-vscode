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
