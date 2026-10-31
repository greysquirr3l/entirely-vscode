import {
	REVIEW_WANTS,
	cliReason,
	decodeReviewConfig,
	failureDetail,
	firstParagraph,
	longestFlagDescription,
	parseProfileList,
	reviewConfigArguments,
	reviewFindingsArguments,
	reviewListArguments,
	reviewRunArguments,
	reviewSetupArguments,
	staticEnvironment,
	stripTerminalCodes,
	unwrap,
	type AccountContext,
	type ReviewConfig,
	type ReviewFlags,
	type ReviewPlan,
	type ReviewProfileList,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { readCommandHelp, type Unavailable } from './commandHelp';
import type { ResumeLaunch } from './sessionLifecycle';

/** A review, setup or findings browser running in a terminal. */
export interface ReviewProcess {
	/** Calls the listener once, with the exit code when the terminal reports one, when the process ends. */
	onExit(listener: (exitCode: number | undefined) => void): void;
}

/** Opens a terminal on the CLI. */
export type ReviewLauncher = (launch: Extract<ResumeLaunch, { ok: true }>) => ReviewProcess;

/** What the CLI's help says about review, for the question before a run. */
export interface ReviewHelp {
	readonly flags: ReviewFlags;
	/** The first paragraph of the help. */
	readonly description?: string;
	/** The help line of the timeout flag, when the help lists one. */
	readonly timeoutHelp?: string;
}

/** The text of a read-only listing. It is the CLI's own, not kept anywhere. */
export type TextOutcome =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'empty' }
	/** The command waited for a terminal. */
	| { readonly kind: 'needsTerminal' }
	| Unavailable;

export type ProfilesOutcome =
	| { readonly kind: 'profiles'; readonly list: ReviewProfileList; readonly text: string }
	| { readonly kind: 'none' }
	| Unavailable;

export type ConfigOutcome =
	| { readonly kind: 'config'; readonly config: ReviewConfig }
	/** The CLI refused. Its message is carried as it was written. */
	| { readonly kind: 'refused'; readonly message: string }
	| Unavailable;

export type LaunchPlan =
	| { readonly ok: true; readonly launch: Extract<ResumeLaunch, { ok: true }> }
	| ({ readonly ok: false } & Unavailable);

/** Where reviews are read and started. */
export interface ReviewSource {
	help(): Promise<{ readonly ok: true; readonly value: ReviewHelp } | ({ readonly ok: false } & Unavailable)>;
	profiles(): Promise<ProfilesOutcome>;
	config(plan: Pick<ReviewPlan, 'profile' | 'target' | 'base'> | undefined): Promise<ConfigOutcome>;
	findings(): Promise<TextOutcome>;
	/** Builds the terminal command of a run. Nothing is started. */
	prepareRun(plan: ReviewPlan, acting: AccountContext): Promise<LaunchPlan>;
	prepareSetup(acting: AccountContext | undefined): Promise<LaunchPlan>;
	prepareFindingsTerminal(): Promise<LaunchPlan>;
}

export interface ReviewOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, a read-only mode may take. */
	readonly readTimeoutSeconds: () => number;
}

const PURPOSE = 'work with reviews';

/**
 * Reads the CLI's review modes and builds the terminal command of a run.
 *
 * The read-only modes (`--list`, `--show-config --json`, `--findings`) run
 * through the runner with static output and their text kept out of the
 * invocation record. A run starts agents that spend tokens, so it is never
 * run here: this builds the command, and the caller opens a terminal after
 * the person agreed. Every flag comes from the command's own help, read for
 * every call. A trust flag and the profile-writing flags are never built.
 */
export class ReviewService implements ReviewSource {
	constructor(private readonly options: ReviewOptions) {}

	private async read() {
		const cwd = this.options.workspaceRoot();
		const timeoutMs = this.options.readTimeoutSeconds() * 1000;
		const help = await readCommandHelp(this.options.runner, 'review', PURPOSE, REVIEW_WANTS, { cwd, timeoutMs });
		return { help, cwd, timeoutMs };
	}

	async help() {
		const { help } = await this.read();
		if (!help.ok) {
			return help;
		}
		return {
			ok: true as const,
			value: {
				flags: help.flags,
				description: firstParagraph(help.raw),
				timeoutHelp: help.flags.timeout ? longestFlagDescription(help.raw, help.flags.timeout) : undefined,
			},
		};
	}

