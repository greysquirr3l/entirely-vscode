import type { ControlConfirmation } from '../../lib/entire';
import type { DoctorDepthUi, OutputDocument, TraceMode } from '../../commands/doctorDepth';

export interface DepthScript {
	/** Answers to the confirmation modals, in order. A missing answer is yes. */
	confirms?: boolean[];
	mode?: TraceMode;
	/** Answers to the free-text questions, in order. `undefined` cancels. */
	asks?: (string | undefined)[];
	/** The path the save dialog returns, in order. */
	paths?: (string | undefined)[];
	/** Picks the action of a message. */
	choose?: (message: string, actions: readonly string[]) => string | undefined;
	/** Aborts the progress signal after this many milliseconds. */
	cancelAfterMs?: number;
}

/** A person at the keyboard, scripted. Records everything the flows ask of the editor. */
export class ScriptedUi implements DoctorDepthUi {
	readonly notices: { level: string; message: string; actions: readonly string[] }[] = [];
	readonly confirmations: ControlConfirmation[] = [];
	readonly documents: OutputDocument[] = [];
	readonly questions: { title: string; prompt: string; value?: string; validate: (value: string) => string | undefined }[] = [];
	readonly modePicks: (readonly TraceMode[])[] = [];
	readonly revealed: string[] = [];
	readonly copied: string[] = [];
	readonly urls: string[] = [];
	readonly opened: string[] = [];
	/** The order things were asked in: `confirm:<message>`, `path`, `progress`. */
	readonly events: string[] = [];

	constructor(readonly script: DepthScript = {}) {}

	notify(level: 'info' | 'warn', message: string, actions: readonly string[] = []): Promise<string | undefined> {
		this.notices.push({ level, message, actions });
		return Promise.resolve(this.script.choose?.(message, actions));
	}

	confirm(prompt: ControlConfirmation): Promise<boolean> {
		this.confirmations.push(prompt);
		this.events.push(`confirm:${prompt.message}`);
		return Promise.resolve(this.script.confirms?.shift() ?? true);
	}

	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		this.events.push(`progress:${title}`);
		const controller = new AbortController();
		if (this.script.cancelAfterMs !== undefined) {
			setTimeout(() => controller.abort(), this.script.cancelAfterMs);
		}
		return work(controller.signal);
	}

	pickTraceMode(modes: readonly TraceMode[]): Promise<TraceMode | undefined> {
		this.modePicks.push(modes);
		return Promise.resolve(this.script.mode);
	}

	ask(options: { title: string; prompt: string; value?: string; validate: (value: string) => string | undefined }): Promise<string | undefined> {
		this.questions.push({ title: options.title, prompt: options.prompt, value: options.value, validate: options.validate });
		return Promise.resolve(this.script.asks ? this.script.asks.shift() : options.value);
	}

	chooseSavePath(): Promise<string | undefined> {
		this.events.push('path');
		return Promise.resolve(this.script.paths?.shift());
	}

	showOutput(document: OutputDocument): Promise<void> {
		this.documents.push(document);
		this.opened.push(`document:${document.kind}`);
		return Promise.resolve();
	}

	reveal(file: string): Promise<void> {
		this.revealed.push(file);
		return Promise.resolve();
	}

	copyText(text: string): Promise<void> {
		this.copied.push(text);
		return Promise.resolve();
	}

	openUrl(url: string): Promise<void> {
		this.urls.push(url);
		return Promise.resolve();
	}

	openFile(file: string): Promise<void> {
		this.opened.push(`file:${file}`);
		return Promise.resolve();
	}
}
