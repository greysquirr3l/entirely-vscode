import {
	adoptArguments,
	asksForAgreement,
	attachArguments,
	cleanCliText,
	failureDetail,
	isBranchName,
	isCommitRef,
	isSessionId,
	isWorktreePath,
	planAdoptFlags,
	planAttachFlags,
	planResumeFlags,
	planStopFlags,
	resumeArguments,
	stopArguments,
	type LifecycleAction,
	type LifecycleOutcome,
	type LifecyclePlan,
} from '../lib/entire';
import type { AttachFlags, HelpFlag } from '../lib/entire';
import type { CliRunner } from './cli';

/** What the service needs to do its job. */
export interface SessionLifecycleOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, a lifecycle command may take. */
	readonly timeoutSeconds: () => number;
}

/** What the extension needs to start a resume in a terminal. */
export type ResumeLaunch =
	| {
			readonly ok: true;
			readonly path: string;
			readonly args: readonly string[];
			readonly env: Record<string, string>;
			readonly cwd: string | undefined;
	  }
	| { readonly ok: false; readonly detail: string };

/** Where lifecycle commands go. */
export interface SessionLifecycleSource {
	stop(sessionId: string): Promise<LifecycleOutcome>;
	/** Asks the CLI what attaching would do, without letting it change anything. */
	previewAttach(sessionId: string, commit: string): Promise<LifecycleOutcome>;
	/** Attaches, after the user has agreed to what the preview said. */
	attach(sessionId: string, commit: string): Promise<LifecycleOutcome>;
	adopt(sessionId: string, fromWorktree: string): Promise<LifecycleOutcome>;
	prepareResume(branch: string): Promise<ResumeLaunch>;
}

/**
 * Runs `entire session stop`, `attach`, `adopt` and `resume`.
 *
 * Each command's flags come from the CLI's own help, read for that call and
 * never cached, so a CLI that changes between two calls is followed and a
 * failed lookup is never remembered. Ids, refs, branches and paths are
 * checked before they reach an argument list, and go in the CLI's own
 * operand position. A missing CLI, a CLI too old to have the command, and a
 * CLI that refuses are failures with a reason, never successes.
 */
export class SessionLifecycleService implements SessionLifecycleSource {
	constructor(private readonly options: SessionLifecycleOptions) {}

	async stop(sessionId: string): Promise<LifecycleOutcome> {
		if (!isSessionId(sessionId)) {
			return refused('the session id is not one the CLI can be given');
		}
		const plan = await this.plan('stop', planStopFlags);
		if (!plan.ok) {
			return refused(plan.detail);
		}
		return this.mutate(stopArguments(plan, sessionId));
	}

	async previewAttach(sessionId: string, commit: string): Promise<LifecycleOutcome> {
		const plan = await this.attachPlan(sessionId, commit);
		if (!plan.ok) {
			return refused(plan.detail);
		}

		const result = await this.options.runner.run(attachArguments(plan, sessionId, commit, false), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			withholdBodies: true,
		});
		if (result.ok) {
			// The CLI had nothing to ask: the link already existed or needed no change.
			return { kind: 'done', summary: cleanCliText(result.stdout || result.stderr) };
		}

		const said = cleanCliText(result.stderr || result.stdout);
		if (result.reason === 'exit-code' && asksForAgreement(said, plan.proceed)) {
			return { kind: 'needs-agreement', preview: said };
		}
		return refused(failureDetail(result.stderr, result.stdout, result.detail));
	}

	async attach(sessionId: string, commit: string): Promise<LifecycleOutcome> {
		const plan = await this.attachPlan(sessionId, commit);
		if (!plan.ok) {
			return refused(plan.detail);
		}
		return this.mutate(attachArguments(plan, sessionId, commit, true), true);
	}

	async adopt(sessionId: string, fromWorktree: string): Promise<LifecycleOutcome> {
		if (!isSessionId(sessionId)) {
			return refused('the session id is not one the CLI can be given');
		}
		if (!isWorktreePath(fromWorktree)) {
			return refused('the source worktree is not an absolute path');
		}
		const plan = await this.plan('adopt', planAdoptFlags);
		if (!plan.ok) {
			return refused(plan.detail);
		}
		return this.mutate(adoptArguments(plan, sessionId, fromWorktree));
	}

	async prepareResume(branch: string): Promise<ResumeLaunch> {
		if (!isBranchName(branch)) {
			return { ok: false, detail: 'the branch name is not one the CLI can be given' };
		}
		const plan = await this.plan('resume', help => planResumeFlags(help));
		if (!plan.ok) {
			return { ok: false, detail: plan.detail };
		}
		const command = await this.options.runner.terminalCommand(resumeArguments(branch));
		if (!command.ok) {
			return { ok: false, detail: command.detail };
		}
		return { ...command, cwd: this.options.workspaceRoot() };
	}

	private timeoutMs(): number {
		return this.options.timeoutSeconds() * 1000;
	}

	private async attachPlan(sessionId: string, commit: string): Promise<LifecyclePlan<AttachFlags>> {
		if (!isSessionId(sessionId)) {
			return { ok: false, detail: 'the session id is not one the CLI can be given' };
		}
		if (!isCommitRef(commit)) {
			return { ok: false, detail: 'the commit is not a hash or ref the CLI can be given' };
		}
		return this.plan('attach', planAttachFlags);
	}

	/** Reads the command's help and works out its flags. */
	private async plan<T>(
		action: LifecycleAction,
		choose: (help: string, fallback: readonly HelpFlag[]) => LifecyclePlan<T>,
	): Promise<LifecyclePlan<T>> {
		const usage = await this.options.runner.usage(`session ${action}`, { cwd: this.options.workspaceRoot() });
		if (!usage.ok) {
			return { ok: false, detail: explainHelpFailure(action, usage.reason, usage.detail) };
		}
		return choose(usage.value.raw, usage.value.flags);
	}

	private async mutate(args: readonly string[], withholdBodies = false): Promise<LifecycleOutcome> {
		const result = await this.options.runner.run(args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			withholdBodies,
		});
		if (!result.ok) {
			return refused(failureDetail(result.stderr, result.stdout, result.detail));
		}
		return { kind: 'done', summary: cleanCliText(result.stdout || result.stderr) };
	}
}

function refused(detail: string): LifecycleOutcome {
	return { kind: 'failed', detail };
}

/** Says why the help could not be read, with something the user can do. */
function explainHelpFailure(action: LifecycleAction, reason: string, detail: string): string {
	switch (reason) {
		case 'absent':
			return `the Entire CLI is not installed; install it to ${action} a session`;
		case 'broken':
		case 'spawn-failed':
		case 'timeout':
			return detail;
		default:
			return `this version of the Entire CLI has no 'session ${action}'; update the CLI`;
	}
}
