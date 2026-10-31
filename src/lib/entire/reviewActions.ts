import { describeActingLogin, type ControlConfirmation } from './controlPlaneActions';
import type { AccountContext } from './accountContext';
import { countLoaded, type ReviewConfig } from './reviewConfig';
import type { ReviewPlan } from './review';

/** What the question before a review is built from. */
export interface ReviewQuestion {
	readonly plan: ReviewPlan;
	/** The branch checked out now, when the git extension reported it. */
	readonly currentBranch?: string;
	/** What `--show-config` reported. */
	readonly config: ReviewConfig;
	/** The first paragraph of the CLI's help for review, quoted. */
	readonly description?: string;
	/** The CLI's help line for its timeout flag, quoted, when the help lists one. */
	readonly timeoutHelp?: string;
}

function branchWords(question: ReviewQuestion): string {
	const { plan } = question;
	const base = plan.base ? ` against ${plan.base}` : '';
	if (plan.target) {
		return `branch ${plan.target} (checked out in a worktree)${base}`;
	}
	return `${question.currentBranch ? `the current branch, ${question.currentBranch}` : 'the current branch'}${base}`;
}

function timeLimitWords(question: ReviewQuestion): string {
	const minutes = question.plan.timeoutMinutes ?? 0;
	if (minutes > 0 && question.timeoutHelp !== undefined) {
		return `Each reviewer is cut off after ${minutes} minutes (the setting entirely.reviewReviewerTimeoutMinutes).`;
	}
	if (minutes > 0) {
		return `The setting entirely.reviewReviewerTimeoutMinutes is ${minutes}, but this version of the Entire CLI does not describe a timeout flag, so no limit is applied.`;
	}
	return 'There is no time limit: reviewers run until they finish unless you set entirely.reviewReviewerTimeoutMinutes.';
}

/**
 * The question asked before a review starts.
 *
 * It names the profile, what is reviewed, the login the review runs as on
 * Entire, and that agents are started that spend tokens on the person's own
 * agent accounts. The CLI's own description and timeout wording are quoted.
 */
export function reviewConfirmation(question: ReviewQuestion, acting: Pick<AccountContext, 'handle' | 'name'>): ControlConfirmation {
	const counts = countLoaded(question.config);
	const detail: string[] = [
		`Profile: ${question.plan.profile}.`,
		`Reviews ${branchWords(question)}, as ${describeActingLogin(acting)} on Entire.`,
	];
	if (question.description) {
		detail.push(`The Entire CLI describes it: "${question.description}"`);
	}
	detail.push(
		"This starts the profile's reviewer agents and a judge agent on your machine, in a terminal. They use your own agent accounts and spend tokens there.",
	);
	detail.push(timeLimitWords(question));
	if (question.timeoutHelp) {
		detail.push(`The CLI says of its timeout: "${question.timeoutHelp}"`);
	}
	detail.push(
		`The reviewer would load ${counts.hooks} hooks and ${counts.mcpServers} MCP servers from the checkout (use "Entirely: Show What a Review Would Run" to read them).`,
	);
	if (question.config.yours === false) {
		detail.push(
			'You did not author the code under review. The reviewer will load the hooks and MCP servers of code you did not write, and the CLI will ask you to approve that in the terminal. Entirely does not approve it for you.',
		);
	} else if (question.config.yours === undefined) {
		detail.push('The CLI did not say whether you authored the code under review. If you did not, it asks you to approve loading its hooks and MCP servers in the terminal.');
	}
	detail.push('The review is started once. If it fails it is not started again.');
	return {
		message: `Start the "${question.plan.profile}" review of ${question.plan.target ?? question.currentBranch ?? 'this branch'}?`,
		detail: detail.join('\n\n'),
		action: 'Start Review',
	};
}

/** The question before the CLI's own setup wizard is opened. */
export function reviewSetupConfirmation(acting: Pick<AccountContext, 'handle' | 'name'> | undefined): ControlConfirmation {
	return {
		message: "Open the Entire CLI's review setup in a terminal?",
		detail:
			"The CLI's wizard asks which reviewer agents, models and judge to use and where to save the profile (shared settings or just you). " +
			'It writes a profile only when you finish it, and it does not start any agent. Entirely does not choose anything for you.' +
			(acting ? ` It runs as ${describeActingLogin(acting)}.` : ''),
		action: 'Open Setup',
	};
}

/** The message for a review that ended. The terminal holds the CLI's own output. */
export function describeReviewExit(exitCode: number | undefined): string | undefined {
	if (exitCode === undefined || exitCode === 0) {
		return undefined;
	}
	return `The review ended with exit code ${exitCode}. It was not started again; the terminal shows what the CLI said. If it refused to review code you did not write, run it in a terminal yourself and decide there whether to trust it.`;
}

/** The message after the terminal opened. */
export const REVIEW_STARTED_TEXT =
	'The review is running in a terminal. When it finishes, use "Entirely: Show Saved Review Findings" to read the saved run.';

/** The message for a profile list that is empty. */
export const NO_PROFILE_TEXT =
	'No review profile is configured for this repository. Review profiles are set up by the Entire CLI; no agent has been started.';
