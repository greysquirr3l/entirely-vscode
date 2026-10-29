import {
	agentAddArguments,
	agentRemoveArguments,
	classifyAgent,
	cleanCliText,
	failureDetail,
	isAgentName,
	parseAgentList,
	planAgentAddFlags,
	readWrittenFiles,
	type AgentEntry,
	type HookSupport,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { hooksOf, scanHookConfig } from './hookConfigScan';

/** What the service needs to do its job. */
export interface AgentIntegrationOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, an install or removal may take. */
	readonly timeoutSeconds: () => number;
}

/** An agent the CLI supports, with what Entirely knows about its hooks. */
export interface AgentListing extends AgentEntry {
	/** Present for an installed agent: whether Entirely understands its events. */
	readonly support?: HookSupport;
}

/** The agents the CLI supports, or why they cannot be listed. */
export type AgentListResult =
	| { readonly ok: true; readonly agents: readonly AgentListing[] }
	| { readonly ok: false; readonly detail: string };

/** How an install or a removal ended. */
export type AgentOutcome =
	| {
			readonly kind: 'done';
			readonly summary: string;
			/** The files the CLI listed to commit, which can include other integrations' files. */
			readonly files: readonly string[];
			/** For an install: whether the agent's events are understood. */
			readonly support?: HookSupport;
	  }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where agent integrations are read and changed. */
export interface AgentIntegrationSource {
	list(): Promise<AgentListResult>;
	/** True when the CLI offers a way to reinstall hooks that are already present. */
	canReinstall(): Promise<boolean>;
	install(name: string, reinstall?: boolean): Promise<AgentOutcome>;
	remove(name: string): Promise<AgentOutcome>;
}

/** The installed agents the editor can report to, and those it cannot. */
export type AgentHookTargets =
	| {
			readonly ok: true;
			readonly supported: readonly Extract<HookSupport, { kind: 'supported' }>[];
			readonly unsupported: readonly Extract<HookSupport, { kind: 'unsupported' }>[];
	  }
	| { readonly ok: false; readonly detail: string };

/** Where the hook bridge learns which agents to address. */
export interface AgentHookSource {
	targets(): Promise<AgentHookTargets>;
}

/**
 * Lists, installs and removes the CLI's agent integrations.
 *
 * The agents are whatever `entire agent list` prints, read for each call and
 * never remembered, so an agent the CLI adds later appears and a failed read
 * is not kept. Names go after the end-of-options marker, and only a name the
 * CLI just listed is passed on. More than one integration can be installed:
 * installing one never touches another. After a change the list is read
 * again, so "installed" is what the CLI reports and not what its exit status
 * implied.
 */
export class AgentIntegrationService implements AgentIntegrationSource, AgentHookSource {
	constructor(private readonly options: AgentIntegrationOptions) {}

	async list(): Promise<AgentListResult> {
		const read = await this.readAgents();
		if (!read.ok) {
			return read;
		}
		const root = this.options.workspaceRoot();
		const files = root && read.agents.some(agent => agent.installed) ? await scanHookConfig(root) : [];
		const agents = read.agents.map<AgentListing>(agent =>
			agent.installed ? { ...agent, support: classifyAgent(agent.name, hooksOf(agent.name, files)) } : agent,
		);
		return { ok: true, agents };
	}

	async targets(): Promise<AgentHookTargets> {
		const listed = await this.list();
		if (!listed.ok) {
			return listed;
		}
		const supports = listed.agents.flatMap(agent => (agent.support ? [agent.support] : []));
		return {
			ok: true,
			supported: supports.filter((support): support is Extract<HookSupport, { kind: 'supported' }> => support.kind === 'supported'),
			unsupported: supports.filter((support): support is Extract<HookSupport, { kind: 'unsupported' }> => support.kind === 'unsupported'),
		};
	}

	async canReinstall(): Promise<boolean> {
		const plan = await this.addPlan();
		return plan.ok && plan.reinstall !== undefined;
	}

