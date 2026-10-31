import { decodeRecord, fields, optionalBoolean, type DecodeResult } from './decode';

/** One hook, MCP server or setting the reviewer would load. */
export interface ReviewConfigEntry {
	readonly agent?: string;
	/** Such as `hook` or `mcp`. */
	readonly kind?: string;
	readonly name?: string;
	/** Can hold shell text and paths: shown in a document, never in the output channel. */
	readonly command?: string;
	readonly source?: string;
	/** Whether the entry is Entire's own. */
	readonly entire?: boolean;
}

/** What `entire review --show-config --json` reported. */
export interface ReviewConfig {
	readonly target?: string;
	readonly head?: string;
	readonly commits?: number;
	/** Whether the reviewed commits were authored by the person. Absent when the CLI did not say. */
	readonly yours?: boolean;
	readonly entries: readonly ReviewConfigEntry[];
	readonly instructions: readonly string[];
	readonly isolatedAgents: readonly string[];
}

function text(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' ? value : undefined;
}

function strings(value: unknown): readonly string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function decodeReviewConfig(value: unknown): DecodeResult<ReviewConfig> {
	const record = decodeRecord(value, 'review config');
	if (!record.ok) {
		return record;
	}
	const read = fields(record.value, 'review config');
	const entries = Array.isArray(record.value.entries) ? record.value.entries : [];
	const commits = record.value.commits;
	return {
		ok: true,
		value: {
			target: text(record.value, 'target'),
			head: text(record.value, 'head'),
			commits: typeof commits === 'number' && Number.isFinite(commits) ? commits : undefined,
			yours: optionalBoolean(read, 'yours'),
			entries: entries.flatMap((entry): ReviewConfigEntry[] => {
				const item = decodeRecord(entry, 'entry');
				if (!item.ok) {
					return [];
				}
				return [
					{
						agent: text(item.value, 'agent'),
						kind: text(item.value, 'kind'),
						name: text(item.value, 'name'),
						command: text(item.value, 'command'),
						source: text(item.value, 'source'),
						entire: optionalBoolean(fields(item.value, 'entry'), 'entire'),
					},
				];
			}),
			instructions: strings(record.value.instructions),
			isolatedAgents: strings(record.value.isolated_agents),
		},
	};
}

/** How many hooks and MCP servers the reviewer would load. */
export function countLoaded(config: ReviewConfig): { readonly hooks: number; readonly mcpServers: number; readonly other: number } {
	let hooks = 0;
	let mcpServers = 0;
	let other = 0;
	for (const entry of config.entries) {
		if (entry.kind === 'hook') {
			hooks += 1;
		} else if (entry.kind === 'mcp') {
			mcpServers += 1;
		} else {
			other += 1;
		}
	}
	return { hooks, mcpServers, other };
}

function one(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** What the review would load, as a Markdown document. The commands are the CLI's text. */
export function describeReviewConfig(config: ReviewConfig): string {
	const counts = countLoaded(config);
	const out = ['# What a review would run', ''];
	out.push('Read from the Entire CLI. Nothing was checked out and no agent was started.', '');
	out.push(`- Target: ${config.target ? one(config.target) : 'not reported'}`);
	out.push(`- Head commit: ${config.head ? one(config.head) : 'not reported'}`);
	out.push(`- Commits in scope: ${config.commits ?? 'not reported'}`);
	out.push(
		`- Authored by you: ${config.yours === undefined ? 'not reported' : config.yours ? 'yes' : 'no. The reviewer would load code you did not write, and the CLI asks for approval in a terminal.'}`,
		'',
	);
	out.push(`## Loaded by the reviewer (${counts.hooks} hooks, ${counts.mcpServers} MCP servers${counts.other > 0 ? `, ${counts.other} other` : ''})`, '');
	if (config.entries.length === 0) {
		out.push('The CLI listed nothing to load.', '');
	}
	for (const entry of config.entries) {
		const head = [entry.agent, entry.kind, entry.name].filter((part): part is string => !!part).map(one).join(' / ');
		out.push(`- ${head || 'entry'}${entry.entire ? " (Entire's own)" : ''}`);
		if (entry.source) {
			out.push(`  - From: ${one(entry.source)}`);
		}
		if (entry.command) {
			out.push(`  - Command: \`${one(entry.command).replace(/`/g, "'")}\``);
		}
	}
	if (config.entries.length > 0) {
		out.push('');
	}
	out.push('## Instruction files', '');
	if (config.instructions.length === 0) {
		out.push('None reported.', '');
	}
	for (const file of config.instructions) {
		out.push(`- ${one(file)}`);
	}
	if (config.instructions.length > 0) {
		out.push('');
	}
	out.push('## Agents with their own configuration', '');
	if (config.isolatedAgents.length === 0) {
		out.push('None reported.');
	}
	for (const agent of config.isolatedAgents) {
		out.push(`- ${one(agent)}`);
	}
	return `${out.join('\n').trimEnd()}\n`;
}
