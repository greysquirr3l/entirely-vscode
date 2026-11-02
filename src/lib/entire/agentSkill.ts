import * as path from 'path';

import type { ControlConfirmation } from './controlPlaneActions';

/**
 * The skill that tells an agent what Entire already knows.
 *
 * It is written into a repository as `.github/skills/entire/SKILL.md`, so
 * an agent working there can reach the recorded history of the work: why
 * a line exists, what a previous agent did, what a checkpoint changed,
 * and whether the work at hand has been done before.
 */

/** The skill's name, which is also the folder it lives in. */
export const AGENT_SKILL_NAME = 'entire';

/** Where the skill is written, relative to the repository root. */
export const AGENT_SKILL_RELATIVE_PATH = `.github/skills/${AGENT_SKILL_NAME}/SKILL.md`;

/**
 * The description the agent sees before it opens the skill.
 *
 * It is the discovery surface, so it names the things that should bring
 * the skill up: the history of this repository, and the questions about
 * it that a person or another agent will ask.
 */
export const AGENT_SKILL_DESCRIPTION =
	'Use when: working in a repository that Entire tracks and the answer may already be in its history — why a line exists, ' +
	'what a previous agent did, what a checkpoint changed, whether the task at hand was done before. Also use when asked ' +
	'what Entire recorded, what an earlier session did, or to search past work and code.';

/**
 * The skill's own text.
 *
 * It names commands and never flags: the CLI describes its own flags,
 * and the agent is told to read them rather than to guess them. The
 * command list comes from the CLI's own orientation, which every
 * installation prints, so the skill stays true as the CLI changes.
 */
export function agentSkillDocument(): string {
	return [
		'---',
		`name: ${AGENT_SKILL_NAME}`,
		`description: '${AGENT_SKILL_DESCRIPTION}'`,
		'---',
		'',
		'# Entire: the history this repository already has',
		'',
		'Entire records what coding agents did, freezes each piece of work into a checkpoint, and',
		'publishes it. In a repository it tracks, the record of earlier work is already here. Read it',
		'before you write, and before you repeat something.',
		'',
		'## Start with the map',
		'',
		'```',
		'entire agent-help',
		'```',
		'',
		'That prints the commands that bear on the work, marks the ones that only read, and separates',
		'out the ones that belong to the person. It is the CLI describing itself, so it is true of the',
		'version installed here rather than of this file.',
		'',
		"Read a command's own flags from the CLI, never from memory and never from this file:",
		'',
		'```',
		'entire agent-help <command>',
		'```',
		'',
		'## Read before you write',
		'',
		'| Question | Command |',
		'|---|---|',
		'| Why is this line like this? | `entire why <file>:<line>` |',
		'| Has this been done before? | `entire search "<your own words>"` |',
		'| What did that checkpoint change? | `entire checkpoint explain <id>` |',
		'| What did that session do? | `entire session info` |',
		'| What is recorded on this branch? | `entire checkpoint list` |',
		'',
		'`entire search` matches semantically and by keyword over checkpoints, commits and sessions.',
		'`entire why` gives the commit, the checkpoint, the prompt and the session behind a line, which',
		'is usually enough to settle a question about code you did not write.',
		'',
		'Give every command `--json` when you intend to read the answer. For a search,',
		'`entire search "<query>" --compact` returns a trimmed shape meant for an agent: the id, the type,',
		'the branch, the author, the date, the files touched, a score and a snippet. Fetch the full',
		'detail of one hit with `entire checkpoint explain <id>`.',
		'',
		'## The editor already reported your work',
		'',
		'When the editor has the compatible agent integration installed, the editor reports your',
		'activity to Entire itself. Do not run `entire hooks` by hand: it would report the same events',
		'twice.',
		'',
		'That integration is Entirely, the Visual Studio Code extension for Entire. It shows the same',
		'sessions, checkpoints and trails beside the editor, and it is where the person configures',
		'and cleans up.',
		'',
		"## What is yours, and what is the person's",
		'',
		'Everything in this skill only reads. The commands that change something belong to the',
		'person: `entire agent-help` lists them under "the user\'s — suggest, don\'t run", and that',
		'list is the one to go by, not this file. Suggest them, in plain words, and let them run',
		'them.',
		'',
		'Nothing else is needed to record your work. A checkpoint is written for the commit that',
		'carries it, so there is nothing to save and nothing to submit.',
		'',
	].join('\n');
}

/** Where the skill lives in a repository. */
export function agentSkillPath(repositoryRoot: string): string {
	return path.join(repositoryRoot, ...AGENT_SKILL_RELATIVE_PATH.split('/'));
}

/**
 * The question asked before a skill that is already there is replaced.
 *
 * The file is in the repository, so it may be the person's own work; the
 * question says what will happen to it.
 */
export function confirmAgentSkillOverwrite(target: string): ControlConfirmation {
	return {
		// The path is in the message, which VS Code shows as plain text.
		// The detail is rendered as Markdown, and a path in it would be
		// read as Markdown rather than as a path.
		message: `Replace the file at ${target}?`,
		detail:
			'A file is already there, and it is not the one this extension writes. ' +
			'Replacing it overwrites that file and nothing else. The repository is not changed in any other way.',
		action: 'Replace',
	};
}
