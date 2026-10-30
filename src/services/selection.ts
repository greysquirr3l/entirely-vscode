import * as vscode from 'vscode';

import {
	initialDetail,
	isFresh,
	lifetimeSeconds,
	selectionKey,
	type DetailModel,
	type Selection,
	type SelectionSource,
	type ViewerState,
} from '../lib/entire';

/** What reading one selection came to. */
export type LoadOutcome =
	| {
			readonly kind: 'ready';
			readonly model: DetailModel;
			/** False for an answer that should be asked for again next time. */
			readonly cache?: boolean;
	  }
	| { readonly kind: 'failed'; readonly reason: string }
	| { readonly kind: 'gone'; readonly reason: string };

/**
 * Reads what the viewer shows for a selection.
 *
 * `progress` is called with what has been read so far, for the kinds that
 * are read in steps. Whether its model is shown is the service's decision.
 */
export type SelectionLoader = (
	selection: Selection,
	progress: (model: DetailModel) => void,
) => Promise<LoadOutcome>;

export interface SelectionServiceOptions {
	readonly loader: SelectionLoader;
	/** The cache lifetime in seconds, read each time it is needed. */
	readonly ttlSeconds: () => number;
	/** The clock. The cache expires by comparing times, never by a timer. */
	readonly now?: () => number;
}

/** Which row was selected, and in which view. */
export interface SelectionEvent {
	readonly source: SelectionSource;
	readonly key: string;
}

/** How many loaded details are kept. */
export const MAX_CACHED_DETAILS = 50;

interface CacheEntry {
	readonly model: DetailModel;
	readonly loadedAt: number;
	readonly lifetime: number;
}

interface Load {
	readonly id: number;
	promise: Promise<void>;
}

/**
 * The one channel between the views that can be selected in and the
 * Details viewer.
 *
 * Selecting a row starts at most one read for that item. A click that is
 * also a selection change, or the same row twice, joins the read already
 * under way or finds the answer cached. A read only ever changes the viewer
 * while its item is still the selected one. Nothing here polls or sets a
 * timer, and nothing here changes anything in Entire.
 */
