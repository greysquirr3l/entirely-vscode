import {
	ACTIVITY_WANTS,
	activityArguments,
	describeHelpFailure,
	failureDetail,
	parseActivity,
	readCommandFlags,
	staticEnvironment,
	withSignInHint,
	type ActivityListing,
	type ActivityOverview,
} from '../lib/entire';
import type { CliRunner } from './cli';

export type ActivityOutcome =
	| { readonly kind: 'found'; readonly overview: ActivityOverview }
	| { readonly kind: 'empty' }
	| { readonly kind: 'unreadable'; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where the activity view gets its numbers. */
export interface ActivitySource {
	read(listing: ActivityListing): Promise<ActivityOutcome>;
}

export interface ActivityOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, `entire activity` may take. */
	readonly timeoutSeconds: () => number;
}

/**
 * Reads the account's activity from `entire activity`.
 *
 * The command is run in its static form: its output is piped, never a
 * terminal, and the CLI is told to print plain text. The commit list is
 * only asked for when the CLI's help describes the flag for it, and the
 * help is read on every call. The text is parsed, not rebuilt: the CLI
 * has no JSON for this view, so a layout it does not recognise is
 * reported as unreadable. The output holds the account's work, so it is
 * kept out of the invocation record.
 */
export class ActivityService implements ActivitySource {
	constructor(private readonly options: ActivityOptions) {}

	async read(listing: ActivityListing): Promise<ActivityOutcome> {
		const cwd = this.options.workspaceRoot();
		const usage = await this.options.runner.usage('activity', { cwd });
		if (!usage.ok) {
			return { kind: 'failed', detail: describeHelpFailure('activity', 'see your activity', usage.reason, usage.detail) };
		}
		const picked = readCommandFlags('activity', usage.value.raw, usage.value.flags, ACTIVITY_WANTS);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const args = activityArguments(picked.flags.commits, listing);
		if (!args) {
			return { kind: 'failed', detail: 'this version of the Entire CLI cannot list recent commits in its activity view; update the CLI' };
		}

		const result = await this.options.runner.run(args, {
			cwd,
			timeoutMs: this.options.timeoutSeconds() * 1000,
			env: staticEnvironment(),
			withholdBodies: true,
		});
		if (!result.ok) {
			return { kind: 'failed', detail: withSignInHint(failureDetail(result.stderr, result.stdout, result.detail)) };
		}

		const reading = parseActivity(result.stdout, listing);
		switch (reading.kind) {
			case 'overview':
				return { kind: 'found', overview: reading.overview };
			case 'empty':
				return { kind: 'empty' };
			case 'unreadable':
				return { kind: 'unreadable', detail: reading.detail };
		}
	}
}
