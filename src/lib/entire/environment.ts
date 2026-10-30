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

/** What the extension knows about the window it runs in. */
export interface WindowHost {
	/** The remote the window is connected to, such as `ssh-remote`. */
	readonly remoteName: string | undefined;
	/** Whether the editor is a desktop app or runs in a browser. */
	readonly uiKind: 'desktop' | 'web';
}

/** Where the browser a person signs in with is. */
export type BrowserLocation =
	| { readonly kind: 'local-display' }
	| { readonly kind: 'remote'; readonly remoteName: string }
	| { readonly kind: 'web' }
	| { readonly kind: 'headless' };

/**
 * Where the person's browser is, relative to the extension host.
 *
 * In a remote or browser-based window the host has no display, but the
 * person's own machine does, so the host's environment says nothing
 * about whether a browser is within reach.
 */
export function locateBrowser(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	host: WindowHost,
): BrowserLocation {
	if (host.uiKind === 'web') {
		return { kind: 'web' };
	}

	const remoteName = host.remoteName?.trim() ?? '';

	if (remoteName.length > 0) {
		return { kind: 'remote', remoteName };
	}

	return isHeadlessEnvironment(env, platform) ? { kind: 'headless' } : { kind: 'local-display' };
}

/** Plain words for the remotes people meet most. */
const REMOTE_WORDS: Readonly<Record<string, string>> = {
	'ssh-remote': 'a remote host over SSH',
	'dev-container': 'a container',
	'attached-container': 'a container',
	wsl: 'WSL',
	codespaces: 'a codespace',
};

/** A remote's name in plain words, or the name itself when it is not a common one. */
export function describeRemote(remoteName: string): string {
	return REMOTE_WORDS[remoteName] ?? remoteName;
}

/**
 * Why the sign-in uses a code, in a sentence.
 *
 * The sentence is shown before the sign-in starts, because a user who
 * is asked for a device code on a machine with a browser would otherwise
 * wonder what had gone wrong. It is empty when the sign-in has no reason
 * to use a code.
 */
export function describeSignInLocation(location: BrowserLocation): string {
	switch (location.kind) {
		case 'local-display':
			return '';
		case 'remote':
			return `Entirely is running on ${describeRemote(location.remoteName)} (${location.remoteName}), so the sign-in uses a code you enter in your browser.`;
		case 'web':
			return 'Entirely is running in a browser-based editor, so the sign-in uses a code you enter in your browser.';
		case 'headless':
			return 'This machine has no graphical display, so the sign-in uses a code you enter in a browser on another machine.';
	}
}
