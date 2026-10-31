import { isBranchName, isCommitRef } from './sessionLifecycle';
import type { FlagWant } from './controlPlaneFlags';

/**
 * The flags of `entire review` the extension uses, found by name.
 *
 * The first six are picked only so no other want can claim them. They are
 * the profile writers, the trust approval and the listings that may start
 * agent programs: the extension never passes any of them. The setup flag is
 * the one exception, used alone to open the CLI's own wizard in a terminal.
 */
export const REVIEW_WANTS = {
	trust: { name: /trust/i },
	edit: { name: /^--edit$/ },
	agents: { name: /^--agents$/ },
	models: { name: /^--models$/ },
	agent: { name: /^--agent$/ },
	model: { name: /^--model$/ },
	configure: { name: /^--configure$/ },
	list: { name: /^--list$/ },
	showConfig: { name: /^--show-config$/ },
	findings: { name: /^--findings$/ },
	json: { name: /^--json$/, description: /\bprint json\b/i },
	profile: { name: /^--profile$/ },
	prompt: { name: /^--prompt$/ },
	target: { name: /^--target$/ },
	base: { name: /^--base$/ },
	timeout: { name: /^--timeout$/ },
} as const satisfies Record<string, FlagWant>;

export type ReviewFlags = Readonly<Partial<Record<keyof typeof REVIEW_WANTS, string>>>;

/** An argument that approves someone else's code or writes a profile. Never passed on the person's behalf. */
const FORBIDDEN_ARGUMENT = /^--(?:trust|set-)/i;

/** Whether an argument is one the extension never passes. */
export function isForbiddenReviewArgument(argument: string): boolean {
	return FORBIDDEN_ARGUMENT.test(argument);
}

/** One review profile the CLI lists. The name is an opaque string. */
export interface ReviewProfile {
	readonly name: string;
	/** The indented lines under the name, as the CLI wrote them. */
	readonly lines: readonly string[];
}

export interface ReviewProfileList {
	readonly profiles: readonly ReviewProfile[];
	/** Whether the CLI said no profile is configured. */
	readonly noneConfigured: boolean;
}

/**
 * Reads the output of `entire review --list`.
 *
 * Only the empty message was observed. For a configured profile the name is
 * taken as the first word of each line that is not indented; the indented
 * lines under it are kept as the CLI wrote them. A name is never looked up in
 * a table: it may be anything, including something that looks like a model.
 */
export function parseProfileList(text: string): ReviewProfileList {
	const body = text.replace(/\r\n?/g, '\n');
	if (/no review profiles configured/i.test(body)) {
		return { profiles: [], noneConfigured: true };
	}
	const profiles: { name: string; lines: string[] }[] = [];
	for (const raw of body.split('\n')) {
		if (raw.trim().length === 0) {
			continue;
		}
		if (/^\s/.test(raw)) {
			profiles[profiles.length - 1]?.lines.push(raw.trim());
			continue;
		}
		if (/^(?:review\s+)?profiles:?$/i.test(raw.trim())) {
			continue;
		}
		const first = raw.trim().split(/\s+/)[0]?.replace(/:$/, '') ?? '';
		if (first.length === 0) {
			continue;
		}
		const rest = raw.trim().slice(raw.trim().indexOf(first) + first.length).replace(/^:?\s*/, '');
		profiles.push({ name: first, lines: rest.length > 0 ? [rest] : [] });
	}
	return { profiles, noneConfigured: false };
}

const PROFILE_NAME = /^[^\s\u0000-\u001f-][^\s\u0000-\u001f]{0,199}$/;

/** Whether a profile name can be handed to the CLI as the value of its flag. */
export function isProfileName(value: string): boolean {
	return PROFILE_NAME.test(value);
}

/** The longest one-off instruction that is passed. */
export const MAX_REVIEW_PROMPT = 2000;

/** What a review run is asked to do. */
export interface ReviewPlan {
	readonly profile: string;
	/** A branch to check out in a worktree and review, when it is not the current one. */
	readonly target?: string;
	readonly base?: string;
	readonly prompt?: string;
	/** Minutes each reviewer may run; zero or absent means no limit. */
	readonly timeoutMinutes?: number;
}

