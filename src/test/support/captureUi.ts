import type { AccountContext, CaptureConfirmation } from '../../lib/entire';
import type { CaptureChoice, CaptureDependencies, CaptureUi } from '../../commands/captureControl';
import { CaptureControlService } from '../../services/captureControl';
import type { FakeCaptureCli } from './captureCli';

/** What the person does, in order. A missing answer takes the first choice, or yes. */
export interface CaptureScript {
	/** The workspace folder to pick when there are several. */
	folder?: string;
	/** Answers to `choose`, by id. `undefined` dismisses. A missing answer takes the first item. */
	choices?: (string | undefined)[];
	/** Answers to `pickMany`. `undefined` dismisses. A missing answer ticks what the list marks as picked, else the first item. */
	many?: (readonly string[] | undefined)[];
	/** Answers to the free-text questions. `undefined` dismisses. */
	asks?: (string | undefined)[];
	/** Answers to the modals. A missing answer is yes. */
	confirms?: boolean[];
	/** What is typed when a name has to be typed back. A missing answer types the expected name. */
	typed?: (string | undefined)[];
	/** Picks the action of a message with buttons. */
	choose?: (message: string, actions: readonly string[]) => string | undefined;
	/** Runs when a modal is shown, before it is answered. */
	onConfirm?: (prompt: CaptureConfirmation) => void;
}

/** A person at the keyboard, scripted. Records everything the flows ask of the editor. */
export class ScriptedCaptureUi implements CaptureUi {
	readonly notices: { level: string; message: string; actions: readonly string[] }[] = [];
	readonly confirmations: CaptureConfirmation[] = [];
	readonly typedPrompts: string[] = [];
	readonly texts: { title: string; text: string }[] = [];
	readonly questions: { title: string; prompt: string; validate: (value: string) => string | undefined }[] = [];
	readonly choiceLists: { title: string; items: readonly CaptureChoice<string>[] }[] = [];
	readonly manyLists: { title: string; items: readonly CaptureChoice<string>[] }[] = [];
	readonly opened: string[] = [];
	readonly urls: string[] = [];
	/** The order things happened in. */
	readonly events: string[] = [];

	constructor(readonly script: CaptureScript = {}) {}

	chooseFolder(folders: readonly string[]): Promise<string | undefined> {
		this.events.push('folder');
		return Promise.resolve(this.script.folder ?? folders[0]);
	}

	choose<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<T | undefined> {
		this.choiceLists.push({ title, items });
		this.events.push(`choose:${title}`);
		const scripted = this.script.choices;
		if (scripted && scripted.length > 0) {
			return Promise.resolve(scripted.shift() as T | undefined);
		}
		return Promise.resolve(items[0]?.id);
	}

	pickMany<T extends string>(title: string, items: readonly CaptureChoice<T>[]): Promise<readonly T[] | undefined> {
		this.manyLists.push({ title, items });
		this.events.push(`many:${title}`);
		const scripted = this.script.many;
		if (scripted && scripted.length > 0) {
			return Promise.resolve(scripted.shift() as readonly T[] | undefined);
		}
		const picked = items.filter(item => item.picked === true).map(item => item.id);
		return Promise.resolve(picked.length > 0 ? picked : items.slice(0, 1).map(item => item.id));
	}

	ask(options: { title: string; prompt: string; value?: string; validate: (value: string) => string | undefined }): Promise<string | undefined> {
		this.questions.push({ title: options.title, prompt: options.prompt, validate: options.validate });
		this.events.push(`ask:${options.title}`);
		return Promise.resolve(this.script.asks ? this.script.asks.shift() : options.value);
	}

	confirm(prompt: CaptureConfirmation): Promise<boolean> {
		this.confirmations.push(prompt);
		this.events.push(`confirm:${prompt.message}`);
		this.script.onConfirm?.(prompt);
		return Promise.resolve(this.script.confirms?.shift() ?? true);
	}

	typeToConfirm(expected: string): Promise<string | undefined> {
		this.typedPrompts.push(expected);
		this.events.push('typed');
		const scripted = this.script.typed;
		return Promise.resolve(scripted && scripted.length > 0 ? scripted.shift() : expected);
	}

	showText(title: string, text: string): Promise<void> {
		this.texts.push({ title, text });
		this.events.push(`text:${title}`);
		return Promise.resolve();
	}

	notify(level: 'info' | 'warn', message: string, actions: readonly string[] = []): Promise<string | undefined> {
		this.notices.push({ level, message, actions });
		return Promise.resolve(this.script.choose?.(message, actions));
	}

	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		this.events.push(`progress:${title}`);
		return work(new AbortController().signal);
	}

	openFile(file: string): Promise<void> {
		this.opened.push(file);
		return Promise.resolve();
	}

	openUrl(url: string): Promise<void> {
		this.urls.push(url);
		return Promise.resolve();
	}
}

export const ACTING: AccountContext = { name: 'work', handle: 'alice', server: 'https://example.invalid', active: true };

export interface CaptureHarnessOptions {
	acting?: AccountContext | null;
	folders?: string[];
	timeoutSeconds?: number;
	runnerTimeoutSeconds?: number;
	running?: { active: boolean };
}

/** The service and the scripted editor the capture flows run over, against a fake CLI. */
export function captureHarness(cli: FakeCaptureCli, script: CaptureScript = {}, options: CaptureHarnessOptions = {}) {
	const service = new CaptureControlService({
		runner: cli.runner,
		timeoutSeconds: () => options.timeoutSeconds ?? 20,
		runnerTimeoutSeconds: () => options.runnerTimeoutSeconds ?? 20,
		homeDirectory: () => cli.dir,
	});
	const ui = new ScriptedCaptureUi(script);
	const stats = { setUps: 0, invalidations: 0, enabledAtRefresh: [] as boolean[], sessionsAtRefresh: [] as string[][] };
	const deps: CaptureDependencies = {
		service,
		ui,
		folders: () => options.folders ?? [cli.repo],
		acting: () => Promise.resolve(options.acting === null ? undefined : (options.acting ?? ACTING)),
		refresh: {
			status: () => {
				ui.events.push('refresh:status');
				stats.enabledAtRefresh.push(cli.enabled());
				return Promise.resolve();
			},
			account: () => {
				ui.events.push('refresh:account');
				return Promise.resolve();
			},
			sessions: () => {
				ui.events.push('refresh:sessions');
				stats.sessionsAtRefresh.push(cli.sessionIds());
				return Promise.resolve();
			},
		},
		setUpAgain: () => {
			ui.events.push('setUpAgain');
			stats.setUps += 1;
			return Promise.resolve();
		},
		invalidateAgents: () => {
			stats.invalidations += 1;
		},
		installCommand: 'run the installer',
		installDocs: 'https://example.invalid/install',
		running: options.running ?? { active: false },
	};
	return { service, ui, deps, stats };
}
