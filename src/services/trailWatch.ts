import {
	TRAIL_DEPTH_COMMANDS,
	describeDepthFailure,
	formatTrailSelector,
	isProjectInvisible,
	isWatchEnd,
	isWatchUpdate,
	parseWatchLine,
	planWatch,
	watchArguments,
	type TrailSelector,
	type WatchState,
} from '../lib/entire';
import type { StreamEnd, StreamHandle } from './cli';
import { readCommandHelp, type DepthDependencies } from './trailDepthSupport';

/** Why a start did not start a watch. */
export type WatchStart =
	| { readonly kind: 'started' }
	| { readonly kind: 'already' }
	| { readonly kind: 'limit'; readonly limit: number }
	| { readonly kind: 'unavailable'; readonly detail: string };

/** What the watch service needs besides the CLI. */
export interface TrailWatchOptions extends DepthDependencies {
	/** How many watches may run at once. Read at each start. */
	readonly limit: () => number;
	/** Seconds that events are coalesced over before the rows are read again. Read at each event. */
	readonly refreshDelaySeconds: () => number;
	/** Re-reads one change's Comments and Findings. A normal listing call, never a poll. */
	readonly refresh: (key: string) => Promise<void> | void;
	/** The handle of the login the CLI acts as, named when access is missing. */
	readonly login?: () => string | undefined;
	/** One line for the output channel. It never carries an event payload. */
	readonly log: (line: string) => void;
	/** Said when a watch ends on its own, with why. A stop by the user is silent. */
	readonly ended: (key: string, reason: string) => void;
}

type Pump = 'idle' | 'waiting' | 'reading';

interface Running {
	readonly handle: StreamHandle;
	state: WatchState;
	updates: number;
	pump: Pump;
	dirty: boolean;
	timer: NodeJS.Timeout | undefined;
	stopped: boolean;
}

/** The key a change is watched under: the selector as the CLI writes it. */
export function watchKey(selector: TrailSelector): string {
	return formatTrailSelector(selector);
}

/**
 * Follows changes with one owned CLI process each.
 *
 * The process is the CLI's own `trail watch`, which reconnects by itself,
 * so it is never asked to stop after one connection and nothing here
 * polls. An event is a reason to read the change's discussions and
 * findings again, once, after a short delay in which more events are
 * folded into the same read. Nothing runs on a timer except that delay,
 * which is cleared when the watch stops. A watch ends on a stop by the
 * user, on the end of the stream, on revoked access (`forbidden`), on an
 * invisible project and on deactivation; none is restarted.
 *
 * Event payloads can carry review text, so only the kind of an event is
 * read and only a count is kept. Verified against a fake CLI only: no
 * live stream was recorded.
 */
export class TrailWatchService {
	private readonly running = new Map<string, Running>();
	private readonly ended = new Map<string, string>();
	private readonly listeners = new Set<(key: string) => void>();
	private disposed = false;

	constructor(private readonly options: TrailWatchOptions) {}

