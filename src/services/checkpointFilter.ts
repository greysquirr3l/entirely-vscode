import * as vscode from 'vscode';

import { normaliseQuery, type SearchOutcome } from '../lib/entire';
import type { CheckpointSearchSource } from './checkpointSearch';
import { clampSearchDebounce } from './configuration';

/** Where the checkpoint filter has got to. */
export type FilterState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'searching' }
	| { readonly kind: 'done'; readonly outcome: SearchOutcome };

/**
 * The text the user is filtering checkpoints by, and what the search for
 * it has found.
 *
 * Each keystroke restarts a timer, so the CLI is asked once the user
 * pauses. A search that is still running when the text changes is not
 * cancelled, because the CLI cannot be, but its answer is dropped: only
 * the search for the latest text may set the state. The text is held
 * here and nowhere else.
 */
export class CheckpointFilter implements vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<FilterState>();
	private timer: NodeJS.Timeout | undefined;
	private generation = 0;
	private current: FilterState = { kind: 'idle' };
	private typed: string | undefined;

	readonly onDidChange: vscode.Event<FilterState> = this.changed.event;

	constructor(
		private readonly source: CheckpointSearchSource,
		private readonly debounceMs: () => number = () => 400,
	) {}

	get state(): FilterState {
		return this.current;
	}

	/** The text being filtered by, while a filter is applied. */
	get text(): string | undefined {
		return this.typed;
	}

	/** Called as the user types. An empty text clears the filter. */
	setQuery(text: string): void {
		this.cancelPending();
		const query = normaliseQuery(text);
		this.typed = query === undefined ? undefined : text;

		if (query === undefined) {
			this.set({ kind: 'idle' });
			return;
		}

		const generation = this.generation;
		this.set({ kind: 'searching' });
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.run(query, generation);
		}, clampSearchDebounce(this.debounceMs()));
	}

	/** Removes the filter. */
	clear(): void {
		this.cancelPending();
		this.typed = undefined;
		this.set({ kind: 'idle' });
	}

	private async run(query: string, generation: number): Promise<void> {
		let outcome: SearchOutcome;
		try {
			outcome = await this.source.search(query);
		} catch (error) {
			// The source reports failures as values; this is the net for one that does not.
			outcome = { kind: 'failed', detail: error instanceof Error ? error.message : 'the search stopped unexpectedly' };
		}

		if (generation === this.generation) {
			this.set({ kind: 'done', outcome });
		}
	}

	private cancelPending(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.generation += 1;
	}

	private set(state: FilterState): void {
		this.current = state;
		this.changed.fire(state);
	}

	dispose(): void {
		this.cancelPending();
		this.changed.dispose();
	}
}
