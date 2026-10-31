import type { ControlConfirmation } from '../../lib/entire';
import type { ReviewUi } from '../../commands/review';
import type { ReviewProcess } from '../../services/review';
import type { GeneratedKind } from '../../providers/generatedDocuments';
import type { ResumeLaunch } from '../../services/sessionLifecycle';

export type Launch = Extract<ResumeLaunch, { ok: true }>;

interface UiScript {
	/** The profile to pick. `null` dismisses the picker. */
	profile?: string | null;
	/** `null` dismisses the target picker; an object picks. */
	target?: { target?: string } | null;
	/** `null` dismisses the question. */
	prompt?: string | null;
	confirm?: boolean;
	offer?: boolean;
}

/** The questions of the review commands, answered from a script. */
export class FakeReviewUi implements ReviewUi {
	readonly shown: { kind: GeneratedKind; text: string }[] = [];
	readonly warnings: string[] = [];
	readonly notices: string[] = [];
	readonly confirmations: ControlConfirmation[] = [];
	readonly offers: { message: string; action: string }[] = [];
	readonly profileChoices: (readonly string[])[] = [];
	readonly targetChoices: { branches: readonly string[]; current: string | undefined }[] = [];

	constructor(private readonly script: UiScript = {}) {}

	async show(kind: GeneratedKind, text: string): Promise<void> {
		this.shown.push({ kind, text });
	}
	async warn(message: string): Promise<void> {
		this.warnings.push(message);
	}
	withProgress<T>(_title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return work(new AbortController().signal);
	}
	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		this.confirmations.push(prompt);
		return this.script.confirm ?? true;
	}
	async pickProfile(names: readonly string[]): Promise<string | undefined> {
		this.profileChoices.push(names);
		return this.script.profile === null ? undefined : (this.script.profile ?? names[0]);
	}
	async pickTarget(branches: readonly string[], current: string | undefined): Promise<{ readonly target?: string } | undefined> {
		this.targetChoices.push({ branches, current });
		return this.script.target === null ? undefined : (this.script.target ?? {});
	}
	async askPrompt(): Promise<string | undefined> {
		return this.script.prompt === null ? undefined : (this.script.prompt ?? '');
	}
	async offer(message: string, action: string): Promise<boolean> {
		this.offers.push({ message, action });
		return this.script.offer ?? false;
	}
	notify(message: string): void {
		this.notices.push(message);
	}
}

/** A terminal that records what it was asked to run, and ends when the test says so. */
export function fakeLauncher() {
	const launches: Launch[] = [];
	const listeners: ((exitCode: number | undefined) => void)[] = [];
	return {
		launches,
		launch: (launch: Launch): ReviewProcess => {
			launches.push(launch);
			return { onExit: listener => void listeners.push(listener) };
		},
		/** Ends every terminal that was opened. */
		end(exitCode: number | undefined): void {
			for (const listener of listeners.splice(0)) {
				listener(exitCode);
			}
		},
	};
}