	async install(name: string, reinstall = false): Promise<AgentOutcome> {
		const known = await this.checkName(name);
		if (!known.ok) {
			return { kind: 'failed', detail: known.detail };
		}
		let flag: string | undefined;
		if (reinstall) {
			const plan = await this.addPlan();
			if (!plan.ok || plan.reinstall === undefined) {
				return { kind: 'failed', detail: 'this version of the Entire CLI does not describe a way to reinstall hooks; update the CLI' };
			}
			flag = plan.reinstall;
		}

		const result = await this.options.runner.run(agentAddArguments(name, flag), this.runOptions());
		if (!result.ok) {
			return { kind: 'failed', detail: explain(result) };
		}

		const after = await this.list();
		const now = after.ok ? after.agents.find(agent => agent.name === name) : undefined;
		if (!now?.installed) {
			return {
				kind: 'failed',
				detail: `the Entire CLI reported success but does not list ${name} as installed${after.ok ? '' : ` (${after.detail})`}`,
			};
		}
		return {
			kind: 'done',
			summary: cleanCliText(result.stdout || result.stderr),
			files: readWrittenFiles(result.stdout),
			support: now.support,
		};
	}

	async remove(name: string): Promise<AgentOutcome> {
		const known = await this.checkName(name);
		if (!known.ok) {
			return { kind: 'failed', detail: known.detail };
		}
		if (!known.entry.installed) {
			return { kind: 'failed', detail: `${name} is not installed in this repository` };
		}

		const result = await this.options.runner.run(agentRemoveArguments(name), this.runOptions());
		if (!result.ok) {
			return { kind: 'failed', detail: explain(result) };
		}

		const after = await this.readAgents();
		if (after.ok && after.agents.find(agent => agent.name === name)?.installed) {
			return { kind: 'failed', detail: `the Entire CLI reported success but still lists ${name} as installed` };
		}
		return { kind: 'done', summary: cleanCliText(result.stdout || result.stderr), files: [] };
	}

	private runOptions(): { readonly cwd: string | undefined; readonly timeoutMs: number; readonly withholdBodies: true } {
		return {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			withholdBodies: true,
		};
	}

	/** Reads `agent list` into entries, or says why not. */
	private async readAgents(): Promise<
		{ readonly ok: true; readonly agents: readonly AgentEntry[] } | { readonly ok: false; readonly detail: string }
	> {
		const result = await this.options.runner.run(['agent', 'list'], { cwd: this.options.workspaceRoot() });
		if (!result.ok) {
			return { ok: false, detail: result.reason === 'absent' ? 'the Entire CLI is not installed; install it to manage agents' : explain(result) };
		}
		const agents = parseAgentList(result.stdout);
		if (agents === undefined) {
			return { ok: false, detail: "the output of 'entire agent list' was not in a form Entirely understands; update the extension or the CLI" };
		}
		if (agents.length === 0) {
			return { ok: false, detail: 'the Entire CLI lists no agents' };
		}
		return { ok: true, agents };
	}

	private async checkName(
		name: string,
	): Promise<{ readonly ok: true; readonly entry: AgentEntry } | { readonly ok: false; readonly detail: string }> {
		if (!isAgentName(name)) {
			return { ok: false, detail: 'that is not an agent name the CLI can be given' };
		}
		const read = await this.readAgents();
		if (!read.ok) {
			return read;
		}
		const entry = read.agents.find(agent => agent.name === name);
		return entry ? { ok: true, entry } : { ok: false, detail: `'${name}' is not an agent this version of the Entire CLI supports` };
	}

	/** Reads the reinstall flag from the help of `agent add`, for this call only. */
	private async addPlan(): Promise<ReturnType<typeof planAgentAddFlags>> {
		const options = { cwd: this.options.workspaceRoot() };
		let usage = await this.options.runner.usage('agent add', options);
		if (!usage.ok && usage.reason === 'exit-code') {
			usage = await this.options.runner.help('agent add', options);
		}
		if (!usage.ok) {
			return { ok: false, detail: usage.detail };
		}
		return planAgentAddFlags(usage.value.raw, usage.value.flags);
	}
}

function explain(result: { readonly reason: string; readonly detail: string; readonly stdout: string; readonly stderr: string }): string {
	return result.reason === 'exit-code' ? failureDetail(result.stderr, result.stdout, result.detail) : result.detail;
}
