import type { TrailDepthDependencies, TrailDepthUi } from '../../commands/trailDepth';
import type {
	DepthConfirmation,
	DiscussionMessage,
	Trail,
	TrailComment,
	TrailFinding,
	TrailPick,
	UnsavedFile,
} from '../../lib/entire';
import { TrailAuthoringService } from '../../services/trailAuthoring';
import { TrailDiscussionService } from '../../services/trailDiscussions';
import { TrailFindingService } from '../../services/trailFindings';
import { TrailService } from '../../services/trailService';
import { TrailWatchService } from '../../services/trailWatch';
import type { DepthDependencies } from '../../services/trailDepthSupport';
import { SHOWN_CHANGE } from './trailCli';
import { fakeTrailDepthCli, type FakeTrailDepthCli, type FakeTrailDepthOptions } from './trailDepthCli';

/** The login the tests act as. */
export const ACTING = { name: 'ada@us.auth.entire.io', handle: 'ada' } as const;

/** What a scripted UI answers. A `null` dismisses the question; an array is used in order. */
export interface UiScript {
	inputs?: (string | null)[];
	choices?: (string | null)[];
	confirm?: 'primary' | 'alternative' | null;
	unsaved?: UnsavedFile[];
	/** Which discussion, message or finding to pick, by index; the first when absent. */
	pickIndex?: number;
}

/** The questions of the trail depth flows, answered from a script and recorded. */
export class FakeDepthUi implements TrailDepthUi {
	readonly notices: { level: string; message: string; copy?: string }[] = [];
	readonly confirmations: DepthConfirmation[] = [];
	readonly asked: { title: string; prompt: string; value?: string }[] = [];
	readonly shown: { kind: string; name: string; text: string }[] = [];
	readonly choiceTitles: string[] = [];

	constructor(private readonly script: UiScript = {}) {}

	private next<T>(queue: (T | null)[] | undefined): T | undefined {
		if (!queue || queue.length === 0) {
			return undefined;
		}
		const value = queue.shift();
		return value === null || value === undefined ? undefined : value;
	}

	private chosen<T>(items: readonly T[]): T | undefined {
		return items[this.script.pickIndex ?? 0];
	}

	async pickTrail(trails: readonly Trail[]): Promise<Trail | undefined> {
		return this.chosen(trails);
	}
	async pickChange(picks: readonly TrailPick[]): Promise<TrailPick | undefined> {
		return this.chosen(picks);
	}
	async pickDiscussion(discussions: readonly TrailComment[]): Promise<TrailComment | undefined> {
		return this.chosen(discussions);
	}
	async pickMessage(messages: readonly DiscussionMessage[]): Promise<DiscussionMessage | undefined> {
		return this.chosen(messages);
	}
	async pickFinding(findings: readonly TrailFinding[]): Promise<TrailFinding | undefined> {
		return this.chosen(findings);
	}
	async input(options: { title: string; prompt: string; value?: string }): Promise<string | undefined> {
		this.asked.push({ title: options.title, prompt: options.prompt, value: options.value });
		return this.next(this.script.inputs);
	}
	async choice<T extends string>(title: string, items: readonly { label: string; value: T }[]): Promise<T | undefined> {
		this.choiceTitles.push(title);
		const wanted = this.next(this.script.choices);
		return wanted === undefined ? undefined : items.find(item => item.value === wanted || item.label === wanted)?.value;
	}
	async confirm(prompt: DepthConfirmation): Promise<'primary' | 'alternative' | undefined> {
		this.confirmations.push(prompt);
		return this.script.confirm === null ? undefined : (this.script.confirm ?? 'primary');
	}
	unsavedFiles(): readonly UnsavedFile[] {
		return this.script.unsaved ?? [];
	}
	async show(kind: string, name: string, text: string): Promise<void> {
		this.shown.push({ kind, name, text });
	}
	notify(level: 'info' | 'warn' | 'error', message: string, copy?: string): void {
		this.notices.push({ level, message, copy });
	}
	withProgress<T>(_title: string, work: () => Promise<T>): Promise<T> {
		return work();
	}
}

