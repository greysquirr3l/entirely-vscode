import {
	MAX_REVIEW_PROMPT,
	NO_PROFILE_TEXT,
	REVIEW_STARTED_TEXT,
	describeReviewConfig,
	describeReviewExit,
	reviewConfirmation,
	reviewSetupConfirmation,
	type AccountContext,
	type ControlConfirmation,
	type ReviewPlan,
} from '../lib/entire';
import type { LaunchPlan, ReviewLauncher, ReviewSource } from '../services/review';
import type { GeneratedViewUi } from './generatedView';

export interface ReviewUi extends GeneratedViewUi {
	/** True only when the person chose to go ahead. */
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	pickProfile(names: readonly string[]): Promise<string | undefined>;
	/** Undefined when cancelled; `{}` for the current branch; `{ target }` for another one. */
	pickTarget(branches: readonly string[], current: string | undefined): Promise<{ readonly target?: string } | undefined>;
	/** Asks for one-off instructions. Undefined when cancelled; empty for none. */
	askPrompt(maxLength: number): Promise<string | undefined>;
	/** A message with one button. True when the button was chosen. */
	offer(message: string, action: string): Promise<boolean>;
	/** A message the person need not answer. */
	notify(message: string): void;
}

export interface ReviewDependencies {
	readonly source: ReviewSource;
	readonly ui: ReviewUi;
	readonly launch: ReviewLauncher;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	/** The branch checked out and the local branches, when the git extension is there. */
	readonly branches: () => Promise<{ readonly current?: string; readonly local: readonly string[] }>;
	/** Minutes each reviewer may run; zero means no limit. */
	readonly timeoutMinutes: () => number;
	/** True while a review is being set up, so a second one is refused. */
	readonly running?: { active: boolean };
}

export type ReviewResult = 'started' | 'declined' | 'cancelled' | 'busy' | 'no-login' | 'no-profile' | 'unavailable' | 'failed';

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who the review would run as. Sign in first.';
const sharedRunning = { active: false };

function unavailable(ui: GeneratedViewUi, what: string, detail: string): Promise<void> {
	return ui.warn(`${what}: ${detail}.`);
}

/** Opens a terminal for a prepared command and reports when it ends badly. Called once per request. */
function openTerminal(deps: ReviewDependencies, prepared: Extract<LaunchPlan, { ok: true }>, report: boolean): void {
	const process = deps.launch(prepared.launch);
	if (report) {
		process.onExit(code => {
			const message = describeReviewExit(code);
			if (message) {
				void deps.ui.warn(message);
			}
		});
	}
}

/** Lists the profiles the CLI knows. Read-only: no confirmation, no agent. */
export async function showReviewProfiles(deps: ReviewDependencies): Promise<ReviewResult> {
	const outcome = await deps.ui.withProgress('Listing review profiles…', () => deps.source.profiles());
	switch (outcome.kind) {
		case 'profiles':
			await deps.ui.show('reviewProfiles', outcome.text, 'Review profiles');
			return 'started';
		case 'none':
			await offerSetup(deps, NO_PROFILE_TEXT);
			return 'no-profile';
		case 'noCli':
		case 'unsupported':
		case 'failed':
			await unavailable(deps.ui, 'The review profiles cannot be listed', outcome.detail);
			return 'unavailable';
	}
}

/** Shows what a review would load. Read-only: nothing is checked out and no agent starts. */
export async function showReviewConfig(deps: ReviewDependencies): Promise<ReviewResult> {
	const outcome = await deps.ui.withProgress('Reading what a review would run…', () => deps.source.config(undefined));
	switch (outcome.kind) {
		case 'config':
			await deps.ui.show('reviewConfig', describeReviewConfig(outcome.config), 'What a review would run');
			return 'started';
		case 'refused':
			await deps.ui.warn(outcome.message);
			return 'failed';
		case 'noCli':
		case 'unsupported':
		case 'failed':
			await unavailable(deps.ui, 'What a review would run cannot be shown', outcome.detail);
			return 'unavailable';
	}
}

/** Shows the saved findings. Read-only. A command that waits for a terminal is offered one. */
export async function showReviewFindings(deps: ReviewDependencies): Promise<ReviewResult> {
	const outcome = await deps.ui.withProgress('Reading saved review findings…', () => deps.source.findings());
	switch (outcome.kind) {
		case 'text':
			await deps.ui.show('reviewFindings', outcome.text, 'Review findings');
			return 'started';
		case 'empty':
			await deps.ui.warn('The Entire CLI printed no saved review findings.');
			return 'failed';
		case 'needsTerminal':
			if (await deps.ui.offer('The CLI waits for a terminal to browse the saved findings, so they cannot be shown here.', 'Open in Terminal')) {
				const prepared = await deps.source.prepareFindingsTerminal();
				if (!prepared.ok) {
					await unavailable(deps.ui, 'The findings cannot be opened', prepared.detail);
					return 'unavailable';
				}
				openTerminal(deps, prepared, false);
			}
			return 'cancelled';
		case 'noCli':
		case 'unsupported':
		case 'failed':
			await unavailable(deps.ui, 'The saved findings cannot be shown', outcome.detail);
			return 'unavailable';
	}
}

