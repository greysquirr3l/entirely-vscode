/**
 * The machine the extension is running on.
 *
 * Some of what the CLI can do depends on the machine it runs on. The
 * sign-in flow is the clearest case: a browser redirect needs a
 * graphical display to open, and a machine without one has to use the
 * device-code flow instead.
 */

/** The platforms that have no graphical display of their own. */
const WITHOUT_DISPLAY = new Set<NodeJS.Platform>(['linux', 'freebsd', 'openbsd', 'netbsd', 'sunos', 'aix']);

/**
 * Whether the machine has no graphical display.
 *
 * A desktop operating system always has one, so the answer there is no.
 * Everywhere else the display is named by an environment variable, and
 * a machine without one — a container, a remote host, an SSH session —
 * has neither a browser to redirect to nor a screen to read a code from.
 */
export function isHeadlessEnvironment(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (!WITHOUT_DISPLAY.has(platform)) {
		return false;
	}

	const display = env.DISPLAY?.trim() ?? '';
	const wayland = env.WAYLAND_DISPLAY?.trim() ?? '';

	return display.length === 0 && wayland.length === 0;
}

/**
 * Why the machine counts as headless, in a sentence.
 *
 * The sentence is shown before the sign-in starts, because a user who
 * is asked for a device code on a machine with a browser would otherwise
 * wonder what had gone wrong.
 */
export function describeHeadlessEnvironment(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): string {
	if (!isHeadlessEnvironment(env, platform)) {
		return '';
	}

	return 'This machine has no graphical display, so the sign-in uses a code you enter in a browser on another machine.';
}
