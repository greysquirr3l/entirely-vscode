/**
 * Reads the raw transcript `entire session info --transcript` streams.
 *
 * The CLI hands the transcript over in the agent's own format and says the
 * format depends on the agent. This reader knows the shapes of the agents
 * the CLI ships: the line-per-event JSON of Claude Code and Cursor, Codex's
 * response items and Copilot's events. A line it does not recognise is
 * counted and skipped, never guessed at.
 */

/** Who said a message. */
export type TranscriptRole = 'user' | 'assistant';

/** One thing that happened in the session. */
export type TranscriptItem =
	| { readonly kind: 'message'; readonly role: TranscriptRole; readonly text: string }
	| { readonly kind: 'tool'; readonly name: string; readonly hint?: string };

/** A transcript, read. */
export interface Transcript {
	readonly items: readonly TranscriptItem[];
	/** Lines that were not JSON, or were JSON in a shape this reader does not know. */
	readonly skippedLines: number;
}

/** How many times a tool was called. */
export interface ToolCallCount {
	readonly name: string;
	readonly count: number;
}

/** The longest hint a tool call carries. */
const MAX_HINT_LENGTH = 120;

/** Argument names whose value says best what a tool call was about, in order. */
const HINT_KEYS = ['file_path', 'path', 'command', 'cmd', 'pattern', 'query', 'url', 'description'];

/** Lines read between yields to the event loop. */
const DEFAULT_YIELD_EVERY = 2000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Cuts a value to one short line. */
function shorten(value: string): string {
	const line = value.split(/\r?\n/, 1)[0].trim();
	return line.length <= MAX_HINT_LENGTH ? line : `${line.slice(0, MAX_HINT_LENGTH - 1)}…`;
}

/**
 * Picks the argument that says what a tool call was about.
 *
 * Only one short line is kept. Arguments can hold whole files, and the
 * transcript view lists calls rather than reproducing them.
 */
function hintFor(args: unknown): string | undefined {
	let record = args;
	if (typeof record === 'string') {
		try {
			record = JSON.parse(record) as unknown;
		} catch {
			return undefined;
		}
	}
	if (!isRecord(record)) {
		return undefined;
	}

	for (const key of HINT_KEYS) {
		const value = asString(record[key]);
		if (value && value.trim().length > 0) {
			return shorten(value);
		}
	}
	return undefined;
}

function toolItem(name: unknown, args: unknown): TranscriptItem | undefined {
	const label = asString(name);
	if (!label || label.length === 0) {
		return undefined;
	}
	return { kind: 'tool', name: label, hint: hintFor(args) };
}

function asRole(value: unknown): TranscriptRole | undefined {
	return value === 'user' || value === 'assistant' ? value : undefined;
}

/** Reads a message body that is a string or a list of content blocks. */
function readContent(content: unknown, role: TranscriptRole): TranscriptItem[] {
	if (typeof content === 'string') {
		return content.trim().length > 0 ? [{ kind: 'message', role, text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [];
	}

	const items: TranscriptItem[] = [];
	for (const block of content) {
		if (!isRecord(block)) {
			continue;
		}
		const type = asString(block.type);
		const text = asString(block.text);
		if ((type === 'text' || type === 'input_text' || type === 'output_text') && text) {
			if (text.trim().length > 0) {
				items.push({ kind: 'message', role, text });
			}
		} else if (type === 'tool_use') {
			const tool = toolItem(block.name, block.input);
			if (tool) {
				items.push(tool);
			}
		}
	}
	return items;
}

/** Copilot CLI events. */
function readCopilot(event: JsonRecord): TranscriptItem[] | undefined {
	const type = asString(event.type);
	if (type !== 'user.message' && type !== 'assistant.message') {
		return undefined;
	}
	const data = isRecord(event.data) ? event.data : {};
	const role: TranscriptRole = type === 'user.message' ? 'user' : 'assistant';

	const items = readContent(data.content, role);
	if (Array.isArray(data.toolRequests)) {
		for (const request of data.toolRequests) {
			if (isRecord(request)) {
				const tool = toolItem(request.name, request.arguments);
				if (tool) {
					items.push(tool);
				}
			}
		}
	}
	return items;
}

/** Codex response items. */
function readCodex(event: JsonRecord): TranscriptItem[] | undefined {
	if (event.type !== 'response_item' || !isRecord(event.payload)) {
		return undefined;
	}
	const payload = event.payload;
	const type = asString(payload.type);

	if (type === 'message') {
		const role = asRole(payload.role);
		return role ? readContent(payload.content, role) : [];
	}
	if (type === 'function_call') {
		const tool = toolItem(payload.name, payload.arguments);
		return tool ? [tool] : [];
	}
	return [];
}

/** Claude Code and Cursor: a role, and a message of content blocks. */
function readMessageEvent(event: JsonRecord): TranscriptItem[] | undefined {
	const message = isRecord(event.message) ? event.message : undefined;
	const role = asRole(message?.role) ?? asRole(event.role) ?? asRole(event.type);
	if (!role || !message) {
		return undefined;
	}
	return readContent(message.content, role);
}

/** Reads one parsed line. Undefined means the line is not a shape this reader knows. */
function readEvent(event: unknown): TranscriptItem[] | undefined {
	if (!isRecord(event)) {
		return undefined;
	}
	return readCopilot(event) ?? readCodex(event) ?? readMessageEvent(event);
}

/** Gives the event loop a turn. */
function yieldToEventLoop(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

export interface ParseOptions {
	/** How many lines to read before yielding to the event loop. */
	readonly yieldEvery?: number;
}

/**
 * Reads a transcript.
 *
 * A transcript can run to megabytes, and the extension host also runs the
 * editor's other extensions, so the reading yields to the event loop every
 * few thousand lines instead of holding it for the whole payload.
 */
export async function parseTranscript(text: string, options: ParseOptions = {}): Promise<Transcript> {
	const yieldEvery = Math.max(1, options.yieldEvery ?? DEFAULT_YIELD_EVERY);
	const items: TranscriptItem[] = [];
	let skippedLines = 0;
	let sinceYield = 0;
	let start = 0;

	while (start < text.length) {
		let end = text.indexOf('\n', start);
		if (end === -1) {
			end = text.length;
		}
		const line = text.slice(start, end).trim();
		start = end + 1;

		if (line.length === 0) {
			continue;
		}

		let event: unknown;
		try {
			event = JSON.parse(line) as unknown;
		} catch {
			skippedLines++;
			continue;
		}

		const read = readEvent(event);
		if (read) {
			items.push(...read);
		} else {
			skippedLines++;
		}

		if (++sinceYield >= yieldEvery) {
			sinceYield = 0;
			await yieldToEventLoop();
		}
	}

	return { items, skippedLines };
}

/** The tool calls in a transcript, counted by tool, most used first. */
export function countToolCalls(items: readonly TranscriptItem[]): ToolCallCount[] {
	const counts = new Map<string, number>();
	for (const item of items) {
		if (item.kind === 'tool') {
			counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
		}
	}

	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