/** The fake CLI, every service built over it, and the dependencies of the flows. */
export interface DepthRig {
	readonly cli: FakeTrailDepthCli;
	readonly trails: TrailService;
	readonly depth: DepthDependencies;
	readonly authoring: TrailAuthoringService;
	readonly discussions: TrailDiscussionService;
	readonly findings: TrailFindingService;
	readonly watch: TrailWatchService;
	readonly ui: FakeDepthUi;
	readonly deps: TrailDepthDependencies;
	readonly refreshed: string[];
	readonly ended: { key: string; reason: string }[];
	readonly logged: string[];
	readonly changedCalls: (TrailPick | undefined)[];
	readonly threadsChanged: (string | undefined)[];
}

/** Builds a rig over a fake CLI. */
export function depthRig(options: FakeTrailDepthOptions = {}, script: UiScript = {}, extras: { limit?: number; delaySeconds?: number; refreshTakesMs?: number } = {}): DepthRig {
	const cli = fakeTrailDepthCli(options);
	const trails = new TrailService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		actingHandle: () => ACTING.handle,
		actionTimeoutMs: () => 20_000,
	});
	const depth: DepthDependencies = { runner: cli.runner, trails, workspaceRoot: () => cli.dir };
	const refreshed: string[] = [];
	const ended: { key: string; reason: string }[] = [];
	const logged: string[] = [];
	const watch = new TrailWatchService({
		...depth,
		limit: () => extras.limit ?? 3,
		refreshDelaySeconds: () => extras.delaySeconds ?? 1,
		refresh: async key => {
			refreshed.push(key);
			if (extras.refreshTakesMs) {
				await new Promise(resolve => setTimeout(resolve, extras.refreshTakesMs));
			}
		},
		login: () => ACTING.handle,
		log: line => logged.push(line),
		ended: (key, reason) => ended.push({ key, reason }),
	});
	const authoring = new TrailAuthoringService(depth);
	const discussions = new TrailDiscussionService(depth);
	const findings = new TrailFindingService(depth);
	const ui = new FakeDepthUi(script);
	const changedCalls: (TrailPick | undefined)[] = [];
	const threadsChanged: (string | undefined)[] = [];
	const deps: TrailDepthDependencies = {
		trails,
		authoring,
		discussions,
		findings,
		watch,
		acting: async () => ACTING,
		ui,
		changed: pick => changedCalls.push(pick),
		threadsChanged: key => threadsChanged.push(key),
		withChanges: async trails => trails.map(trail => ({ ...trail, changes: [SHOWN_CHANGE] })),
		currentBranch: () => 'shape-probe',
		folderName: () => 'entirely-vscode',
		running: { active: false },
	};
	return { cli, trails, depth, authoring, discussions, findings, watch, ui, deps, refreshed, ended, logged, changedCalls, threadsChanged };
}

/** The change the tests act on: the one the fake's `trail show` lists. */
export const CHANGE_SELECTOR = { kind: 'change', repository: 'entirely-vscode', number: 17 } as const;

/** A change row of the Trails view, as a command receives it. */
export function changeRow(): unknown {
	const change = {
		id: '01M62YB0HTSHFQ0WE38EHPFX1',
		repository: 'entirely-vscode',
		branch: 'shape-probe',
		number: 17,
		title: 'Shape the thing',
		status: 'open',
	};
	const trail = { id: '01M62YAQVTG0WN2J6G7149VCK9', number: 40, title: 'Shape the thing', status: 'open', partial: false, changes: [change] };
	return { kind: 'change', entry: { change, gate: { kind: 'open' } }, trail };
}

/** A row under a change, as a command receives it. */
export function threadRow(kind: 'discussion' | 'finding', value: Record<string, unknown>): unknown {
	return { kind, change: changeRow(), [kind]: value };
}

/** Waits until a condition holds, for a stream whose lines arrive from another process. */
export async function until(condition: () => boolean, what: string, limitMs = 5000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > limitMs) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}
