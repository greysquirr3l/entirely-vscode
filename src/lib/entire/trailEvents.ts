/**
 * What the extension reads from `trail watch`.
 *
 * The CLI's help lists the events it emits (`ready`, a domain event name,
 * `reconnect`, `forbidden`, `error`) and says that its JSON flag prints
 * each event as a single JSON line. It does not say which key holds the
 * event's name, and no recording of a live stream was available when this
 * was written. So the reader looks for a string under `event`, then
 * `type`, then `event_type`, and a line it cannot read counts as some
 * event. A payload is never kept or shown: it can carry review text, and
 * only the kind of the event and its name are read.
 */

/** What kind of thing a line of the stream said. */
export type WatchEventKind = 'ready' | 'event' | 'reconnect' | 'forbidden' | 'error' | 'ping';

/** One line of the stream, reduced to what the extension uses. */
export interface WatchEvent {
	readonly kind: WatchEventKind;
	/** The event's name, when the line carried one. */
	readonly name?: string;
}

const NAME_KEYS = ['event', 'type', 'event_type'] as const;

const KINDS: Readonly<Record<string, WatchEventKind>> = {
	ready: 'ready',
	reconnect: 'reconnect',
	forbidden: 'forbidden',
	error: 'error',
	ping: 'ping',
	keepalive: 'ping',
};

function kindOf(name: string): WatchEventKind {
	return KINDS[name.trim().toLowerCase()] ?? 'event';
}

function nameIn(record: Record<string, unknown>): string | undefined {
	for (const key of NAME_KEYS) {
		const value = record[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * Reads one line of the stream.
 *
 * A blank line says nothing and gives nothing. A line that is JSON with a
 * name is classified by the name; JSON without one, or text the extension
 * does not know, is some event, because the stream only speaks when
 * something happened.
 */
export function parseWatchLine(line: string): WatchEvent | undefined {
	const text = line.trim();
	if (text.length === 0) {
		return undefined;
	}

	if (text.startsWith('{')) {
		try {
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				const name = nameIn(parsed as Record<string, unknown>);
				return name === undefined ? { kind: 'event' } : { kind: kindOf(name), name };
			}
		} catch {
			// Not JSON after all: read it as text below.
		}
		return { kind: 'event' };
	}

	// Plain text, for a CLI whose help lists no JSON flag.
	const word = /^(?:event:\s*)?([A-Za-z_]+)\b/.exec(text)?.[1];
	if (word !== undefined && KINDS[word.toLowerCase()] !== undefined) {
		return { kind: kindOf(word), name: word };
	}
	return { kind: 'event' };
}

/** Whether an event ends the watch. Only a revoked access does; the CLI reconnects on the rest. */
export function isWatchEnd(event: WatchEvent): boolean {
	return event.kind === 'forbidden';
}

/** Whether an event is a reason to read the change again. */
export function isWatchUpdate(event: WatchEvent): boolean {
	return event.kind === 'event';
}

/** Where a watch is, as the change's row shows it. */
export type WatchState =
	| { readonly kind: 'starting' }
	| { readonly kind: 'watching'; readonly updates: number }
	| { readonly kind: 'ended'; readonly reason: string };

/** The words beside a change that is watched, or was. */
export function describeWatchState(state: WatchState | undefined): string | undefined {
	if (!state) {
		return undefined;
	}
	switch (state.kind) {
		case 'starting':
			return 'starting to watch';
		case 'watching':
			return state.updates === 0
				? 'watching'
				: `watching · ${state.updates} ${state.updates === 1 ? 'update' : 'updates'}`;
		case 'ended':
			return `watch ended: ${state.reason}`;
	}
}
