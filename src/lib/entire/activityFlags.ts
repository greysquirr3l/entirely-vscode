import { pickFlags, describeFlag, readChoices, type FlagWant } from './controlPlaneFlags';
import { readCurrentRepo } from './workSearchFlags';
import type { HelpFlag } from './search';

/**
 * The environment that makes the CLI print static text.
 *
 * `entire activity` opens a terminal interface when it sees a terminal,
 * and falls back to plain text when the output is piped or when
 * accessibility mode is on. The extension is not a terminal, so it asks
 * for the plain text both ways: the runner pipes the output, and this
 * variable, which the CLI documents for screen readers, switches its
 * interactive screens and prompts off.
 */
export const STATIC_OUTPUT_ENV: Readonly<Record<string, string>> = { ACCESSIBLE: '1' };

/** The environment for a command, with the static output switched on. */
export function staticEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return { ...base, ...STATIC_OUTPUT_ENV };
}

/** Which list `entire activity` shows under the overview. */
export type ActivityListing = 'sessions' | 'commits';

/** The flag of `entire activity` that swaps sessions for commits. */
export const ACTIVITY_WANTS = {
	commits: { name: /commit/i, description: /\bcommits\b/i },
} as const;

/** The flags of `entire recap`. Without the static flag the command opens its interactive screen. */
export const RECAP_WANTS = {
	static: { description: /\bstatic\b/i, required: true },
	color: { name: /colou?r/i },
	day: { description: /\btoday\b/i },
	week: { description: /\b7 days\b|\bweek\b/i },
	month: { description: /\bmonth\b/i },
	rolling: { description: /\b90\b/ },
} as const satisfies Record<string, FlagWant>;

export type RecapFlags = Readonly<Partial<Record<keyof typeof RECAP_WANTS, string>>>;

/** The flags of `entire dispatch`. */
export const DISPATCH_WANTS = {
	local: { description: /\blocally[- ]installed\b/i },
	since: { name: /since/i, description: /^time window\b/i },
	jurisdiction: { name: /jurisdiction/i, description: /\bjurisdiction\b/i },
} as const satisfies Record<string, FlagWant>;

export type DispatchFlags = Readonly<Partial<Record<keyof typeof DISPATCH_WANTS, string>>>;

/** The arguments of the activity listing, or undefined when this CLI has no flag for the commit list. */
export function activityArguments(commitsFlag: string | undefined, listing: ActivityListing): readonly string[] | undefined {
	if (listing === 'commits') {
		return commitsFlag ? ['activity', commitsFlag] : undefined;
	}
	return ['activity'];
}

/** One period a recap can cover, labelled with the CLI's own words for it. */
export interface RecapPeriod {
	readonly label: string;
	readonly flag: string;
}

function periodLabel(description: string): string {
	const label = description.replace(/\s*\((?:default)[^)]*\)\s*$/i, '').trim();
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The periods the help describes, in the order of the CLI's own flags. */
export function recapPeriods(table: readonly HelpFlag[], flags: RecapFlags): readonly RecapPeriod[] {
	const periods: RecapPeriod[] = [];
	for (const key of ['day', 'week', 'month', 'rolling'] as const) {
		const flag = flags[key];
		if (flag) {
			periods.push({ label: periodLabel(describeFlag(table, flag)), flag });
		}
	}
	return periods;
}

/** Arguments for a static recap. The colour flag is only used when the help says it accepts `never`. */
export function recapArguments(
	flags: RecapFlags,
	table: readonly HelpFlag[],
	period: RecapPeriod | undefined,
): readonly string[] | undefined {
	if (!flags.static) {
		return undefined;
	}
	const args = ['recap', flags.static];
	if (flags.color && readChoices(describeFlag(table, flags.color)).includes('never')) {
		args.push(`${flags.color}=never`);
	}
	if (period) {
		args.push(period.flag);
	}
	return args;
}

/** What the extension picked out of one command's help. */
export type CommandFlags<K extends string> =
	| {
			readonly ok: true;
			readonly flags: Readonly<Partial<Record<K, string>>>;
			readonly table: readonly HelpFlag[];
			readonly currentRepo: string | undefined;
	  }
	| { readonly ok: false; readonly detail: string };

/** Picks flags from a command's help, and reads the repository the help says it acts on. */
export function readCommandFlags<K extends string>(
	command: string,
	help: string,
	fallback: readonly HelpFlag[],
	wants: Readonly<Record<K, FlagWant>>,
): CommandFlags<K> {
	const picked = pickFlags(command, help, fallback, wants);
	if (!picked.ok) {
		return picked;
	}
	return { ok: true, flags: picked.flags, table: picked.table, currentRepo: readCurrentRepo(help) };
}

/** The default a help line states, such as `7d` from `(default "7d")`. */
export function readDefaultValue(description: string): string | undefined {
	return /\(default\s+"([^"]*)"\)/i.exec(description)?.[1];
}

/** Whether a time window can be passed as a flag value: letters, digits and the few marks a duration or date has. */
export function isTimeWindow(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9:.+_ -]{0,63}$/.test(value);
}

/** Whether a value can name a jurisdiction, such as `us` or `eu`. */
export function isJurisdictionSlug(value: string): boolean {
	return /^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(value);
}

/** Why a command could not be used, in words that say what to do. */
export function describeHelpFailure(command: string, purpose: string, reason: string, detail: string): string {
	switch (reason) {
		case 'absent':
			return `the Entire CLI is not installed; install it to ${purpose}`;
		case 'broken':
		case 'spawn-failed':
		case 'timeout':
			return detail;
		default:
			return `this version of the Entire CLI has no '${command}' command; update the CLI`;
	}
}

/** Adds the way forward to a failure that reads as a missing login. */
export function withSignInHint(detail: string): string {
	return /\b(log(?:ged)?[ -]?in|sign(?:ed)?[ -]?in|authenticat|unauthori[sz]ed|credentials?)\b/i.test(detail)
		? `${detail} (use "Entirely: Sign In to Entire" or run entire login)`
		: detail;
}
