import { HOOK_EVENTS, carriedEvents } from '../../lib/entire';
import type { AgentHookSource, AgentHookTargets } from '../../services/agentIntegrations';

/** Every verb the bridge's table can send, as an agent that understands all of them would take. */
export const ALL_BRIDGE_VERBS: readonly string[] = HOOK_EVENTS.flatMap(route =>
	[route.hook, route.terminalHook].filter((verb): verb is NonNullable<typeof verb> => verb !== undefined),
);

/** A supported target, as the service reports one. */
export function supportedTarget(
	agent: string,
	verbs: readonly string[] = ALL_BRIDGE_VERBS,
	files: readonly string[] = [`.${agent}/hooks.json`],
): Extract<AgentHookTargets, { ok: true }>['supported'][number] {
	return { kind: 'supported', agent, verbs, files, events: carriedEvents(verbs) };
}

/** A source that reports the given targets, and counts how often it was asked. */
export class FixedTargets implements AgentHookSource {
	asked = 0;

	constructor(
		private readonly supported: ReturnType<typeof supportedTarget>[],
		private readonly unsupported: { agent: string; reason: string }[] = [],
	) {}

	async targets(): Promise<AgentHookTargets> {
		this.asked += 1;
		return {
			ok: true,
			supported: this.supported,
			unsupported: this.unsupported.map(entry => ({ kind: 'unsupported' as const, ...entry })),
		};
	}
}
