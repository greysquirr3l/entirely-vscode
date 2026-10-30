import { cleanCliText, findFlag, flagsOf } from './sessionLifecycle';
import { isSessionId } from './sessionInfo';
import type { HelpFlag } from './search';
import { pluralise } from './text';

/** The flags an import needs, or why they could not be found. */
export type ImportPlan =
	| {
			readonly ok: true;
			/** Reports what would be imported without writing. */
			readonly dryRun: string;
			/** Narrows the import to one session; may be repeated. Absent if the help offers none. */
			readonly session?: string;
	  }
	| { readonly ok: false; readonly detail: string };

/**
 * Finds the preview and session flags from the command's help.
 *
 * A flag is chosen by what its help line says. The preview flag is required:
 * without one the extension has no read-only way to say what an import would
 * do, and it will not import blind.
 */
export function planImportFlags(help: string, fallback: readonly HelpFlag[] = []): ImportPlan {
	const flags = flagsOf(help, fallback);
	const dryRun = findFlag(flags, /\bwithout writing\b|\bwould be imported\b/i);
	if (!dryRun) {
		return {
			ok: false,
			detail: 'this version of the Entire CLI cannot preview an import, so the extension will not run one; update the CLI',
		};
	}
	const session = findFlag(flags, /\bonly\b.*\bsession/i, [dryRun]);
	return { ok: true, dryRun: dryRun.name, session: session?.name };
}

/**
 * The agents `entire import` offers, read from its help.
 *
 * They are the subcommands listed under "Available Commands"; the extension
 * names none of them.
 */
export function readImportAgents(help: string): readonly string[] {
	const agents: string[] = [];
	let inSection = false;
	for (const line of help.split('\n')) {
		if (/^Available Commands:\s*$/i.test(line)) {
			inSection = true;
			continue;
		}
		if (!inSection) {
			continue;
		}
		const row = /^\s+([a-z][a-z0-9-]{0,40})\s+\S/.exec(line);
		if (row) {
			if (row[1] !== 'help' && row[1] !== 'completion') {
				agents.push(row[1]);
			}
			continue;
		}
		if (line.trim() === '') {
			break;
		}
	}
	return agents;
}

/** What to import: one agent's history, optionally narrowed to some sessions. */
export interface ImportScope {
	readonly agent: string;
	readonly sessionIds: readonly string[];
}

/** Whether a name is an agent the CLI listed, and shaped like a subcommand. */
export function isImportAgent(agent: string, known: readonly string[]): boolean {
	return /^[a-z][a-z0-9-]{0,40}$/.test(agent) && known.includes(agent);
}

/** The most sessions one import is narrowed to. */
export const MAX_IMPORT_SESSIONS = 50;

/** Reads session ids typed as a list; undefined if any is not an id the CLI can be given. */
export function parseSessionIds(text: string): readonly string[] | undefined {
	const ids = text
		.split(/[\s,]+/)
		.map(part => part.trim())
		.filter(part => part.length > 0);
	if (ids.length === 0 || ids.length > MAX_IMPORT_SESSIONS || !ids.every(isSessionId)) {
		return undefined;
	}
	return [...new Set(ids)];
}

/** `entire import <agent> [--dry-run] [--session=ID ...]`. */
export function importArguments(
	plan: Extract<ImportPlan, { ok: true }>,
	scope: ImportScope,
	dryRun: boolean,
): readonly string[] {
	const args = ['import', scope.agent];
	if (dryRun) {
		args.push(plan.dryRun);
	}
	if (plan.session !== undefined) {
		for (const id of scope.sessionIds) {
			// The value is joined to the flag because nothing can follow `--` as a value.
			args.push(`${plan.session}=${id}`);
		}
	}
	return args;
}

/** The counts the CLI reports for a preview or a finished import. */
export interface ImportCounts {
	readonly turns: number;
	readonly sessions: number;
	readonly alreadyImported: number;
}

/**
 * Reads the CLI's summary line: `N turn(s) from M session(s) (K already imported)`.
 *
 * The line is prose, not JSON; the import command has no machine format.
 * Undefined when the summary is not found, so the caller shows the CLI's own
 * words rather than guessing counts.
 */
export function readImportCounts(text: string): ImportCounts | undefined {
	const main = /\b(\d+)\s+turns?(?:\(s\))?\s+from\s+(\d+)\s+sessions?(?:\(s\))?/i.exec(text);
	if (!main) {
		return undefined;
	}
	const already = /\((\d+)\s+already imported\)/i.exec(text);
	return {
		turns: Number(main[1]),
		sessions: Number(main[2]),
		alreadyImported: already ? Number(already[1]) : 0,
	};
}

/** What the CLI says an import would do. */
export interface ImportPreview {
	/** The CLI's own report, cleaned for display. */
	readonly text: string;
	readonly counts?: ImportCounts;
	/** True only when the CLI reported a count and it was zero turns. */
	readonly nothingToImport: boolean;
}

/** Builds the preview from the CLI's output; the summary is on stdout, progress may be on stderr. */
export function readImportPreview(stdout: string, stderr: string): ImportPreview {
	const text = cleanCliText([stdout, stderr].filter(part => part.trim().length > 0).join('\n'));
	const counts = readImportCounts(text);
	return { text, counts, nothingToImport: counts !== undefined && counts.turns === 0 };
}

/** The sentence an import's outcome is reported in. */
export function describeImportResult(agent: string, text: string): string {
	const counts = readImportCounts(text);
	if (!counts) {
		return `The Entire CLI finished the ${agent} import and said: ${cleanCliText(text, 400)}`;
	}
	const already = counts.alreadyImported > 0 ? ` (${counts.alreadyImported} already imported)` : '';
	return `Imported ${pluralise(counts.turns, 'turn')} from ${pluralise(counts.sessions, 'session')}${already}. They are read-only.`;
}

/** How an import ended. */
export type ImportOutcome =
	| { readonly kind: 'done'; readonly text: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };
