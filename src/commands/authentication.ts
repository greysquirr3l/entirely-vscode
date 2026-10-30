import * as vscode from 'vscode';

import {
	describeSignInLocation,
	findVerificationUrl,
	locateBrowser,
} from '../lib/entire';
import type { WindowHost } from '../lib/entire';
import type { AccountContextService } from '../services/accountContext';
import type { AuthenticationService, SignInMethod } from '../services/authentication';
import { AuthenticationPanel } from '../providers/authenticationPanel';

/** What the person chose when the sign-in asked how to sign in. */
export interface SignInChoice {
	readonly method: SignInMethod;
	readonly label: string;
	readonly detail: string;
}

/** What the sign-in and sign-out commands need to do their job. */
export interface AuthenticationDependencies {
	/** Who the CLI is signed in as. */
	readonly authentication: AuthenticationService;
	/** Which logins the CLI has saved. */
	readonly accounts: AccountContextService;
	/** The folder the workspace is in. */
	readonly workspaceRoot: () => string | undefined;
	/** Where the extension's log is written. */
	readonly output: { appendLine(line: string): void };
	/** The environment the extension runs in. */
	readonly env?: NodeJS.ProcessEnv;
	/** The platform the extension runs on. */
	readonly platform?: NodeJS.Platform;
	/** The window the extension runs in. */
	readonly host?: WindowHost;
	/** How an address is opened in the person's own browser. */
	readonly openExternal?: (address: string) => Thenable<boolean>;
	/** How the person picks a way to sign in. */
	readonly pickMethod?: (choices: readonly SignInChoice[]) => Promise<SignInChoice | undefined>;
	/** How the person confirms the sign-out. */
	readonly confirmSignOut?: (warning: string) => Promise<boolean>;
}

/**
 * How the sign-in will be carried out.
 *
 * The device flow is offered whenever the CLI has it, because a browser
 * that is not on this machine is a situation the extension cannot see
 * but can still be ready for. When the browser is not on the machine the
 * CLI runs on, or there is none, it is the only flow that works, so it
 * is chosen rather than offered.
 */
export async function chooseSignInMethod(
	deviceOnly: boolean,
	deviceAvailable: boolean,
	pick: (choices: readonly SignInChoice[]) => Promise<SignInChoice | undefined> = pickWithQuickPick,
): Promise<SignInChoice | undefined> {
	const browser: SignInChoice = {
		method: 'browser',
		label: 'Sign in with a browser',
		detail: 'The CLI opens a browser window and you sign in there',
	};

	if (!deviceAvailable) {
		return browser;
	}

	const device: SignInChoice = {
		method: 'device',
		label: 'Sign in with a device code',
		detail: 'The CLI prints a code and you enter it in a browser on another machine',
	};

	if (deviceOnly) {
		return device;
	}

	return pick([browser, device]);
}

/** Asks the person which way to sign in. */
async function pickWithQuickPick(
	choices: readonly SignInChoice[],
): Promise<SignInChoice | undefined> {
	const chosen = await vscode.window.showQuickPick([...choices], {
		title: 'How should Entirely sign in?',
		placeHolder: 'Signing in to Entire',
	});

	return chosen;
}

/**
 * Signs a person in.
 *
 * The sign-in is finished outside the editor, so the panel is opened
 * before the command runs and the CLI's own words are shown in it as
 * they arrive. The code a person has to type is in the panel while the
 * command is still waiting.
 */
export async function signIn(deps: AuthenticationDependencies): Promise<void> {
	const cwd = deps.workspaceRoot();
	const env = deps.env ?? process.env;
	const platform = deps.platform ?? process.platform;
	const host = deps.host ?? {
		remoteName: vscode.env.remoteName,
		uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
	};
	const location = locateBrowser(env, platform, host);

	const flags = await deps.authentication.signInFlags(cwd);
	const deviceAvailable = flags.includes('--device');

	const choice = await chooseSignInMethod(location.kind !== 'local-display', deviceAvailable, deps.pickMethod);

	if (!choice) {
		return;
	}

	const note =
		location.kind !== 'local-display' && choice.method === 'device'
			? describeSignInLocation(location)
			: choice.method === 'device'
			? 'Enter the code below in a browser on another machine.'
			: 'The CLI is opening a browser. Finish the sign-in there.';

	AuthenticationPanel.start(note);
	deps.output.appendLine(`[entirely] signing in (${choice.method})`);

	// In a remote or browser-based window the CLI cannot open a browser
	// for the person, so the page the code goes to is opened for them.
	const openPage = choice.method === 'device' && location.kind !== 'local-display';
	const open = deps.openExternal ?? (address => vscode.env.openExternal(vscode.Uri.parse(address)));
	let seen = '';
	let opened = false;

	const outcome = await deps.authentication.signIn(
		{
			method: choice.method,
			onOutput: text => {
				AuthenticationPanel.append(text);

				if (!openPage || opened) {
					return;
				}

				seen += text;
				const address = findVerificationUrl(seen);

				if (address) {
					opened = true;
					void Promise.resolve(open(address)).catch(() => false);
				}
			},
		},
		cwd,
	);

	AuthenticationPanel.finish(outcome.ok, outcome.detail);

	if (!outcome.ok) {
		deps.output.appendLine(`[entirely] the sign-in failed: ${outcome.detail ?? 'no reason given'}`);
		void vscode.window.showErrorMessage(outcome.detail ?? 'The sign-in did not finish.');
		await refresh(deps);
		return;
	}

	deps.output.appendLine('[entirely] signed in');
	await refresh(deps);
	void vscode.window.showInformationMessage('Signed in to Entire.');
}

/**
 * Signs every saved login out.
 *
 * The CLI signs out of every login it has saved, and ends every session
 * on the login server, on other machines included. That is wider than a
 * person signing out of one account would expect, so it is said before
 * the command runs rather than after.
 */
export async function signOut(deps: AuthenticationDependencies): Promise<void> {
	const cwd = deps.workspaceRoot();
	const saved = deps.accounts.current.saved;

	const names = saved.length > 0 ? saved.map(context => context.name).join(', ') : 'none saved';

	const warning =
		`Signing out signs out every saved context on this machine (${names}), not just the one you are using. ` +
		'Every CLI session on the login server ends too, other machines included.';

	const confirmed = await (deps.confirmSignOut ?? confirmSignOutWithWarning)(warning);

	if (!confirmed) {
		return;
	}

	const outcome = await deps.authentication.signOut(cwd);

	if (!outcome.ok) {
		deps.output.appendLine(`[entirely] the sign-out failed: ${outcome.detail ?? 'no reason given'}`);
		void vscode.window.showErrorMessage(outcome.detail ?? 'The sign-out did not finish.');
		await refresh(deps);
		return;
	}

	deps.output.appendLine('[entirely] signed out');
	await refresh(deps);
	void vscode.window.showInformationMessage('Signed out of Entire.');
}

/** Asks the person to confirm the sign-out. */
async function confirmSignOutWithWarning(warning: string): Promise<boolean> {
	const confirmed = await vscode.window.showWarningMessage(
		warning,
		{ modal: true, detail: 'Signing in again will be needed to use Entire.' },
		'Sign Out',
	);

	return confirmed === 'Sign Out';
}

/** Re-reads who is signed in. */
async function refresh(deps: AuthenticationDependencies): Promise<void> {
	await deps.accounts.refresh(deps.workspaceRoot());
	await deps.authentication.refresh(deps.workspaceRoot());
}
