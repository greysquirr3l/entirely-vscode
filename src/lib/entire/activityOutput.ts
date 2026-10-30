import type { ActivityListing } from './activityFlags';

/** One figure from the headline row, such as `STREAK` and `3 days`. */
export interface ActivityStat {
	readonly label: string;
	readonly value: string;
	/** The CLI's own caption under the figure. It may be cut short. */
	readonly caption?: string;
}

export interface ActivityRepository {
	readonly name: string;
	readonly count?: number;
}

/** One session or commit in the recent list. */
export interface ActivityEntry {
	/** The line as the CLI printed it. */
	readonly text: string;
	/** A commit's short hash. */
	readonly id?: string;
	/** The commit's subject. The static view cuts long ones short. */
	readonly title?: string;
	readonly repo?: string;
	/** What the CLI printed after the repository: agent, size, checkpoint. */
	readonly detail?: string;
}

export interface ActivityGroup {
	/** The CLI's heading, such as a day with its count. Absent when the list has none. */
	readonly heading?: string;
	readonly entries: readonly ActivityEntry[];
}

/** The activity view as the CLI's static output describes it. */
export interface ActivityOverview {
	readonly listing: ActivityListing;
	readonly stats: readonly ActivityStat[];
	/** The contributions line, such as `2 checkpoints`. */
	readonly contributions?: string;
	readonly repositories: readonly ActivityRepository[];
	readonly groups: readonly ActivityGroup[];
}

export type ActivityReading =
	| { readonly kind: 'overview'; readonly overview: ActivityOverview }
	| { readonly kind: 'empty' }
	| { readonly kind: 'unreadable'; readonly detail: string };

// Escape sequences are removed before reading: a terminal program can
// colour even a piped stream when it is told to.
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** The text with terminal colour and cursor sequences taken out. */
export function stripTerminalCodes(text: string): string {
	return text.replace(ESCAPES, '').replace(/\r\n?/g, '\n');
}

const HEADING = /^(\S.*?)\s{2,}(\d[\d,]*)\s+(?:commits?|sessions?|checkpoints?)\s*$/i;

// A heading is a short label and a count. A row that ends in a count of its
// own, such as a commit with "1 checkpoint", has columns in it.
function isHeading(line: string): boolean {
	const match = HEADING.exec(line);
	return match !== null && !/\s{2,}/.test(match[1]) && !COMMIT.test(line);
}
const COMMIT = /^([0-9a-f]{7,40})\s+(.*?)\s+([\w.-]+\/[\w.-]+)(?:\s{2,}(.*))?$/;
const REPOSITORY = /^(\S+)\s+[^\p{L}\p{N}]*?(\d[\d,]*)\s*$/u;

function readStats(block: readonly string[]): ActivityStat[] {
	const [labels, values, captions] = block.map(line => line.split('│').map(part => part.trim()));
	if (!labels || !values) {
		return [];
	}
	const stats: ActivityStat[] = [];
	labels.forEach((label, index) => {
		const value = values[index];
		if (label.length > 0 && value !== undefined && value.length > 0) {
			const caption = captions?.[index];
			stats.push({ label, value, caption: caption && caption.length > 0 ? caption : undefined });
		}
	});
	return stats;
}

function readEntry(line: string): ActivityEntry {
	const commit = COMMIT.exec(line);
	if (!commit) {
		return { text: line };
	}
	return { text: line, id: commit[1], title: commit[2].trim(), repo: commit[3], detail: commit[4]?.trim() };
}

const isUpperLabel = (line: string): boolean => line.includes('│') && line === line.toUpperCase() && /[A-Z]/.test(line);

/**
 * Reads the text `entire activity` prints when it is not a terminal.
 *
 * The CLI offers no JSON for this view, so the text is read, and a line
 * that matches nothing known is kept as it was printed rather than
 * dropped or guessed at. The recent list is whatever follows the
 * repositories: a heading with a count starts a group, and anything
 * before the first heading is one group without a title. Output with
 * nothing recognisable in it is reported as unreadable, with its first
 * line, so a changed format is visible instead of showing an empty list.
 */
export function parseActivity(output: string, listing: ActivityListing): ActivityReading {
	const lines = stripTerminalCodes(output)
		.split('\n')
		.map(line => line.trimEnd());
	if (lines.every(line => line.trim().length === 0)) {
		return { kind: 'empty' };
	}

	let stats: ActivityStat[] = [];
	let contributions: string | undefined;
	const repositories: ActivityRepository[] = [];
	const groups: { heading?: string; entries: ActivityEntry[] }[] = [];
	let current: { heading?: string; entries: ActivityEntry[] } | undefined;
	let section: 'top' | 'repositories' | 'recent' = 'top';

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim().length === 0) {
			if (section === 'repositories') {
				section = 'recent';
			}
			continue;
		}

		if (section === 'top') {
			if (isUpperLabel(line) && stats.length === 0) {
				const block: string[] = [];
				while (index < lines.length && lines[index].trim().length > 0) {
					block.push(lines[index]);
					index += 1;
				}
				stats = readStats(block);
				continue;
			}
			const heading = /^CONTRIBUTIONS\s+(.+)$/.exec(line.trim());
			if (heading) {
				contributions = heading[1];
			} else if (line.trim() === 'REPOSITORIES') {
				section = 'repositories';
			} else if (isHeading(line)) {
				section = 'recent';
				index -= 1;
			}
			continue;
		}

		if (section === 'repositories') {
			const row = REPOSITORY.exec(line.trim());
			repositories.push(
				row ? { name: row[1], count: Number(row[2].replace(/,/g, '')) } : { name: line.trim() },
			);
			continue;
		}

		if (isHeading(line)) {
			current = { heading: line.trim(), entries: [] };
			groups.push(current);
			continue;
		}
		if (!current) {
			current = { entries: [] };
			groups.push(current);
		}
		current.entries.push(readEntry(line.trim()));
	}

	const recognised = stats.length > 0 || repositories.length > 0 || groups.length > 0 || contributions !== undefined;
	if (!recognised) {
		const first = lines.find(line => line.trim().length > 0) ?? '';
		return { kind: 'unreadable', detail: first.trim().slice(0, 200) };
	}
	return { kind: 'overview', overview: { listing, stats, contributions, repositories, groups } };
}

/** How many entries the recent list holds. */
export function countEntries(overview: ActivityOverview): number {
	return overview.groups.reduce((total, group) => total + group.entries.length, 0);
}
