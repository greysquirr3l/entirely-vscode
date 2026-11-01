import * as fs from 'fs/promises';
import * as path from 'path';

import {
	agentSkillDocument,
	agentSkillPath,
	confirmAgentSkillOverwrite,
	type ControlConfirmation,
} from '../lib/entire';

/** What the install asks of the editor. */
export interface AgentSkillUi {
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
}

export interface AgentSkillDependencies {
	readonly ui: AgentSkillUi;
	/** The repository the skill is written into, when the editor has one open. */
	readonly repositoryRoot: () => string | undefined;
}

export type AgentSkillResult = 'installed' | 'present' | 'cancelled' | 'failed';

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Writes Entire's agent skill into the repository that is open.
 *
 * The skill is one file, `.github/skills/entire/SKILL.md`, and it tells
 * an agent working in the repository what Entire already knows: why a
 * line exists, what a previous agent did, and what a checkpoint changed.
 *
 * A file that is already there is the person's, so it is replaced only
 * when the person says so, and nothing else in the repository is
 * touched.
 */
export async function installAgentSkill(deps: AgentSkillDependencies): Promise<AgentSkillResult> {
	const { ui } = deps;
	const root = deps.repositoryRoot();
	if (root === undefined) {
		await ui.warn('Open the repository you want the agent skill in, and run this again.');
		return 'failed';
	}
	const target = agentSkillPath(root);
	const document = agentSkillDocument();
	try {
		const existing = await fs.lstat(target);
		if (existing.isSymbolicLink()) {
			await ui.warn(`${target} is a link, so it was not written.`);
			return 'failed';
		}
		if ((await fs.readFile(target, 'utf8')) === document) {
			await ui.inform(`The Entire agent skill is already in ${target}. Nothing was changed.`);
			return 'present';
		}
		if (!(await ui.confirm(confirmAgentSkillOverwrite(target)))) {
			await ui.inform(`${target} was left as it is.`);
			return 'cancelled';
		}
	} catch (error) {
		if (!isAbsent(error)) {
			await ui.warn(`${target} could not be read: ${message(error)}.`);
			return 'failed';
		}
	}
	try {
		const folder = path.dirname(target);
		await fs.mkdir(folder, { recursive: true });
		if (!(await inside(root, folder))) {
			await ui.warn(`${folder} leads outside the repository, so the skill was not written.`);
			return 'failed';
		}
		await fs.writeFile(target, document, 'utf8');
	} catch (error) {
		await ui.warn(`${target} could not be written: ${message(error)}.`);
		return 'failed';
	}
	await ui.inform(
		`The Entire agent skill was written to ${target}. An agent working in this repository can now read the history of it: why a line exists, what a previous agent did, and what a checkpoint changed.`,
	);
	return 'installed';
}

/** Whether an error means the file is not there. */
function isAbsent(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

/** Whether a folder is inside the repository it is meant to belong to. */
async function inside(root: string, folder: string): Promise<boolean> {
	try {
		const realRoot = await fs.realpath(root);
		const realFolder = await fs.realpath(folder);
		const relative = path.relative(realRoot, realFolder);
		return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
	} catch {
		return false;
	}
}
