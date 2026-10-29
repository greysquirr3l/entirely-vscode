import type { AgentHookSource, AgentHookTargets } from '../../services/agentIntegrations';

type Bridged = NonNullable<Extract<AgentHookTargets, { ok: true }>['bridged']>;

/** The agent the editor's events go to, as the service reports it. */
export function bridgedTarget(agent: string, files: readonly string[] = [], installed = files.length > 0): Bridged {
	return { kind: 'bridged', agent, installed, files };
}

/** A source that reports the given targets, and counts how often it was asked. */
export class FixedTargets implements AgentHookSource {
	asked = 0;

	constructor(
		private readonly bridged?: Bridged,
		private readonly notBridged: { agent: string; reason: string }[] = [],
	) {}

	async targets(): Promise<AgentHookTargets> {
		this.asked += 1;
		return {
			ok: true,
			bridged: this.bridged,
			notBridged: this.notBridged.map(entry => ({ kind: 'not-bridged' as const, ...entry })),
		};
	}
}
