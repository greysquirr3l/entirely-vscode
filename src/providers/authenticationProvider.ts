import * as vscode from 'vscode';

import {
	describeIdentity,
	describeJurisdiction,
	isSignedIn,
	pluralise,
	type AuthStatus,
} from '../lib/entire';
import { Tooltip } from './markdown';

/** One fact about the signed-in identity. */
export interface AuthenticationFact {
	/** The name of the fact. */
	readonly label: string;
	/** What the fact is. */
	readonly value: string;
}

/**
 * The facts the view shows about the signed-in identity.
 *
 * The order is the order a person would ask for them in: who you are,
 * where your account lives, and then the details of the session.
 *
 * A signed-out CLI has nothing to say, and the view says so by being
 * empty, which is what lets the editor offer the sign-in in its place.
 * A CLI that could not be asked is a different thing: the view says that
 * it does not know, rather than saying that nobody is signed in.
 */
export function buildAuthenticationFacts(status: AuthStatus | undefined): AuthenticationFact[] {
	if (!status) {
		return [{ label: 'Signed in', value: 'unknown — the Entire CLI did not answer' }];
	}

	if (!status.loggedIn) {
		return [];
	}

	const facts: AuthenticationFact[] = [
		{ label: 'Signed in as', value: describeIdentity(status) },
		{ label: 'Home jurisdiction', value: describeJurisdiction(status.jurisdiction) },
	];

	if (status.server) {
		facts.push({ label: 'Login server', value: status.server });
	}

	if (status.context) {
		facts.push({ label: 'Login', value: status.context });
	}

	if (status.activeSessions !== undefined) {
		facts.push({
			label: 'Active sessions',
			value: pluralise(status.activeSessions, 'session'),
		});
	}

	if (status.availableContexts !== undefined) {
		facts.push({
			label: 'Saved logins',
			value: pluralise(status.availableContexts, 'login'),
		});
	}

	if (status.credentialStore) {
		facts.push({ label: 'Credentials are kept in', value: status.credentialStore });
	}

	return facts;
}

/**
 * The Account view.
 *
 * It says who the CLI is signed in as, and which jurisdiction the
 * account belongs to. Nothing here is a credential: the view shows
 * where the credentials are kept, and the extension never reads them.
 */
export class AuthenticationProvider implements vscode.TreeDataProvider<AuthenticationFact> {
	private readonly changed = new vscode.EventEmitter<AuthenticationFact | undefined>();
	private facts: AuthenticationFact[] = [];
	private timer: NodeJS.Timeout | undefined;

	readonly onDidChangeTreeData: vscode.Event<AuthenticationFact | undefined> = this.changed.event;

	constructor(
		private readonly source: () => Promise<AuthStatus | undefined>,
		private readonly refreshIntervalSeconds: () => number = () => 30,
	) {
		this.schedulePolling();
	}

	/** Re-reads the status and re-renders the view. */
	async refresh(): Promise<void> {
		const status = await this.source();
		this.facts = buildAuthenticationFacts(status);

		// The view's buttons depend on whether there is a sign-in to do,
		// and the editor decides what a menu shows from a context key.
		void vscode.commands.executeCommand('setContext', 'entirely.signedIn', isSignedIn(status));

		this.changed.fire(undefined);
	}

	/**
	 * Restarts the polling timer.
	 *
	 * The interval is a setting, and a setting the user changes takes
	 * effect at once rather than at the next tick.
	 */
	reschedule(): void {
		this.schedulePolling();
	}

	/** Starts, stops or restarts the polling timer. */
	private schedulePolling(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		const seconds = this.refreshIntervalSeconds();
		if (seconds > 0) {
			this.timer = setInterval(() => {
				void this.refresh();
			}, seconds * 1000);
		}
	}

	/** Asks the view to re-read its children. */
	invalidate(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(element: AuthenticationFact): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);

		item.description = element.value;
		item.tooltip = new Tooltip().item(element.label, element.value).build();
		item.contextValue = 'entirely.authenticationFact';

		return item;
	}

	getChildren(element?: AuthenticationFact): AuthenticationFact[] {
		return element ? [] : this.facts;
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.changed.dispose();
	}
}
