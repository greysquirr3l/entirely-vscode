import {
	decodeRecord,
	optionalBoolean,
	optionalNumber,
	optionalString,
	type DecodeResult,
} from './decode';

/**
 * Who the Entire CLI is signed in as.
 *
 * This is what `entire auth status --json` reports. It names the
 * identity, the login server that holds the credentials and the
 * jurisdiction the account belongs to — and it says where the
 * credentials are kept, which is a description of a place and never the
 * thing itself.
 */
export interface AuthStatus {
	/** Whether the CLI is signed in at all. */
	readonly loggedIn: boolean;
	/** The login server that holds the credentials. */
	readonly server?: string;
	/** The name the active login is saved under. */
	readonly context?: string;
	/** The account on the forge, such as `github:greysquirr3l`. */
	readonly user?: string;
	/** The name a person would recognise. */
	readonly displayName?: string;
	/** The jurisdiction the account's home server is in. */
	readonly jurisdiction?: string;
	/**
	 * Where the credentials are kept, as the CLI describes it.
	 *
	 * This is a description of a place — `macOS Keychain`, `Linux Secret
	 * Service` — and not the credential. The extension never reads the
	 * store itself, whatever the store is.
	 */
	readonly credentialStore?: string;
	/** When the current session ends. */
	readonly expiresAt?: string;
	/** How many sessions are live on the login server. */
	readonly activeSessions?: number;
	/** How many logins are saved on this machine. */
	readonly availableContexts?: number;
}

/**
 * Reads the payload `entire auth status --json` prints.
 *
 * Only `logged_in` has to be there: the rest of the fields describe a
 * signed-in account, and a signed-out CLI has none of them. A field
 * that is present but of the wrong kind is an error, because that means
 * the shape of the payload changed rather than that there is nothing to
 * say.
 */
export function decodeAuthStatus(value: unknown): DecodeResult<AuthStatus> {
	const record = decodeRecord(value, '');
	if (!record.ok) {
		return record;
	}

	const fields = { record: record.value, path: '' };

	const loggedIn = optionalBoolean(fields, 'logged_in') ?? false;

	const server = optionalString(fields, 'server');
	if (!server.ok) {
		return server;
	}

	const context = optionalString(fields, 'context');
	if (!context.ok) {
		return context;
	}

	const user = optionalString(fields, 'user');
	if (!user.ok) {
		return user;
	}

	const displayName = optionalString(fields, 'display_name');
	if (!displayName.ok) {
		return displayName;
	}

	const jurisdiction = optionalString(fields, 'jurisdiction');
	if (!jurisdiction.ok) {
		return jurisdiction;
	}

	const credentialStore = optionalString(fields, 'token_source');
	if (!credentialStore.ok) {
		return credentialStore;
	}

	const expiresAt = optionalString(fields, 'expires_at');
	if (!expiresAt.ok) {
		return expiresAt;
	}

	const activeSessions = optionalNumber(fields, 'active_sessions');
	if (!activeSessions.ok) {
		return activeSessions;
	}

	const availableContexts = optionalNumber(fields, 'available_contexts');
	if (!availableContexts.ok) {
		return availableContexts;
	}

	return {
		ok: true,
		value: {
			loggedIn,
			server: server.value,
			context: context.value,
			user: user.value,
			displayName: displayName.value,
			jurisdiction: jurisdiction.value,
			credentialStore: credentialStore.value,
			expiresAt: expiresAt.value,
			activeSessions: activeSessions.value,
			availableContexts: availableContexts.value,
		},
	};
}

/**
 * How a signed-in account is named to a person.
 *
 * The name comes first when there is one, because that is what a person
 * recognises, and the account on the forge follows it.
 */
export function describeIdentity(status: AuthStatus): string {
	const name = status.displayName ?? status.user;

	if (!name) {
		return status.loggedIn ? 'a signed-in account' : 'not signed in';
	}

	return status.user && status.user !== name ? `${name} (${status.user})` : name;
}

/**
 * The jurisdiction, as the CLI reports it.
 *
 * The CLI reports a code. The extension shows the code rather than
 * guessing which country it stands for, because a guess that is wrong
 * is worse than a code that is not.
 */
export function describeJurisdiction(jurisdiction: string | undefined): string {
	return jurisdiction && jurisdiction.length > 0 ? jurisdiction : 'unknown';
}

/**
 * Whether the status says the CLI is signed in.
 *
 * The payload is the only thing that says so. The extension does not
 * decide that a login is in place because a command worked.
 */
export function isSignedIn(status: AuthStatus | undefined): boolean {
	return status?.loggedIn === true;
}