export class SelectionService implements vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<ViewerState>();
	private readonly selected = new vscode.EventEmitter<SelectionEvent>();
	private readonly cache = new Map<string, CacheEntry>();
	private readonly loads = new Map<string, Load>();
	private current: { readonly selection: Selection; readonly key: string; readonly source: SelectionSource } | undefined;
	private shown: ViewerState = { kind: 'empty' };
	private lastLoad = 0;
	private disposed = false;

	/** Fires with the new content whenever the viewer should change. */
	readonly onDidChange: vscode.Event<ViewerState> = this.changed.event;

	/** Fires when the selected item changes, so the other views can drop their mark. */
	readonly onDidSelect: vscode.Event<SelectionEvent> = this.selected.event;

	constructor(private readonly options: SelectionServiceOptions) {}

	/** What the viewer shows now. */
	get state(): ViewerState {
		return this.shown;
	}

	/** The item the viewer is about, if any. */
	get currentSelection(): Selection | undefined {
		return this.current?.selection;
	}

	/** The view the current selection was made in. */
	get currentSource(): SelectionSource | undefined {
		return this.current?.source;
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private isFreshEntry(entry: CacheEntry): boolean {
		return isFresh(entry.loadedAt, this.now(), entry.lifetime);
	}

	private emit(state: ViewerState): void {
		if (this.disposed) {
			return;
		}
		this.shown = state;
		this.changed.fire(state);
	}

	/**
	 * Loads an item into the viewer.
	 *
	 * Resolves when the read this call started or joined has finished. With
	 * `refresh`, the cache is bypassed for this one item.
	 */
	select(selection: Selection, source: SelectionSource, options: { readonly refresh?: boolean } = {}): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		const key = selectionKey(selection);
		const refresh = options.refresh === true;
		const sameItem = this.current?.key === key;
		const entry = this.cache.get(key);
		const fresh = entry !== undefined && this.isFreshEntry(entry) && !refresh;

		if (sameItem && !refresh) {
			const running = this.loads.get(key);
			if (running) {
				return running.promise;
			}
			if (fresh) {
				return Promise.resolve();
			}
		}

		this.current = { selection, key, source };
		if (!sameItem) {
			this.selected.fire({ source, key });
		}

		if (entry) {
			this.emit({
				kind: 'ready',
				selection,
				model: entry.model,
				asOf: entry.loadedAt,
				refreshing: !fresh,
			});
			if (fresh) {
				return Promise.resolve();
			}
		} else {
			this.emit({ kind: 'loading', selection, model: initialDetail(selection) });
		}

		const running = this.loads.get(key);
		if (running && !refresh) {
			return running.promise;
		}
		return this.start(key, selection, entry !== undefined);
	}

	private start(key: string, selection: Selection, quiet: boolean): Promise<void> {
		const id = ++this.lastLoad;
		const stillWanted = (): boolean => this.loads.get(key)?.id === id;

		const run = async (): Promise<void> => {
			let outcome: LoadOutcome;
			try {
				outcome = await this.options.loader(selection, model => {
					if (!quiet && stillWanted() && this.current?.key === key) {
						this.emit({ kind: 'loading', selection, model });
					}
				});
			} catch (error) {
				outcome = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
			}
			if (!stillWanted() || this.disposed) {
				return;
			}
			this.loads.delete(key);
			this.finish(key, selection, outcome);
		};

		// Registered before the loader runs, so a second call in the same turn
		// finds it and joins it.
		const load: Load = { id, promise: Promise.resolve() };
		this.loads.set(key, load);
		load.promise = run();
		return load.promise;
	}

	private finish(key: string, selection: Selection, outcome: LoadOutcome): void {
		const previous = this.cache.get(key);
		const showing = this.current?.key === key;

		if (outcome.kind === 'ready') {
			if (outcome.cache !== false && this.options.ttlSeconds() > 0) {
				this.store(key, selection, outcome.model);
			}
			if (showing) {
				const same = previous !== undefined && JSON.stringify(previous.model) === JSON.stringify(outcome.model);
				this.emit({ kind: 'ready', selection, model: same && previous ? previous.model : outcome.model });
			}
			return;
		}

		if (outcome.kind === 'gone') {
			this.cache.delete(key);
			if (showing) {
				this.emit({ kind: 'gone', selection, model: initialDetail(selection), reason: outcome.reason });
			}
			return;
		}

		if (!showing) {
			return;
		}
		if (previous) {
			this.emit({
				kind: 'ready',
				selection,
				model: previous.model,
				asOf: previous.loadedAt,
				refreshFailure: outcome.reason,
			});
			return;
		}
		this.emit({ kind: 'failed', selection, model: initialDetail(selection), reason: outcome.reason });
	}

	private store(key: string, selection: Selection, model: DetailModel): void {
		this.cache.delete(key);
		this.cache.set(key, {
			model,
			loadedAt: this.now(),
			lifetime: lifetimeSeconds(model, selection, this.options.ttlSeconds()),
		});
		while (this.cache.size > MAX_CACHED_DETAILS) {
			const oldest = this.cache.keys().next();
			if (oldest.done) {
				break;
			}
			this.cache.delete(oldest.value);
		}
	}

	/** Reads the selected item again, bypassing the cache for it alone. */
	refresh(): Promise<void> {
		const current = this.current;
		return current ? this.select(current.selection, current.source, { refresh: true }) : Promise.resolve();
	}

	/** Forgets what was loaded: all of it, or the keys that start with one of the prefixes. */
	clearCache(prefixes?: readonly string[]): void {
		for (const key of [...this.cache.keys()]) {
			if (!prefixes || prefixes.some(prefix => key.startsWith(prefix))) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Forgets specific items after something changed them, and drops any
	 * read of them that is still on its way.
	 */
	invalidate(keys: readonly string[]): void {
		for (const key of keys) {
			this.cache.delete(key);
			this.loads.delete(key);
		}
	}

	/**
	 * Reads the selected trail row again from a listing that has just been
	 * refreshed, so the viewer shows the listing's current gate. The viewer
	 * empties if the row is no longer listed.
	 */
	reloadFrom(listing: { find(key: string): Selection | undefined }): void {
		const current = this.current;
		if (!current || current.source !== 'trails') {
			return;
		}
		const fresh = listing.find(current.key);
		if (fresh) {
			void this.select(fresh, 'trails', { refresh: true });
		} else {
			this.clear();
		}
	}

	/**
	 * Tells the viewer that what was chosen could not be shown, in place of whatever it held.
	 *
	 * This is for a row that reached the service with nothing usable in it. It
	 * is a line in the viewer, never a popup, and it never throws.
	 */
	notify(message: string): void {
		if (this.disposed) {
			return;
		}
		this.current = undefined;
		this.emit({ kind: 'notice', message });
	}

	/** Empties the viewer. */
	clear(): void {
		if (!this.current && this.shown.kind === 'empty') {
			return;
		}
		this.current = undefined;
		this.emit({ kind: 'empty' });
	}

	/**
	 * Empties the viewer when the selected row has gone from its view.
	 *
	 * `exists` answers for a key, or says `undefined` when the view cannot
	 * tell yet, such as while it is being read.
	 */
	reconcile(source: SelectionSource, exists: (key: string) => boolean | undefined): void {
		const current = this.current;
		if (current && current.source === source && exists(current.key) === false) {
			this.clear();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.cache.clear();
		this.loads.clear();
		this.changed.dispose();
		this.selected.dispose();
	}
}
