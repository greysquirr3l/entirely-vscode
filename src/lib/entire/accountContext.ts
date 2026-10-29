/**
 * The logins the Entire CLI has saved.
 *
 * A context is a saved login: an account on a forge, the server that
 * holds its credentials, and the name the CLI saves it under. The name
 * is not the account — the CLI names a context after the host of its
 * login server, and a second identity on a host that already has a
 * context is saved as `HANDLE@HOST` — so the handle is kept beside the
 * name, because the handle is what a person recognises.
 */

/** A login the CLI has saved. */
export interface AccountContext {
	/** The name the CLI saves the login under. */
	readonly name: string;
	/** The handle of the account on the forge. */
	readonly handle: string;
	/** The login server that holds the credentials. */
	readonly server: string;
	/** Whether the CLI acts as this login unless it is told otherwise. */
	readonly active: boolean;
}

/** The marker the CLI puts on the login it is acting as. */
const ACTIVE_MARKER = '(active)';

/** The first column of the table, which is a heading and not a login. */
const HEADING = 'CONTEXT';

/**
 * Whether a column holds a login server.
 *
 * A server is a URL. Anything else in that column is not a login, and
 * reading it as one would put a sentence from the CLI into the list of
 * accounts.
 */
function isServer(value: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value);
}

/**
 * Splits a row of the table into its columns.
 *
 * The columns are separated by runs of whitespace, and the width of the
 * run depends on the longest value in each column, so a single space is
 * not enough to split on. A row that does not come out with three
 * columns is split on single spaces instead, for a CLI that prints its
 * table that way.
 */
function splitRow(line: string): string[] {
	const wide = line
		.split(/[ \t]{2,}/)
		.map(part => part.trim())
		.filter(part => part.length > 0);

	if (wide.length >= 3) {
		return wide;
	}

	return line.split(/\s+/).filter(part => part.length > 0);
}

/**
 * Reads the table `entire auth contexts` prints.
 *
 * The CLI prints its saved logins as text rather than as JSON, so the
 * table is read here. A line that is not a login is skipped rather than
 * guessed at, so that a CLI which prints something else cannot turn a
 * sentence into an account with a made-up handle.
 */
export function decodeAccountContexts(text: string): readonly AccountContext[] {
	const contexts: AccountContext[] = [];

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0) {
			continue;
		}

		const columns = splitRow(line);
		if (columns.length === 0 || columns[0].toUpperCase() === HEADING) {
			continue;
		}

		let active = false;
		const last = columns[columns.length - 1];
		if (last === ACTIVE_MARKER) {
			active = true;
			columns.pop();
		} else if (last.endsWith(` ${ACTIVE_MARKER}`)) {
			active = true;
			columns[columns.length - 1] = last.slice(0, last.length - ACTIVE_MARKER.length - 1);
		}

		if (columns.length < 3) {
			continue;
		}

		const name = columns[0];
		const handle = columns[1];
		const server = columns[2];

		if (name.length === 0 || handle.length === 0 || !isServer(server)) {
			continue;
		}

		contexts.push({ name, handle, server, active });
	}

	return contexts;
}

/** Which login the extension acts as. */
export type AccountContextSelection =
	| {
			/** A login was chosen. */
			readonly kind: 'context';
			/** The login the extension acts as. */
			readonly context: AccountContext;
			/** Whether the user chose that login by name. */
			readonly pinned: boolean;
			/** Every login the CLI has saved. */
			readonly saved: readonly AccountContext[];
	  }
	| {
			/** The user named a login the CLI does not have. */
			readonly kind: 'unknown-context';
			/** The name the user asked for. */
			readonly name: string;
			/** Every login the CLI has saved. */
			readonly saved: readonly AccountContext[];
	  }
	| {
			/** The CLI has no saved logins at all. */
			readonly kind: 'no-context';
			/** Every login the CLI has saved. */
			readonly saved: readonly AccountContext[];
	  };

/**
 * Works out which login the extension should act as.
 *
 * A name the user gave is looked up among the saved logins, so that a
 * name nobody has is reported as a mistake in the settings rather than
 * as a command that failed. Without a name, the login the CLI marks as
 * active is the one to use: that is the login the CLI would use on its
 * own, and the extension follows it unless it is told otherwise.
 */
export function selectAccountContext(
	saved: readonly AccountContext[],
	pinned: string | undefined,
): AccountContextSelection {
	const wanted = pinned?.trim() ?? '';

	if (wanted.length > 0) {
		const found = saved.find(context => context.name === wanted);
		if (!found) {
			return { kind: 'unknown-context', name: wanted, saved };
		}

		return { kind: 'context', context: found, pinned: true, saved };
	}

	const active = saved.find(context => context.active);
	if (active) {
		return { kind: 'context', context: active, pinned: false, saved };
	}

	if (saved.length > 0) {
		// The CLI marks the login it is acting as, so a table with no
		// marked login is not the table this reads. The first login is
		// used rather than none, because having the wrong login is
		// better than not knowing which one is in use.
		return { kind: 'context', context: saved[0], pinned: false, saved };
	}

	return { kind: 'no-context', saved };
}

/**
 * How a login is named to a person.
 *
 * The handle comes first, because that is how the account is known, and
 * the server says where the credentials live.
 */
export function describeAccountContext(context: AccountContext): string {
	return `${context.handle} (${context.server})`;
}

/**
 * What is wrong with a login the user named but the CLI does not have.
 *
 * The message names the logins that do exist, because the name to use
 * is one of them and the user cannot know it otherwise.
 */
export function describeUnknownContext(
	name: string,
	saved: readonly AccountContext[],
): string {
	const known = saved.length > 0 ? saved.map(context => context.name).join(', ') : '(none)';

	return `The Entire CLI has no saved login called "${name}". Saved logins: ${known}.`;
}

/** The CLI's wording for a login it does not have. */
const NOT_SAVED = 'is not saved';

/**
 * Whether a failure was the CLI refusing a login it does not have.
 *
 * The CLI rejects an unknown login before it runs anything, so this is
 * the one place that decides whether a failure was a mistake in the
 * extension's settings or a command that simply did not work.
 */
export function isUnknownContextError(stderr: string): boolean {
	return stderr.includes(NOT_SAVED);
}

/** The CLI's wording for a repository the login cannot see. */
const NOT_VISIBLE = 'visible from your login';

/**
 * Whether a failure was the CLI saying the login cannot see a
 * repository.
 *
 * This is what tells a workspace that is invisible to the acting login
 * apart from one that is not tracked at all.
 */
export function isInvisibleToLogin(stderr: string): boolean {
	return stderr.includes(NOT_VISIBLE);
}
