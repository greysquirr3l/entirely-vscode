import { END_OF_OPTIONS } from './operand';
import { findFlag, flagsOf, type LifecyclePlan } from './sessionLifecycle';
import type { HelpFlag } from './search';

/** One agent integration the CLI knows, and whether this repository has it installed. */
export interface AgentEntry {
	readonly name: string;
	readonly installed: boolean;
}

/**
 * A name the CLI can be given as an agent.
 *
 * The CLI owns the names, so this only keeps a value from being read as a
 * flag or split into two arguments. It does not say which names exist.
 */
export function isAgentName(value: string): boolean {
	return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
}

/**
 * Reads `entire agent list`.
 *
 * The output is a heading, then one agent per line, with a tick in front of
 * the installed ones. Lines that are not an agent (a note after the list, a
 * format the CLI adds later) are skipped rather than failing the whole
 * list, and a list with no tick marks everything as not installed. Returns
 * undefined only when the heading is missing, so a CLI that changes the
 * format is reported as unreadable rather than as an empty list.
 */
export function parseAgentList(stdout: string): readonly AgentEntry[] | undefined {
	const lines = stdout.split('\n');
	const heading = lines.findIndex(line => /^agents:\s*$/i.test(line.trim()));
	if (heading === -1) {
		return undefined;
	}

	const entries: AgentEntry[] = [];
	for (const line of lines.slice(heading + 1)) {
		if (line.trim().length === 0) {
			if (entries.length > 0) {
				break;
			}
			continue;
		}
		const match = /^\s*(✓)?\s*(\S+)\s*$/.exec(line);
		if (match && isAgentName(match[2])) {
			entries.push({ name: match[2], installed: match[1] !== undefined });
		}
	}
	return entries;
}

/** What installing an agent can take from the help of `agent add`. */
export interface AgentAddFlags {
	/** Reinstalls hooks that are already present, when the CLI offers it. */
	readonly reinstall?: string;
}

/**
 * Finds the reinstall flag by what its help line says.
 *
 * It is optional: a CLI without one simply is not offered a reinstall.
 */
export function planAgentAddFlags(help: string, fallback: readonly HelpFlag[] = []): LifecyclePlan<AgentAddFlags> {
	const flag = findFlag(flagsOf(help, fallback), /\breinstall\b/i);
	return flag ? { ok: true, reinstall: flag.name } : { ok: true };
}

/** The arguments of `agent add <name>`, with an optional reinstall. */
export function agentAddArguments(name: string, reinstall?: string): readonly string[] {
	return reinstall === undefined
		? ['agent', 'add', END_OF_OPTIONS, name]
		: ['agent', 'add', reinstall, END_OF_OPTIONS, name];
}

/** The arguments of `agent remove <name>`. */
export function agentRemoveArguments(name: string): readonly string[] {
	return ['agent', 'remove', END_OF_OPTIONS, name];
}

/**
 * The files the CLI says to commit.
 *
 * After an install it lists, under a line about committing them, the files
 * to add to the repository. That list covers every integration's files in
 * the repository, not only the one just installed, so it is shown as the
 * CLI's own list. Nothing is listed when the CLI does not say.
 */
export function readWrittenFiles(output: string): readonly string[] {
	const lines = output.split('\n');
	const header = lines.findIndex(line => /commit these files/i.test(line));
	if (header === -1) {
		return [];
	}
	const files: string[] = [];
	for (const line of lines.slice(header + 1)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			break;
		}
		if (/^\.?[\w./@-]+$/.test(trimmed) && !trimmed.includes('..')) {
			files.push(trimmed);
		}
	}
	return files;
}