export type ReviewArguments =
	| { readonly ok: true; readonly args: readonly string[] }
	| { readonly ok: false; readonly detail: string };

/**
 * The arguments of a review run.
 *
 * A review whose profile flag the help does not describe is not started.
 * Values are attached with `=` so a prompt that starts with a dash or holds
 * `--` stays one argument. A timeout is added only when the help lists a
 * timeout flag. No trust or profile-writing flag can be produced here.
 */
export function reviewRunArguments(flags: ReviewFlags, plan: ReviewPlan): ReviewArguments {
	if (!flags.profile) {
		return { ok: false, detail: 'this version of the Entire CLI does not describe the profile flag of review; update the CLI' };
	}
	if (!isProfileName(plan.profile)) {
		return { ok: false, detail: 'the profile name is not one the CLI can be given' };
	}
	const args = ['review', `${flags.profile}=${plan.profile}`];
	if (plan.target !== undefined) {
		if (!flags.target) {
			return { ok: false, detail: 'this version of the Entire CLI does not describe the target flag of review; update the CLI' };
		}
		if (!isBranchName(plan.target)) {
			return { ok: false, detail: 'the target is not a branch name the CLI can be given' };
		}
		args.push(`${flags.target}=${plan.target}`);
	}
	if (plan.base !== undefined) {
		if (!flags.base) {
			return { ok: false, detail: 'this version of the Entire CLI does not describe the base flag of review; update the CLI' };
		}
		if (!isCommitRef(plan.base)) {
			return { ok: false, detail: 'the base is not a ref the CLI can be given' };
		}
		args.push(`${flags.base}=${plan.base}`);
	}
	if (plan.prompt !== undefined && plan.prompt.length > 0) {
		if (!flags.prompt) {
			return { ok: false, detail: 'this version of the Entire CLI does not describe the prompt flag of review; update the CLI' };
		}
		if (plan.prompt.length > MAX_REVIEW_PROMPT || /\u0000/.test(plan.prompt)) {
			return { ok: false, detail: `the instruction must be text of at most ${MAX_REVIEW_PROMPT} characters` };
		}
		args.push(`${flags.prompt}=${plan.prompt}`);
	}
	if (flags.timeout && plan.timeoutMinutes !== undefined && plan.timeoutMinutes > 0) {
		args.push(`${flags.timeout}=${Math.floor(plan.timeoutMinutes)}m`);
	}
	return args.some(isForbiddenReviewArgument) ? { ok: false, detail: 'a trust or setup flag cannot be passed' } : { ok: true, args };
}

/** The read-only listing of profiles. */
export function reviewListArguments(flags: ReviewFlags): readonly string[] | undefined {
	return flags.list ? ['review', flags.list] : undefined;
}

/** What a review would load, as structured output. The target and profile narrow it. */
export function reviewConfigArguments(flags: ReviewFlags, plan: Pick<ReviewPlan, 'profile' | 'target' | 'base'> | undefined): readonly string[] | undefined {
	if (!flags.showConfig || !flags.json) {
		return undefined;
	}
	const args = ['review', flags.showConfig, flags.json];
	if (plan) {
		if (flags.profile && isProfileName(plan.profile)) {
			args.push(`${flags.profile}=${plan.profile}`);
		}
		if (plan.target !== undefined && flags.target && isBranchName(plan.target)) {
			args.push(`${flags.target}=${plan.target}`);
		}
		if (plan.base !== undefined && flags.base && isCommitRef(plan.base)) {
			args.push(`${flags.base}=${plan.base}`);
		}
	}
	return args;
}

/** The saved findings, printed rather than browsed. */
export function reviewFindingsArguments(flags: ReviewFlags): readonly string[] | undefined {
	return flags.findings ? ['review', flags.findings] : undefined;
}

/** The CLI's own setup, which opens a wizard in a terminal. No setting flag goes with it. */
export function reviewSetupArguments(flags: ReviewFlags): readonly string[] | undefined {
	return flags.configure ? ['review', flags.configure] : undefined;
}
