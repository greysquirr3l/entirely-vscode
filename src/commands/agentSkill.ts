import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
	agentSkillDocument,
	agentSkillPath,
	confirmAgentSkillOverwrite,
	type ControlConfirmation,
} from '../lib/entire';
import { openRegularFile } from '../services/openRegularFile';

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

	// The file is opened once and read from that handle, so a link at its
	// place cannot be swapped for something else between the check and
	// the read.
	const existing = await openRegularFile(target);
	switch (existing.kind) {
		case 'ok': {
			let text: string;
			try {
				text = await existing.handle.readFile({ encoding: 'utf8' });
			} catch (error) {
				await ui.warn(`${target} could not be read: ${message(error)}.`);
				return 'failed';
			} finally {
				await existing.handle.close().catch(() => undefined);
			}
			if (text === document) {
				await ui.inform(`The Entire agent skill is already in ${target}. Nothing was changed.`);
				return 'present';
			}
			if (!(await ui.confirm(confirmAgentSkillOverwrite(target)))) {
				await ui.inform(`${target} was left as it is.`);
				return 'cancelled';
			}
			break;
		}
		case 'link':
			await ui.warn(`${target} is a link, so it was left alone.`);
			return 'failed';
		case 'not-file':
			await ui.warn(`${target} is not a file, so it was left alone.`);
			return 'failed';
		case 'error':
			await ui.warn(`${target} could not be read: ${existing.detail}.`);
			return 'failed';
		case 'absent':
			break;
	}

	const folder = path.dirname(target);
	// The folders are made one at a time, and a folder that is a link is
	// never descended into: a repository whose `.github` leads out of it
	// must not gain folders outside itself.
	if (!(await makeFolders(root, folder))) {
		await ui.warn(`${folder} leads outside the repository, so the skill was not written.`);
		return 'failed';
	}
	if (!(await inside(root, folder))) {
		await ui.warn(`${folder} leads outside the repository, so the skill was not written.`);
		return 'failed';
	}
	// The file is written beside the target and renamed over it, so a
	// failure leaves the original as it was and a link in its place is
	// replaced rather than followed.
	const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
	try {
		await fs.writeFile(temporary, document, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
		await fs.rename(temporary, target);
	} catch (error) {
		await fs.rm(temporary, { force: true });
		await ui.warn(`${target} could not be written: ${message(error)}.`);
		return 'failed';
	}
	await ui.inform(
		`The Entire agent skill was written to ${target}. An agent working in this repository can now read the history of it: why a line exists, what a previous agent did, and what a checkpoint changed.`,
	);
	return 'installed';
}

/**
 * Makes the folders a path needs, one at a time.
 *
 * Each folder that is already there is looked at without following a
 * link: a folder that is a link is refused rather than descended into,
 * because a link can lead anywhere, and a link that leads out of the
 * repository is how a write would end up outside it. Each folder that is
 * missing is made on its own and looked at again, so a link that appears
 * in place of the folder is caught before anything is written into it.
 */
async function makeFolders(root: string, folder: string): Promise<boolean> {
	const relative = path.relative(root, folder);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return false;
	}
	let current = root;
	for (const part of relative.split(path.sep).filter(part => part.length > 0)) {
		current = path.join(current, part);
		const existing = await lstat(current);
		if (existing === 'link') {
			return false;
		}
		if (existing === 'folder') {
			continue;
		}
		if (existing !== 'absent') {
			return false;
		}
		try {
			await fs.mkdir(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				return false;
			}
		}
		if ((await lstat(current)) !== 'folder') {
			return false;
		}
	}
	return true;
}

/** What a folder's place holds, looked at without following a link. */
async function lstat(folder: string): Promise<'folder' | 'link' | 'other' | 'absent'> {
	try {
		const info = await fs.lstat(folder);
		if (info.isSymbolicLink()) {
			return 'link';
		}
		return info.isDirectory() ? 'folder' : 'other';
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'other';
	}
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
