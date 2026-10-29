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

/**
 * Whether Entirely forwards the editor's own agent events to an agent.
 *
 * Installing an integration and bridging it are separate things. Every
 * integration the CLI ships runs its own hooks through its own program, and
 * those hooks call `entire hooks <agent> <verb>` with that program's own
 * payload. The editor's events carry a different layout, and a verb with the
 * same name does not make the two compatible: the CLI exits 0 for a payload
 * it cannot read and records nothing. So the bridge forwards editor events
 * to one agent only, the one whose layout the editor's matches, and never
 * claims to capture any other.
 */
export type HookBridging =
	| {
			readonly kind: 'bridged';
			readonly agent: string;
			/** Whether the CLI lists the agent as installed in this repository. */
			readonly installed: boolean;
			/** The configuration files that hold the agent's hook commands, relative to the workspace. */
			readonly files: readonly string[];
	  }
	| { readonly kind: 'not-bridged'; readonly agent: string; readonly reason: string };

/**
 * Decides whether an agent is the one the editor's events belong to.
 *
 * `editorAgent` is the integration whose hook payload layout matches the
 * editor's. Any other agent is not bridged, whatever verbs its hook file
 * names.
 */
export function classifyAgent(
	agent: string,
	editorAgent: string,
	found: { readonly installed: boolean; readonly files: readonly string[] },
): HookBridging {
	if (agent !== editorAgent) {
		return {
			kind: 'not-bridged',
			agent,
			reason: `${agent} runs its own hooks; Entirely does not forward editor events to it`,
		};
	}
	return { kind: 'bridged', agent, installed: found.installed, files: found.files };
}

/** One line saying what Entirely does, or does not do, for an agent. */
export function describeBridging(bridging: HookBridging): string {
	if (bridging.kind === 'not-bridged') {
		return `Not bridged: ${bridging.reason}. Its own hooks report to Entire.`;
	}
	return `Bridged: Entirely forwards this editor's own agent events to ${bridging.agent}.`;
}
