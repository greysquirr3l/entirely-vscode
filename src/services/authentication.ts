import {
	decodeAuthStatus,
	unwrap,
	type AuthStatus,
} from '../lib/entire';
import type { CliRunner, CliResult } from './cli';

/** How a sign-in is to be carried out. */
export type SignInMethod =
	/** The CLI opens a browser and the person signs in there. */
	| 'browser'
	/** The CLI prints a code and the person enters it in a browser. */
	| 'device';

/** What a sign-in needs to know before it starts. */
export interface SignInRequest {
	/** Which flow to use. */
	readonly method: SignInMethod;
	/** A login server to authenticate against, when the person named one. */
	readonly server?: string;
	/** Called with what the CLI writes, as it writes it. */
	readonly onOutput?: (text: string) => void;
}

/** The outcome of a sign-in or a sign-out. */
export interface AuthOutcome {
	/** Whether the command did what it was asked to do. */
	readonly ok: boolean;
	/** A sentence saying what went wrong, when something did. */
	readonly detail?: string;
	/** Everything the CLI wrote, which is what the person may need. */
	readonly output?: string;
}

/**
 * How long a sign-in may wait for a person.
 *
 * The sign-in is finished by a person in a browser, and a person takes
 * as long as they take. Ten minutes is long enough for a person to find
 * the browser and long enough that a command that will never finish is
 * eventually given up on.
 */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

/** The flags the CLI's own help says the sign-in command takes. */
const DEVICE_FLAG = '--device';
const SERVER_FLAG = '--server';

/**
 * Keeps the extension's reading of the signed-in identity up to date.
 *
 * The CLI is asked for the status rather than the extension working it
 * out, because the CLI is the only thing that knows which identity it
 * is acting as, which jurisdiction it belongs to and where its
 * credentials are kept.
 */
export class AuthenticationService {
	private reading: AuthStatus | undefined;

	constructor(private readonly runner: CliRunner) {}

	/** What is known about the signed-in identity. */
	get current(): AuthStatus | undefined {
		return this.reading;
	}

	/**
	 * Asks the CLI who it is signed in as.
	 *
	 * The question is asked as the login the extension is acting as, so
	 * that the answer is the identity the other commands run under. A
	 * login the CLI was told to act as is reported as that login's own
	 * identity, and a login it does not have is refused rather than
	 * answered for another one.
	 */
	async refresh(cwd: string | undefined): Promise<AuthStatus | undefined> {
		const result = await this.runner.runJson(
			['auth', 'status', '--json'],
			value => unwrap(decodeAuthStatus(value)),
			{ cwd },
		);

		if (!result.ok) {
			this.reading = undefined;
			return undefined;
		}

		this.reading = result.value;

		return this.reading;
	}

	/**
	 * The flags the CLI's sign-in command accepts.
	 *
	 * The CLI owns the list of flags, so the extension reads it from the
	 * CLI's own help rather than keeping a copy that can drift. A flag the
	 * CLI does not have is a flag the extension does not pass.
	 */
	async signInFlags(cwd: string | undefined): Promise<readonly string[]> {
		const result = await this.runner.usage('login', { cwd, ignoreContext: true });

		if (!result.ok) {
			return [];
		}

		return result.value.flags.map(flag => flag.name);
	}

	/**
	 * Signs a person in.
	 *
	 * The command waits for a person, so it runs for far longer than the
	 * other commands the extension runs, and what it writes is handed to
	 * the caller as it is written: the code the person has to enter is
	 * printed long before the command finishes.
	 *
	 * The pinned login is left off the command. The sign-in creates or
	 * updates a login, and a login that does not exist yet cannot be the
	 * one the command acts as.
	 */
	async signIn(request: SignInRequest, cwd: string | undefined): Promise<AuthOutcome> {
		const flags = await this.signInFlags(cwd);
		const args = ['login'];

		if (request.method === 'device' && flags.includes(DEVICE_FLAG)) {
			args.push(DEVICE_FLAG);
		}

		if (request.server && flags.includes(SERVER_FLAG)) {
			args.push(SERVER_FLAG, request.server);
		}

		const result = await this.runner.run(args, {
			cwd,
			ignoreContext: true,
			timeoutMs: SIGN_IN_TIMEOUT_MS,
			onStdout: request.onOutput,
			onStderr: request.onOutput,
		});

		return describeOutcome(result, 'sign in');
	}

	/**
	 * Signs every saved login out.
	 *
	 * The pinned login is left off the command, and not only because it
	 * would narrow what is signed out: the CLI refuses an explicit login
	 * rather than honouring it, because nothing narrows this.
	 */
	async signOut(cwd: string | undefined): Promise<AuthOutcome> {
		const result = await this.runner.run(['logout'], {
			cwd,
			ignoreContext: true,
			timeoutMs: SIGN_IN_TIMEOUT_MS,
		});

		return describeOutcome(result, 'sign out');
	}
}

/**
 * Turns the result of a command into an outcome a person can read.
 *
 * A failure is a failure. It is never reported as a command that did
 * nothing, because a sign-in that did not happen and a sign-in that
 * worked are not the same thing to the person who asked.
 */
function describeOutcome(result: CliResult, what: string): AuthOutcome {
	const output = [result.stdout, result.stderr].filter(text => text.length > 0).join('\n').trim();

	if (result.ok) {
		return { ok: true, output: output.length > 0 ? output : undefined };
	}

	return {
		ok: false,
		detail: `The Entire CLI could not ${what}: ${result.detail}`,
		output: output.length > 0 ? output : undefined,
	};
}