	/** Calls back when a change's watch state changes. */
	onDidChange(listener: (key: string) => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	private changed(key: string): void {
		for (const listener of [...this.listeners]) {
			listener(key);
		}
	}

	/** How many watches are running. */
	get count(): number {
		return this.running.size;
	}

	/** The keys of the watches that are running. */
	keys(): readonly string[] {
		return [...this.running.keys()];
	}

	/** Where a change's watch is: running, ended with a reason, or nothing at all. */
	stateOf(key: string): WatchState | undefined {
		const run = this.running.get(key);
		if (run) {
			return run.state;
		}
		const reason = this.ended.get(key);
		return reason === undefined ? undefined : { kind: 'ended', reason };
	}

	/** Starts following a change. */
	async start(selector: TrailSelector): Promise<WatchStart> {
		const key = watchKey(selector);
		if (this.disposed) {
			return { kind: 'unavailable', detail: 'the extension is shutting down' };
		}
		if (this.running.has(key)) {
			return { kind: 'already' };
		}
		const limit = this.options.limit();
		if (this.running.size >= limit) {
			return { kind: 'limit', limit };
		}

		const command = TRAIL_DEPTH_COMMANDS.watch;
		const help = await readCommandHelp(this.options.runner, command, this.options.workspaceRoot());
		if (!help.ok) {
			return { kind: 'unavailable', detail: help.detail };
		}
		const picked = planWatch(help.raw);
		if (!picked.ok) {
			return { kind: 'unavailable', detail: picked.detail };
		}
		// The help was awaited, so the answer to the questions above may have moved.
		if (this.disposed || this.running.has(key) || this.running.size >= limit) {
			return this.running.has(key) ? { kind: 'already' } : { kind: 'limit', limit };
		}

		const args = await this.options.trails.selectorArgs(command, selector, watchArguments(picked.flags));
		if (this.disposed || this.running.has(key) || this.running.size >= limit) {
			return this.running.has(key) ? { kind: 'already' } : { kind: 'limit', limit };
		}

		this.ended.delete(key);
		const handle = this.options.runner.stream(args, {
			cwd: this.options.workspaceRoot(),
			onLine: line => this.onLine(key, line),
		});
		const run: Running = {
			handle,
			state: { kind: 'starting' },
			updates: 0,
			pump: 'idle',
			dirty: false,
			timer: undefined,
			stopped: false,
		};
		this.running.set(key, run);
		this.options.log(`watching ${key}`);
		this.changed(key);
		void handle.done.then(end => this.onEnd(key, run, end));
		return { kind: 'started' };
	}

	/** Stops following a change. Silent. */
	stop(key: string): boolean {
		const run = this.running.get(key);
		if (!run) {
			return false;
		}
		this.release(key, run, 'stopped');
		return true;
	}

	/** Stops every watch. Silent. */
	stopAll(): void {
		for (const key of [...this.running.keys()]) {
			this.stop(key);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.stopAll();
		this.listeners.clear();
	}

	private onLine(key: string, line: string): void {
		const run = this.running.get(key);
		const event = parseWatchLine(line);
		if (!run || run.stopped || !event) {
			return;
		}
		if (event.kind === 'ready') {
			run.state = { kind: 'watching', updates: run.updates };
			this.changed(key);
			return;
		}
		// An error event that says access is gone ends the watch like a forbidden one.
		// Only its kind is acted on; the line itself is not kept.
		if (event.kind === 'error' && isProjectInvisible(line)) {
			void this.options.trails.workspace().then(workspace => {
				const project = workspace.kind === 'ok' ? workspace.value.project : undefined;
				this.finish(key, run, 'no-access', describeDepthFailure('', line, { project, login: this.options.login?.() }));
			});
			return;
		}
		if (event.kind === 'error' && /forbidden/i.test(line)) {
			this.finish(key, run, 'forbidden', 'the server revoked access to the change');
			return;
		}
		if (isWatchEnd(event)) {
			this.finish(key, run, 'forbidden', 'the server revoked access to the change');
			return;
		}
		if (isWatchUpdate(event)) {
			run.updates += 1;
			run.state = { kind: 'watching', updates: run.updates };
			this.changed(key);
			this.schedule(key, run);
		}
	}

	/** Folds events that arrive close together into one read. */
	private schedule(key: string, run: Running): void {
		if (run.pump === 'reading') {
			run.dirty = true;
			return;
		}
		if (run.pump === 'waiting') {
			return;
		}
		run.pump = 'waiting';
		run.timer = setTimeout(() => {
			run.timer = undefined;
			void this.read(key, run);
		}, Math.max(0, this.options.refreshDelaySeconds()) * 1000);
	}

	private async read(key: string, run: Running): Promise<void> {
		if (run.stopped) {
			return;
		}
		run.pump = 'reading';
		try {
			await this.options.refresh(key);
		} catch {
			// A read that fails shows its own failure in the rows.
		}
		if (run.stopped) {
			return;
		}
		if (run.dirty) {
			run.dirty = false;
			run.pump = 'idle';
			this.schedule(key, run);
		} else {
			run.pump = 'idle';
		}
	}

	/** Ends a watch for a reason the user is told. */
	private finish(key: string, run: Running, kind: string, reason: string): void {
		if (run.stopped) {
			return;
		}
		this.release(key, run, 'ended');
		this.ended.set(key, reason);
		this.options.log(`watch ended (${kind})`);
		this.options.ended(key, reason);
		this.changed(key);
	}

	private release(key: string, run: Running, why: 'stopped' | 'ended'): void {
		run.stopped = true;
		if (run.timer) {
			clearTimeout(run.timer);
			run.timer = undefined;
		}
		run.handle.stop();
		this.running.delete(key);
		if (why === 'stopped') {
			this.ended.delete(key);
			this.options.log(`watch stopped (${key})`);
			this.changed(key);
		}
	}

	private onEnd(key: string, run: Running, end: StreamEnd): void {
		if (run.stopped || this.running.get(key) !== run) {
			return;
		}
		switch (end.kind) {
			case 'stopped':
				this.release(key, run, 'stopped');
				return;
			case 'no-cli':
			case 'spawn-failed':
				this.finish(key, run, end.kind, end.detail);
				return;
			case 'exited': {
				if (isProjectInvisible(end.stderr)) {
					void this.options.trails.workspace().then(workspace => {
						const project = workspace.kind === 'ok' ? workspace.value.project : undefined;
						this.finish(key, run, 'no-access', describeDepthFailure('', end.stderr, { project, login: this.options.login?.() }));
					});
					return;
				}
				this.finish(
					key,
					run,
					end.code === 0 ? 'stream-ended' : 'exited',
					end.code === 0 ? 'the stream ended' : describeDepthFailure(`the watch exited with code ${end.code}`, end.stderr, {}),
				);
			}
		}
	}
}
