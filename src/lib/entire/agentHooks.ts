import { carriedEvents, type EditorHookEvent } from './hookEvents';

/**
 * The verbs an agent's hook configuration calls.
 *
 * The CLI writes each agent's hooks as `entire hooks <agent> <verb>`
 * commands, and that is the only place it shows which verbs an agent's
 * handler takes: `entire hooks <agent> --help` lists none. So the verbs are
 * read from what the CLI wrote, never from a table of agents.
 */
export function findHookVerbs(agent: string, configuration: string): readonly string[] {
	const escaped = agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`entire\\s+hooks\\s+${escaped}\\s+([a-z][a-z0-9-]*)`, 'g');
	const verbs = new Set<string>();
	for (const match of configuration.matchAll(pattern)) {
		verbs.add(match[1]);
	}
	return [...verbs];
}

/** Whether the extension can report editor activity to an installed agent. */
export type HookSupport =
	| {
			readonly kind: 'supported';
			readonly agent: string;
			readonly verbs: readonly string[];
			/** The configuration files the verbs were read from, relative to the workspace. */
			readonly files: readonly string[];
			/** The editor events the agent's verbs can carry. */
			readonly events: readonly EditorHookEvent[];
	  }
	| { readonly kind: 'unsupported'; readonly agent: string; readonly reason: string };

/**
 * Decides whether an installed agent's events are understood.
 *
 * An agent is supported when its hook configuration was found and at least
 * one of its verbs carries an event the editor reports. Otherwise the
 * extension does not know how to speak to it, and says so rather than
 * counting a session that captured nothing.
 */
export function classifyAgent(
	agent: string,
	found: { readonly verbs: readonly string[]; readonly files: readonly string[] },
): HookSupport {
	if (found.verbs.length === 0) {
		return {
			kind: 'unsupported',
			agent,
			reason: `Entirely could not find the hook commands that Entire installed for ${agent}, so it does not know which events ${agent} sends`,
		};
	}

	const events = carriedEvents(found.verbs);
	if (events.length === 0) {
		return {
			kind: 'unsupported',
			agent,
			reason: `${agent} names its events differently from the editor (${found.verbs.join(', ')}), and the Entire CLI does not say how they correspond`,
		};
	}

	return { kind: 'supported', agent, verbs: found.verbs, files: found.files, events };
}

/** One line saying what Entirely does for an agent, for the setup list. */
export function describeSupport(support: HookSupport): string {
	if (support.kind === 'unsupported') {
		return `Not supported by Entirely: ${support.reason}.`;
	}
	return `Entirely reports ${support.events.length} editor event${support.events.length === 1 ? '' : 's'} to ${support.agent}.`;
}
