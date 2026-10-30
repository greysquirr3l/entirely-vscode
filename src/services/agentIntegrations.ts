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
	DEFAULT_EDITOR_HOOK_AGENT,
	type AgentEntry,
	type HookBridging,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { hooksOf, scanHookConfig } from './hookConfigScan';

/** What the service needs to do its job. */
export interface AgentIntegrationOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, an install or removal may take. */
	readonly timeoutSeconds: () => number;
	/** How long, in milliseconds, an agent lookup may be reused. */
	readonly cacheTtlMs: () => number;
	/**
	 * The integration whose hook payload layout matches the editor's.
	 *
	 * Read for each lookup, so changing the setting takes effect without a
	 * restart. It is the only agent the editor's events are forwarded to.
	 */
	readonly editorAgent: () => string;
}

/** An agent the CLI supports, with what Entirely knows about its hooks. */
export interface AgentListing extends AgentEntry {
	/**
	 * Whether Entirely forwards editor events to this agent. Present for the
	 * editor's agent and for every installed agent; an agent that is neither
	 * has nothing to say.
	 */
	readonly bridging?: HookBridging;
	/** The files that hold this agent's hook commands now, when it is installed. */
	readonly hookFiles?: readonly string[];
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
			/** For an install: whether Entirely forwards editor events to the agent. */
			readonly bridging?: HookBridging;
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

/** The agent the editor's events go to, and the installed agents they do not. */
export type AgentHookTargets =
	| {
			readonly ok: true;
			/** The editor's agent, when the CLI lists it. */
			readonly bridged?: Extract<HookBridging, { kind: 'bridged' }>;
			readonly notBridged: readonly Extract<HookBridging, { kind: 'not-bridged' }>[];
			readonly editorAgentIssue?: string;
	  }
	| { readonly ok: false; readonly detail: string; readonly editorAgentIssue?: string };

/** Where the hook bridge learns which agents to address. */
export interface AgentHookSource {
	targets(): Promise<AgentHookTargets>;
}

/**
 * Lists, installs and removes the CLI's agent integrations.
 *
 * The agents are whatever `entire agent list` prints. The hook bridge asks
 * for them on editor events, so the lookup (the list plus a scan of the
 * hook files) is remembered for a bounded time and forgotten when an
 * install or removal runs. The workspace root and editor-agent setting are
 * part of the cache key. The list shown to the person is always read fresh.
 * Names go after the end-of-options marker,
 * and only a name the CLI just listed is passed on. More than one
 * integration can be installed: installing one never touches another.
 * After a change the list is read again, so "installed" is what the CLI
 * reports and not what its exit status implied.
 */
export class AgentIntegrationService implements AgentIntegrationSource, AgentHookSource {
	private remembered: { readonly key: string; readonly lookup: Promise<AgentListResult>; expiresAt: number } | undefined;

	constructor(private readonly options: AgentIntegrationOptions) {}

	/** Forgets the last lookup, so the next one asks the CLI again. */
	invalidate(): void {
		this.remembered = undefined;
	}

	async list(): Promise<AgentListResult> {
		return this.remember(true);
	}

	async targets(): Promise<AgentHookTargets> {
		const editorAgent = this.options.editorAgent();
		const listed = await this.remember(false);
		const editorAgentIssue = describeEditorAgentIssue(editorAgent, listed.ok ? listed.agents : undefined);
		if (!listed.ok) {
			return editorAgentIssue ? { ...listed, editorAgentIssue } : listed;
		}
		const bridgings = listed.agents.flatMap(agent => (agent.bridging ? [agent.bridging] : []));
		return {
			ok: true,
			bridged: bridgings.find((bridging): bridging is Extract<HookBridging, { kind: 'bridged' }> => bridging.kind === 'bridged'),
			notBridged: bridgings.filter((bridging): bridging is Extract<HookBridging, { kind: 'not-bridged' }> => bridging.kind === 'not-bridged'),
			...(editorAgentIssue ? { editorAgentIssue } : {}),
		};
	}

	private remember(fresh: boolean): Promise<AgentListResult> {
		const ttlMs = Math.max(0, this.options.cacheTtlMs());
		const key = `${this.options.workspaceRoot() ?? ''}\n${this.options.editorAgent()}\n${ttlMs}`;
		if (!fresh && this.remembered?.key === key && Date.now() < this.remembered.expiresAt) {
			return this.remembered.lookup;
		}
		const lookup = this.lookUp();
		// A lookup that is still running is always reused: two editor
		// events arriving together must not start two CLI processes.
		const entry = { key, lookup, expiresAt: Number.POSITIVE_INFINITY };
		this.remembered = entry;
		// The lifetime is counted from the moment the list was read, not
		// from the moment the read began, so a slow CLI does not hand back
		// an expired lookup.
		const settle = (failed: boolean): void => {
			if (this.remembered !== entry) {
				return;
			}
			if (failed) {
				// A failure is not kept: the CLI may be installed a moment later.
				this.remembered = undefined;
				return;
			}
			entry.expiresAt = Date.now() + ttlMs;
		};
		void lookup.then(result => settle(!result.ok), () => settle(true));
		return lookup;
	}

	private async lookUp(): Promise<AgentListResult> {
		const read = await this.readAgents();
		if (!read.ok) {
			return read;
		}
		const root = this.options.workspaceRoot();
		const editorAgent = this.options.editorAgent();
		const files = root && read.agents.some(agent => agent.installed) ? await scanHookConfig(root) : [];
		const agents = read.agents.map<AgentListing>(agent => {
			const hooks = hooksOf(agent.name, files);
			const bridging = agent.installed || agent.name === editorAgent
				? classifyAgent(agent.name, editorAgent, { installed: agent.installed, files: hooks.files })
				: undefined;
			return agent.installed ? { ...agent, bridging, hookFiles: hooks.files } : { ...agent, bridging };
		});
		return { ok: true, agents };
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

		this.invalidate();
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
			bridging: now.bridging,
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

		this.invalidate();
		const result = await this.options.runner.run(agentRemoveArguments(name), this.runOptions());
		if (!result.ok) {
			return { kind: 'failed', detail: explain(result) };
		}

		const after = await this.list();
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

function describeEditorAgentIssue(editorAgent: string, agents?: readonly AgentEntry[]): string | undefined {
	if (!isAgentName(editorAgent)) {
		return `entirely.editorHookAgent is invalid; use an agent name from 'entire agent list'`;
	}
	if (agents && !agents.some(agent => agent.name === editorAgent)) {
		return `entirely.editorHookAgent names '${editorAgent}', which 'entire agent list' does not list`;
	}
	if (editorAgent !== DEFAULT_EDITOR_HOOK_AGENT) {
		return `entirely.editorHookAgent names '${editorAgent}', but editor events currently use the '${DEFAULT_EDITOR_HOOK_AGENT}' payload format`;
	}
	return undefined;
}
