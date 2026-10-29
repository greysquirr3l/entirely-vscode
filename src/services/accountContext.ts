import {
	decodeAccountContexts,
	describeUnknownContext,
	selectAccountContext,
	type AccountContext,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { readExtensionSettings } from './configuration';

/** What the extension knows about the logins the CLI has saved. */
export interface AccountContextReading {
	/** The login the extension is acting as, when there is one. */
	readonly acting: AccountContext | undefined;
	/** Whether the user chose that login by name. */
	readonly pinned: boolean;
	/** Every login the CLI has saved. */
	readonly saved: readonly AccountContext[];
	/** Why the pinned login could not be used, when it could not be. */
	readonly problem: string | undefined;
}

/** A reading that says nothing, for before the CLI has been asked. */
const NOTHING: AccountContextReading = {
	acting: undefined,
	pinned: false,
	saved: [],
	problem: undefined,
};

/**
 * Reads the logins the CLI has saved and works out which one to act as.
 *
 * The CLI is asked without the pin in place, because the CLI marks the
 * login it is acting as. Asking with the pin would move the mark and
 * leave the extension unable to tell a pinned login apart from the CLI's
 * own — and unable to tell a name nobody has from a name the CLI would
 * have accepted, which is a mistake in the settings and not a command
 * that failed.
 */
export async function readAccountContext(
	runner: CliRunner,
	pinned: string | undefined,
	cwd: string | undefined,
): Promise<AccountContextReading> {
	const result = await runner.run(['auth', 'contexts'], { cwd, ignoreContext: true });

	if (!result.ok) {
		return {
			...NOTHING,
			problem: `The Entire CLI could not say which logins it has saved: ${result.detail}`,
		};
	}

	const saved = decodeAccountContexts(result.stdout);
	const selection = selectAccountContext(saved, pinned);

	switch (selection.kind) {
		case 'context':
			return {
				acting: selection.context,
				pinned: selection.pinned,
				saved: selection.saved,
				problem: undefined,
			};

		case 'unknown-context':
			return {
				...NOTHING,
				pinned: true,
				saved: selection.saved,
				problem: describeUnknownContext(selection.name, selection.saved),
			};

		case 'no-context':
			return { ...NOTHING, saved: selection.saved };
	}
}

/**
 * Keeps the extension's acting login up to date.
 *
 * The service owns the one thing every other part of the extension needs
 * to agree on: which login the CLI is being asked to act as. It reads
 * the saved logins, applies the user's pin to the runner, and keeps the
 * reading so that the status bar, the doctor report and the hook bridge
 * all describe the same login.
 */
export class AccountContextService {
	private reading: AccountContextReading = NOTHING;

	constructor(private readonly runner: CliRunner) {}

	/** What is known about the logins. */
	get current(): AccountContextReading {
		return this.reading;
	}

	/**
	 * The saved login every command acts as.
	 *
	 * This is the name the CLI saved the login under, which is what the
	 * CLI's own flag and environment variable take.
	 */
	get context(): string | undefined {
		return this.reading.acting?.name;
	}

	/**
	 * Reads the saved logins and applies the user's pin.
	 *
	 * A pin that names a login the CLI does not have is not applied: the
	 * extension keeps using the CLI's own login rather than failing every
	 * command it runs, and the problem is reported instead.
	 */
	async refresh(cwd: string | undefined): Promise<AccountContextReading> {
		const reading = await readAccountContext(
			this.runner,
			readExtensionSettings().cliContext,
			cwd,
		);

		this.reading = reading;

		this.runner.setContext(reading.pinned && reading.acting ? reading.acting.name : undefined);

		return reading;
	}
}
