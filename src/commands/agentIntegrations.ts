import { describeSupport } from '../lib/entire';
import type { AgentIntegrationSource, AgentListing, AgentOutcome } from '../services/agentIntegrations';

/** What the person is asked to agree to. */
export interface AgentConfirmation {
	readonly message: string;
	readonly detail: string;
	readonly action: string;
}

/** What can be done to an agent from the list. */
export type AgentAction = 'install' | 'reinstall' | 'remove';

/** The questions and answers of the agent setup command. */
export interface AgentUi {
	chooseAgent(agents: readonly AgentListing[]): Promise<AgentListing | undefined>;
	/** For an installed agent: remove it, or reinstall when the CLI offers that. */
	chooseAction(agent: AgentListing, canReinstall: boolean): Promise<AgentAction | undefined>;
	/** True only when the person chose to go ahead. */
	confirm(prompt: AgentConfirmation): Promise<boolean>;
	withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
}

/** What the command needs. */
export interface AgentDependencies {
	readonly agents: AgentIntegrationSource;
	readonly ui: AgentUi;
	/** Re-reads the views that depend on the installed agents. */
	readonly refresh: () => Promise<void>;
	/** True while a change is running, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

/** How the command ended. */
export type AgentResult = 'cancelled' | 'failed' | 'installed' | 'removed';

const sharedRunning = { active: false };

/** The other installed agents, which a change leaves as they are. */
function othersOf(agent: AgentListing, all: readonly AgentListing[]): string {
	const others = all.filter(other => other.installed && other.name !== agent.name).map(other => other.name);
	return others.length > 0 ? `${others.join(', ')} stay installed and are not touched.` : 'No other agent is installed.';
}

/** What an install is about to do to the workspace, in words. */
export function installConfirmation(agent: AgentListing, all: readonly AgentListing[], reinstall: boolean): AgentConfirmation {
	return {
		message: `${reinstall ? 'Reinstall' : 'Install'} the ${agent.name} integration in this workspace?`,
		detail:
			`Entire will write the hook configuration for ${agent.name} into this repository, and may create or update ` +
			"Entire's own settings in .entire/. It lists the files to commit when it finishes; nothing is committed " +
			`for you. ${othersOf(agent, all)}`,
		action: reinstall ? 'Reinstall' : 'Install',
	};
}

/** What a removal is about to do, in words. */
export function removeConfirmation(agent: AgentListing, all: readonly AgentListing[]): AgentConfirmation {
	return {
		message: `Remove the ${agent.name} integration from this workspace?`,
		detail:
			`Entire will take its hooks for ${agent.name} out of this repository's configuration. Sessions already ` +
			`recorded stay in the history. ${othersOf(agent, all)}`,
		action: 'Remove',
	};
}

/**
 * Lists the agents the CLI supports, and installs or removes one.
 *
 * The list is the CLI's own. Nothing changes until the person has agreed to
 * a message that says what will be touched, a declined change runs nothing,
 * and the result is what the CLI reported, checked against a fresh list.
 * Installing one agent never removes another: more than one can be installed.
 */
export async function manageAgents(deps: AgentDependencies): Promise<AgentResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.inform('An agent change is already running.');
		return 'cancelled';
	}
	running.active = true;
	try {
		return await run(deps);
	} finally {
		running.active = false;
	}
}

async function run(deps: AgentDependencies): Promise<AgentResult> {
	const { agents, ui } = deps;

	const listed = await agents.list();
	if (!listed.ok) {
		await ui.warn(`Cannot list the agents: ${listed.detail}.`);
		return 'failed';
	}
	const agent = await ui.chooseAgent(listed.agents);
	if (!agent) {
		return 'cancelled';
	}

	let action: AgentAction | undefined = 'install';
	if (agent.installed) {
		action = await ui.chooseAction(agent, await agents.canReinstall());
		if (!action) {
			return 'cancelled';
		}
	}

	const prompt = action === 'remove' ? removeConfirmation(agent, listed.agents) : installConfirmation(agent, listed.agents, action === 'reinstall');
	if (!(await ui.confirm(prompt))) {
		return 'cancelled';
	}

	const verb = action === 'remove' ? 'Removing' : 'Installing';
	const outcome = await ui.withProgress(`${verb} ${agent.name}…`, () =>
		action === 'remove' ? agents.remove(agent.name) : agents.install(agent.name, action === 'reinstall'),
	);
	await deps.refresh();

	if (outcome.kind === 'failed') {
		await ui.warn(`Could not ${action === 'remove' ? 'remove' : 'install'} ${agent.name}: ${outcome.detail}.`);
		return 'failed';
	}
	await ui.inform(describeOutcome(agent.name, action, outcome));
	return action === 'remove' ? 'removed' : 'installed';
}

/** The message after a change the CLI reported as done. */
export function describeOutcome(name: string, action: AgentAction, outcome: Extract<AgentOutcome, { kind: 'done' }>): string {
	if (action === 'remove') {
		return `${name} was removed. ${outcome.summary}`.trim();
	}
	const files = outcome.files.length > 0 ? ` Entire lists these files to commit so the integration works across clones: ${outcome.files.join(', ')}.` : '';
	const support = outcome.support ? ` ${describeSupport(outcome.support)}` : '';
	return `${name} is installed.${files}${support}`;
}
