import {
	confirmDispatch,
	describeDispatchFailure,
	isJurisdictionSlug,
	isTimeWindow,
	type AccountContext,
	type ControlConfirmation,
	type DispatchMode,
	type DispatchOutcome,
	type DispatchRequest,
} from '../lib/entire';
import type { DispatchSource } from '../services/dispatch';

/** The questions and answers of the dispatch command. */
export interface DispatchUi {
	pickMode(): Promise<DispatchMode | undefined>;
	ask(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly validate: (value: string) => string | undefined;
	}): Promise<string | undefined>;
	/** True only when the person chose to go ahead. */
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	/** Runs the work behind a cancel button. Cancelling aborts the signal. */
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	warn(message: string): Promise<void>;
	/** Opens the dispatch in a read-only editor and offers to copy it. */
	showDispatch(text: string): Promise<void>;
}

export interface DispatchDependencies {
	readonly source: DispatchSource;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly ui: DispatchUi;
	/** True while a dispatch is being generated, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

export type DispatchResult = 'shown' | 'cancelled' | 'busy' | 'no-login' | 'unavailable' | 'failed';

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who the dispatch would be generated as. Sign in first.';
const sharedRunning = { active: false };

/**
 * Asks what a dispatch should cover, confirms, generates it once, and
 * opens it.
 *
 * Generating a dispatch starts work on Entire's servers or in a local
 * agent, so nothing runs until the person agrees, the question names the
 * login it will run as, and a failure is reported rather than tried
 * again. Only what the CLI's help describes is offered: no local-agent
 * choice on a CLI without one, and so on.
 */
export async function generateDispatch(deps: DispatchDependencies): Promise<DispatchResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.warn('A dispatch is already being generated.');
		return 'busy';
	}
	running.active = true;
	try {
		return await generate(deps);
	} finally {
		running.active = false;
	}
}

async function generate(deps: DispatchDependencies): Promise<DispatchResult> {
	const { ui, source } = deps;
	const capabilities = await source.capabilities();
	if (!capabilities.ok) {
		await ui.warn(`A dispatch cannot be generated: ${capabilities.detail}.`);
		return 'unavailable';
	}
	const { value } = capabilities;

	let mode: DispatchMode = 'cloud';
	if (value.local) {
		const chosen = await ui.pickMode();
		if (chosen === undefined) {
			return 'cancelled';
		}
		mode = chosen;
	}

	let since: string | undefined;
	if (value.window) {
		const answer = await ui.ask({
			title: 'Dispatch: how far back',
			prompt: 'A duration such as 7d, a relative time, or an ISO date. Leave empty for the CLI default.',
			value: value.defaultWindow,
			validate: text => (text.trim().length === 0 || isTimeWindow(text.trim()) ? undefined : 'Use letters, digits and : . + - only, up to 64 characters.'),
		});
		if (answer === undefined) {
			return 'cancelled';
		}
		since = answer.trim().length > 0 ? answer.trim() : undefined;
	}

	let jurisdiction: string | undefined;
	if (mode === 'cloud' && value.jurisdiction) {
		const answer = await ui.ask({
			title: 'Dispatch: jurisdiction',
			prompt: 'The jurisdiction slug whose cell generates the dispatch, such as us or eu. Leave empty for your home jurisdiction.',
			validate: text => (text.trim().length === 0 || isJurisdictionSlug(text.trim()) ? undefined : 'Use a slug of letters, digits and dashes, such as us or eu.'),
		});
		if (answer === undefined) {
			return 'cancelled';
		}
		jurisdiction = answer.trim().length > 0 ? answer.trim() : undefined;
	}

	const request: DispatchRequest = { mode, since, jurisdiction, repository: value.repository };

	// The login is read again here, just before the question, so the
	// question names the login the command will run as.
	const acting = await deps.acting();
	if (!acting) {
		await ui.warn(NO_LOGIN);
		return 'no-login';
	}
	if (!(await ui.confirm(confirmDispatch(request, acting)))) {
		return 'cancelled';
	}

	const outcome: DispatchOutcome = await ui.withProgress(`Generating a dispatch as ${acting.handle}…`, signal =>
		source.generate(request, acting, signal),
	);
	if (outcome.kind === 'done') {
		await ui.showDispatch(outcome.text);
		return 'shown';
	}
	await ui.warn(describeDispatchFailure(outcome));
	return outcome.kind === 'cancelled' ? 'cancelled' : 'failed';
}

/** Where the clipboard is written. */
export interface Clipboard {
	write(text: string): Promise<void>;
}

/** Copies a generated document, or says there is nothing to copy. */
export async function copyGenerated(
	text: string | undefined,
	what: string,
	clipboard: Clipboard,
	notify: (message: string) => Promise<void>,
): Promise<boolean> {
	if (text === undefined || text.length === 0) {
		await notify(`There is no ${what} to copy yet. Generate one first.`);
		return false;
	}
	await clipboard.write(text);
	await notify(`The ${what} was copied.`);
	return true;
}