/**
 * Opens the CLI's own review setup in a terminal, after asking.
 *
 * The wizard writes a profile only when the person finishes it, and starts no
 * agent. The extension writes no profile and passes no setting flag.
 */
export async function openReviewSetup(deps: ReviewDependencies): Promise<ReviewResult> {
	const acting = await deps.acting();
	if (!(await deps.ui.confirm(reviewSetupConfirmation(acting)))) {
		return 'declined';
	}
	return launchSetup(deps, acting);
}

async function launchSetup(deps: ReviewDependencies, acting: AccountContext | undefined): Promise<ReviewResult> {
	const prepared = await deps.source.prepareSetup(acting);
	if (!prepared.ok) {
		await unavailable(deps.ui, 'The review setup cannot be opened', prepared.detail);
		return 'unavailable';
	}
	openTerminal(deps, prepared, false);
	return 'started';
}

/** Says no profile is configured and offers the CLI's setup. The button is the person's choice. */
async function offerSetup(deps: ReviewDependencies, message: string): Promise<void> {
	if (await deps.ui.offer(message, 'Open Setup in Terminal')) {
		await launchSetup(deps, await deps.acting());
	}
}

/**
 * Starts a multi-agent review, after asking, in one terminal.
 *
 * Picks a profile from the CLI's list, a target and optional instructions,
 * reads what the reviewer would load, and puts the profile, the branch, the
 * login, the cost and the unauthored-code warning in a modal. Only after
 * the person confirms does one terminal open on the CLI as that login. It is
 * never started again, and no trust or setup flag is ever passed.
 */
export async function runReview(deps: ReviewDependencies): Promise<ReviewResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.warn('A review is already being set up.');
		return 'busy';
	}
	running.active = true;
	let followUp: (() => Promise<void>) | undefined;
	let result: ReviewResult;
	try {
		result = await start(deps, work => {
			followUp = work;
		});
	} finally {
		running.active = false;
	}
	// A message with a button settles only when it is answered, so it is shown after the flag is released.
	await followUp?.();
	return result;
}

async function start(deps: ReviewDependencies, later: (work: () => Promise<void>) => void): Promise<ReviewResult> {
	const { ui, source } = deps;

	const help = await source.help();
	if (!help.ok) {
		await unavailable(ui, 'A review cannot be started', help.detail);
		return 'unavailable';
	}

	// A review is never started with a profile the CLI's help does not describe.
	if (!help.value.flags.profile) {
		await unavailable(ui, 'A review cannot be started', "this version of the Entire CLI does not describe the profile flag of 'review'; update the CLI");
		return 'unavailable';
	}

	const listed = await ui.withProgress('Reading the review profiles…', () => source.profiles());
	if (listed.kind === 'none') {
		later(() => offerSetup(deps, NO_PROFILE_TEXT));
		return 'no-profile';
	}
	if (listed.kind !== 'profiles') {
		await unavailable(ui, 'A review cannot be started', listed.detail);
		return 'unavailable';
	}

	const profile = await ui.pickProfile(listed.list.profiles.map(item => item.name));
	if (profile === undefined) {
		return 'cancelled';
	}

	const branches = await deps.branches();
	const where = await ui.pickTarget(
		branches.local.filter(name => name !== branches.current),
		branches.current,
	);
	if (!where) {
		return 'cancelled';
	}

	const prompt = await ui.askPrompt(MAX_REVIEW_PROMPT);
	if (prompt === undefined) {
		return 'cancelled';
	}

	const plan: ReviewPlan = {
		profile,
		target: where.target,
		prompt: prompt.trim().length > 0 ? prompt : undefined,
		timeoutMinutes: deps.timeoutMinutes(),
	};

	const config = await ui.withProgress('Reading what the review would load…', () => source.config(plan));
	if (config.kind === 'refused') {
		// The CLI's refusal is shown as it was written. No trust flag is offered or added.
		await ui.warn(config.message);
		return 'failed';
	}
	if (config.kind !== 'config') {
		await unavailable(ui, 'A review cannot be started', config.detail);
		return 'unavailable';
	}

	// The login is read again just before the question, so the question names the login the terminal runs as.
	const acting = await deps.acting();
	if (!acting) {
		await ui.warn(NO_LOGIN);
		return 'no-login';
	}

	const question = reviewConfirmation(
		{
			plan,
			currentBranch: branches.current,
			config: config.config,
			description: help.value.description,
			timeoutHelp: help.value.timeoutHelp,
		},
		acting,
	);
	if (!(await ui.confirm(question))) {
		return 'declined';
	}

	const prepared = await source.prepareRun(plan, acting);
	if (!prepared.ok) {
		await unavailable(ui, 'The review was not started', prepared.detail);
		return 'unavailable';
	}
	openTerminal(deps, prepared, true);
	ui.notify(REVIEW_STARTED_TEXT);
	return 'started';
}
