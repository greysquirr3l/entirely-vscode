/** Reads docs/coverage.md into rows the coverage tests can check. */

export const STATUSES = ['Supported', 'Excluded', 'Gap'] as const;
export type CoverageStatus = (typeof STATUSES)[number];

export interface MatrixRow {
	/** The first cell without its backticks, e.g. `entire trail merge` or `--context and ENTIRE_CONTEXT`. */
	readonly command: string;
	readonly status: string;
	readonly evidence: string;
	readonly notes: string;
}

export interface SurfaceRow {
	/** The invocation without backticks, e.g. `entire session list`. */
	readonly command: string;
	readonly callers: readonly string[];
}

export interface Coverage {
	readonly totals: { readonly rows: number; readonly supported: number; readonly excluded: number; readonly gap: number } | undefined;
	readonly surface: readonly SurfaceRow[];
	readonly matrix: readonly MatrixRow[];
}

/** Splits a table row. No cell in the document holds a pipe. */
function cells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map(cell => cell.trim());
}

function backticked(text: string): string[] {
	return [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);
}

function tableRows(section: string): string[][] {
	return section
		.split('\n')
		.filter(line => line.startsWith('| `'))
		.map(cells);
}

function sectionStarting(text: string, heading: string): string {
	const parts = text.split(/\n(?=## )/);
	return parts.find(part => part.startsWith(`## ${heading}`)) ?? '';
}

/** Parses the totals line, the CLI surface table and the matrix tables. */
export function parseCoverage(text: string): Coverage {
	const totalsLine = /\*\*Totals\.\*\* Rows: (\d+) \(supported (\d+), excluded (\d+), gap (\d+)\)/.exec(text);
	const totals = totalsLine
		? {
				rows: Number(totalsLine[1]),
				supported: Number(totalsLine[2]),
				excluded: Number(totalsLine[3]),
				gap: Number(totalsLine[4]),
			}
		: undefined;

	const surface = tableRows(sectionStarting(text, '1. ')).map(row => ({
		command: backticked(row[0])[0] ?? '',
		callers: backticked(row[1] ?? ''),
	}));

	const matrix = tableRows(sectionStarting(text, '2. ')).map(row => ({
		command: backticked(row[0]).join(' and '),
		status: row[1] ?? '',
		evidence: row[2] ?? '',
		notes: row[3] ?? '',
	}));

	return { totals, surface, matrix };
}

/** Counts matrix rows by status. */
export function countStatuses(rows: readonly MatrixRow[]): { supported: number; excluded: number; gap: number } {
	const count = (status: CoverageStatus): number => rows.filter(row => row.status === status).length;
	return {
		supported: count('Supported'),
		excluded: count('Excluded'),
		gap: count('Gap'),
	};
}

/**
 * The command paths in `entire help -t` that have no subcommand of their own.
 * Interior nodes (`trail`, `org grant`) are groups, not commands.
 */
export function leafCommands(tree: string): string[] {
	const stack: string[] = [];
	const paths: string[] = [];
	for (const line of tree.split('\n').slice(1)) {
		const match = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+)/.exec(line);
		if (!match) {
			continue;
		}
		const depth = match[1].length / 4;
		stack.length = depth;
		stack[depth] = match[2];
		paths.push(stack.slice(0, depth + 1).join(' '));
	}
	return paths.filter((path, index) => !(paths[index + 1] ?? '').startsWith(`${path} `));
}
