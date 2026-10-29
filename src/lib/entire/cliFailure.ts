/**
 * What the CLI said when it could not do what was asked.
 *
 * A CLI that exits with a code says why on its error stream, and the
 * reason is usually the only thing that helps: that a project is not
 * visible from the login the extension is acting as, that the CLI is
 * too old, that the workspace is not tracked. Without it the person
 * sees an exit code and nothing to act on.
 *
 * These helpers read the CLI's own words rather than translating
 * status codes, because the CLI is the source of truth for what it
 * refuses and why.
 */

/** The lines of the CLI's error stream that are worth showing. */
const NOISE = [
	/^Using context /i,
	/^\s*$/,
];

/**
 * The reason the CLI gave, in its own words.
 *
 * The lines that say which context was used are left out: the person
 * being asked already knows which login the extension is acting as,
 * and the rest of the message is what they need. Long messages are
 * kept whole, because a reason that is cut off is not a reason.
 */
export function cliReason(stderr: string): string {
	const lines = stderr
		.split('\n')
		.map(line => line.trimEnd())
		.filter(line => !NOISE.some(pattern => pattern.test(line)));

	return lines.join('\n').trim();
}

/**
 * The ways the CLI says a project is invisible.
 *
 * The CLI refuses in two ways, and both mean the same thing to the
 * person reading them: this login cannot see the project.
 *
 * - A project the login has never been given says it is *not found* —
 *   a mirror the login is not a member of.
 * - A project whose grant was taken away says it is *not accessible* —
 *   the same project, seen a moment ago.
 *
 * The wording is the CLI's, so it is matched rather than translated.
 */
const INVISIBLE = [/project not found/i, /project is not accessible/i];

/**
 * Whether the CLI could not see the project from the acting login.
 *
 * A project is per-login: a login that cannot see a project cannot
 * list its trails, approve its changes or merge them. The extension
 * says so, because "the CLI exited with code 1" tells the person
 * nothing about what to do next.
 */
export function isProjectInvisible(stderr: string): boolean {
	return INVISIBLE.some(pattern => pattern.test(stderr));
}

/**
 * The message the extension shows when a trail command could not run.
 *
 * The CLI's own reason is preferred, because it names the thing that
 * is wrong. The exit code is the last resort, for a CLI that failed
 * without saying why.
 */
export function describeTrailFailure(detail: string, stderr: string): string {
	const reason = cliReason(stderr);

	if (reason.length > 0) {
		return reason;
	}

	return detail;
}