	/** Runs one read-only mode and returns its text. */
	private async text(args: readonly string[] | undefined, missing: string, cwd: string | undefined, timeoutMs: number): Promise<TextOutcome> {
		if (!args) {
			return { kind: 'unsupported', detail: `this version of the Entire CLI does not describe ${missing} of 'review'; update the CLI` };
		}
		const result = await this.options.runner.run(args, { cwd, timeoutMs, env: staticEnvironment(), withholdBodies: true });
		if (!result.ok) {
			if (result.reason === 'absent' || result.reason === 'broken') {
				return { kind: 'noCli', detail: result.detail };
			}
			if (result.reason === 'timeout') {
				return { kind: 'needsTerminal' };
			}
			return { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		const text = stripTerminalCodes(result.stdout).trim();
		return text.length > 0 ? { kind: 'text', text } : { kind: 'empty' };
	}

	async profiles(): Promise<ProfilesOutcome> {
		const { help, cwd, timeoutMs } = await this.read();
		if (!help.ok) {
			return help;
		}
		const outcome = await this.text(reviewListArguments(help.flags), 'the flag that lists profiles', cwd, timeoutMs);
		if (outcome.kind === 'text') {
			const list = parseProfileList(outcome.text);
			return list.noneConfigured ? { kind: 'none' } : { kind: 'profiles', list, text: outcome.text };
		}
		if (outcome.kind === 'empty') {
			return { kind: 'none' };
		}
		if (outcome.kind === 'needsTerminal') {
			return { kind: 'failed', detail: 'listing the profiles took longer than entirely.reviewReadTimeout' };
		}
		return outcome;
	}

	async config(plan: Pick<ReviewPlan, 'profile' | 'target' | 'base'> | undefined): Promise<ConfigOutcome> {
		const { help, cwd, timeoutMs } = await this.read();
		if (!help.ok) {
			return help;
		}
		const args = reviewConfigArguments(help.flags, plan);
		if (!args) {
			return { kind: 'unsupported', detail: "this version of the Entire CLI cannot print what a review would run as JSON; update the CLI" };
		}
		const result = await this.options.runner.runJson(args, value => unwrap(decodeReviewConfig(value)), {
			cwd,
			timeoutMs,
			env: staticEnvironment(),
			withholdBodies: true,
		});
		if (result.ok) {
			return { kind: 'config', config: result.value };
		}
		if (result.reason === 'absent' || result.reason === 'broken') {
			return { kind: 'noCli', detail: result.detail };
		}
		if (result.reason === 'exit-code') {
			// A refusal, such as a target whose commit the person did not author, is shown as the CLI wrote it.
			const message = cliReason(result.stderr) || cliReason(result.stdout) || result.detail;
			return { kind: 'refused', message };
		}
		return { kind: 'failed', detail: failureDetail(result.stderr, '', result.detail) };
	}

	async findings(): Promise<TextOutcome> {
		const { help, cwd, timeoutMs } = await this.read();
		if (!help.ok) {
			return help;
		}
		return this.text(reviewFindingsArguments(help.flags), 'the flag that shows saved findings', cwd, timeoutMs);
	}

	async prepareRun(plan: ReviewPlan, acting: AccountContext): Promise<LaunchPlan> {
		const { help } = await this.read();
		if (!help.ok) {
			return { ok: false, kind: help.kind, detail: help.detail };
		}
		const built = reviewRunArguments(help.flags, plan);
		if (!built.ok) {
			return { ok: false, kind: 'unsupported', detail: built.detail };
		}
		return this.terminal(built.args, acting.name);
	}

	async prepareSetup(acting: AccountContext | undefined): Promise<LaunchPlan> {
		const { help } = await this.read();
		if (!help.ok) {
			return { ok: false, kind: help.kind, detail: help.detail };
		}
		const args = reviewSetupArguments(help.flags);
		if (!args) {
			return { ok: false, kind: 'unsupported', detail: "this version of the Entire CLI does not describe the setup flag of 'review'; update the CLI" };
		}
		return this.terminal(args, acting?.name);
	}

	async prepareFindingsTerminal(): Promise<LaunchPlan> {
		const { help } = await this.read();
		if (!help.ok) {
			return { ok: false, kind: help.kind, detail: help.detail };
		}
		const args = reviewFindingsArguments(help.flags);
		if (!args) {
			return { ok: false, kind: 'unsupported', detail: "this version of the Entire CLI does not describe the findings flag of 'review'; update the CLI" };
		}
		return this.terminal(args, undefined);
	}

	private async terminal(args: readonly string[], context: string | undefined): Promise<LaunchPlan> {
		const command = await this.options.runner.terminalCommand(args, context);
		if (!command.ok) {
			return { ok: false, kind: 'noCli', detail: command.detail };
		}
		return { ok: true, launch: { ...command, cwd: this.options.workspaceRoot() } };
	}
}
