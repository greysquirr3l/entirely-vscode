import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	decodeAuthStatus,
	describeIdentity,
	describeJurisdiction,
	isHeadlessEnvironment,
	isSignedIn,
} from '../lib/entire';
import { AccountContextService } from '../services/accountContext';
import { AuthenticationService } from '../services/authentication';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { buildAuthenticationFacts } from '../providers/authenticationProvider';
import { chooseSignInMethod, signIn, signOut } from '../commands/authentication';

const temporaryDirectories: string[] = [];

suiteTeardown(() => {
	for (const directory of temporaryDirectories) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

/** Creates a temporary directory. */
function makeDirectory(prefix: string): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

/** The payload `entire auth status --json` prints. */
const AUTH_STATUS = JSON.stringify({
	logged_in: true,
	server: 'us.auth.entire.io',
	context: 'us.auth.entire.io',
	user: 'github:greysquirr3l',
	display_name: 'Nick Campbell',
	jurisdiction: 'us',
	token_source: 'macOS Keychain',
	current_session_id: '01M5X7ZPMJKK7PKPVFDHYB14C7',
	expires_at: '2026-11-28T03:10:40Z',
	active_sessions: 4,
	available_contexts: 2,
});

/** The table the CLI prints for its saved logins. */
const CONTEXTS_TABLE = [
	'CONTEXT                           HANDLE          LOGIN SERVER',
	'us.auth.entire.io                 greysquirr3l    https://us.auth.entire.io',
	'sosh-ncampbell@us.auth.entire.io  sosh-ncampbell  https://us.auth.entire.io  (active)',
].join('\n');

/** The help the CLI prints for its sign-in command. */
const LOGIN_HELP = [
	'entire login — Log in to Entire',
	'',
	'Flags:',
	'      --device          Use the device-code flow (enter a code in your browser)',
	'      --server string   login server to authenticate against (default "https://auth.entire.io")',
].join('\n');

/** How the fake CLI should answer. */
interface FakeCli {
	/** The payload `auth status --json` prints. */
	readonly status?: string;
	/** What the sign-in prints, and whether it succeeds. */
	readonly login?: { readonly output: string; readonly exitCode?: number };
	/** The help the sign-in command prints. */
	readonly help?: string;
}

/** A fake CLI that records every invocation it is given. */
function writeFakeCli(directory: string, log: string, options: FakeCli = {}): string {
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, 'entire');

	const status = options.status ?? AUTH_STATUS;
	const help = options.help ?? LOGIN_HELP;
	const loginOutput = options.login?.output ?? 'signed in';
	const loginExit = options.login?.exitCode ?? 0;

	// The arguments are matched wherever they appear, because the
	// extension may put a login in front of the command.
	const body = [
		`echo "$@" >> '${log}'`,
		'for argument in "$@"; do',
		'\tcase "$argument" in',
		'\t\tversion) echo "entire 0.12.2"; exit 0 ;;',
		`\t\tagent-help) printf '%s\\n' '${help.replace(/'/g, "'\\''")}'; exit 0 ;;`,
		`\t\tstatus) printf '%s\\n' '${status.replace(/'/g, "'\\''")}'; exit 0 ;;`,
		`\t\tcontexts) printf '%s\\n' '${CONTEXTS_TABLE.replace(/'/g, "'\\''")}'; exit 0 ;;`,
		`\t\tlogin) printf '%s\\n' '${loginOutput.replace(/'/g, "'\\''")}'; exit ${loginExit} ;;`,
		'\t\tlogout) echo "signed out"; exit 0 ;;',
		'\tesac',
		'done',
	].join('\n');

	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
	fs.chmodSync(file, 0o755);

	return file;
}

/** A runner that talks to a fake CLI, and the file it records into. */
function runnerFor(options: FakeCli = {}): {
	readonly runner: CliRunner;
	readonly log: string;
	readonly invocations: () => string[];
} {
	const home = makeDirectory('entire-auth-home-');
	const log = path.join(home, 'invocations.log');
	writeFakeCli(path.join(home, '.local', 'bin'), log, options);

	const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));

	return {
		runner,
		log,
		invocations: () =>
			fs.existsSync(log)
				? fs
						.readFileSync(log, 'utf8')
						.split('\n')
						.filter(line => line.length > 0)
				: [],
	};
}

suite('Entire authentication status', () => {
	test('reads the identity and the jurisdiction the CLI reports', () => {
		const decoded = decodeAuthStatus(JSON.parse(AUTH_STATUS));

		assert.ok(decoded.ok, 'the payload was not read');
		if (!decoded.ok) {
			return;
		}

		assert.strictEqual(decoded.value.loggedIn, true);
		assert.strictEqual(decoded.value.user, 'github:greysquirr3l');
		assert.strictEqual(decoded.value.displayName, 'Nick Campbell');
		assert.strictEqual(decoded.value.jurisdiction, 'us');
		assert.strictEqual(decoded.value.server, 'us.auth.entire.io');
		assert.strictEqual(decoded.value.activeSessions, 4);
		assert.strictEqual(decoded.value.availableContexts, 2);
	});

	test('reads a payload that says nobody is signed in', () => {
		const decoded = decodeAuthStatus({ logged_in: false });

		assert.ok(decoded.ok, 'the payload was not read');
		if (!decoded.ok) {
			return;
		}

		assert.strictEqual(decoded.value.loggedIn, false);
		assert.strictEqual(isSignedIn(decoded.value), false);
	});

	test('refuses a payload that is not an object', () => {
		const decoded = decodeAuthStatus('not a payload');

		assert.strictEqual(decoded.ok, false);
	});

	test('names the person and the jurisdiction', () => {
		const decoded = decodeAuthStatus(JSON.parse(AUTH_STATUS));

		assert.ok(decoded.ok, 'the payload was not read');
		if (!decoded.ok) {
			return;
		}

		assert.strictEqual(describeIdentity(decoded.value), 'Nick Campbell (github:greysquirr3l)');
		assert.strictEqual(describeJurisdiction(decoded.value.jurisdiction), 'us');
		assert.strictEqual(describeJurisdiction(undefined), 'unknown');
	});

	test('is read from the CLI rather than worked out', async () => {
		const { runner } = runnerFor();
		const service = new AuthenticationService(runner);

		const status = await service.refresh(undefined);

		assert.ok(status, 'nothing was read');
		assert.strictEqual(status?.user, 'github:greysquirr3l');
		assert.strictEqual(status?.jurisdiction, 'us');
	});

	test('is read as the login the extension is acting as', async () => {
		const { runner, invocations } = runnerFor();
		runner.setContext('us.auth.entire.io');
		const service = new AuthenticationService(runner);

		await service.refresh(undefined);

		const asked = invocations().find(line => line.includes('auth status'));

		assert.ok(asked, 'the CLI was never asked');
		assert.ok(
			asked?.includes('--context us.auth.entire.io'),
			`the identity was read as somebody else: ${asked}`,
		);
	});
});

suite('The headless machine', () => {
	test('is a machine with no display to open a browser on', () => {
		assert.strictEqual(isHeadlessEnvironment({}, 'linux'), true);
		assert.strictEqual(isHeadlessEnvironment({ DISPLAY: ':0' }, 'linux'), false);
		assert.strictEqual(isHeadlessEnvironment({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
	});

	test('is not a desktop that always has one', () => {
		assert.strictEqual(isHeadlessEnvironment({}, 'darwin'), false);
		assert.strictEqual(isHeadlessEnvironment({}, 'win32'), false);
	});
});

suite('The account view', () => {
	test('shows the identity and the home jurisdiction', () => {
		const decoded = decodeAuthStatus(JSON.parse(AUTH_STATUS));

		assert.ok(decoded.ok, 'the payload was not read');
		if (!decoded.ok) {
			return;
		}

		const facts = buildAuthenticationFacts(decoded.value);
		const identity = facts.find(fact => fact.label === 'Signed in as');
		const jurisdiction = facts.find(fact => fact.label === 'Home jurisdiction');

		assert.ok(identity, 'the identity is not shown');
		assert.strictEqual(identity?.value, 'Nick Campbell (github:greysquirr3l)');
		assert.ok(jurisdiction, 'the jurisdiction is not shown');
		assert.strictEqual(jurisdiction?.value, 'us');
	});

	test('is empty when nobody is signed in, so the editor can offer the sign-in', () => {
		const decoded = decodeAuthStatus({ logged_in: false });

		assert.ok(decoded.ok, 'the payload was not read');
		if (!decoded.ok) {
			return;
		}

		assert.deepStrictEqual(buildAuthenticationFacts(decoded.value), []);
	});

	test('says it does not know when the CLI could not be asked', () => {
		const facts = buildAuthenticationFacts(undefined);

		assert.strictEqual(facts.length, 1);
		assert.ok(facts[0]?.value.includes('unknown'), 'the view claims more than it knows');
	});
});

suite('Signing in', () => {
	test('offers the device flow on a machine with no display', async () => {
		const chosen = await chooseSignInMethod(true, true, async () => {
			throw new Error('the person was asked, on a machine with no display');
		});

		assert.strictEqual(chosen?.method, 'device');
	});

	test('offers the device flow on a machine with a display', async () => {
		const offered: string[] = [];

		const chosen = await chooseSignInMethod(false, true, async choices => {
			offered.push(...choices.map(choice => choice.method));
			return choices[1];
		});

		assert.deepStrictEqual(offered, ['browser', 'device']);
		assert.strictEqual(chosen?.method, 'device');
	});

	test('uses the device flow when the machine has no display', async () => {
		const { runner, invocations } = runnerFor();
		const service = new AuthenticationService(runner);

		await service.signIn({ method: 'device' }, undefined);

		const login = invocations().find(
			line => line.includes('login') && !line.includes('agent-help'),
		);

		assert.ok(login, 'the sign-in never ran');
		assert.ok(login?.includes('--device'), `the device flow was not used: ${login}`);
	});

	test('passes the device flow only when the CLI has it', async () => {
		const { runner, invocations } = runnerFor({ help: 'entire login — Log in to Entire' });
		const service = new AuthenticationService(runner);

		await service.signIn({ method: 'device' }, undefined);

		const login = invocations().find(
			line => line.includes('login') && !line.includes('agent-help'),
		);

		assert.ok(login, 'the sign-in never ran');
		assert.strictEqual(login?.includes('--device'), false);
	});

	test('reports a failure rather than a sign-in that did not happen', async () => {
		const { runner } = runnerFor({
			login: { output: 'the browser said no', exitCode: 1 },
		});
		const service = new AuthenticationService(runner);

		const outcome = await service.signIn({ method: 'browser' }, undefined);

		assert.strictEqual(outcome.ok, false);
		assert.ok(outcome.detail, 'the failure was not described');
	});

	test('shows what the CLI writes while it is waiting', async () => {
		const { runner } = runnerFor({
			login: { output: 'enter the code ABCD-EFGH at https://auth.entire.io/device' },
		});
		const service = new AuthenticationService(runner);

		const written: string[] = [];

		await service.signIn(
			{ method: 'device', onOutput: text => written.push(text) },
			undefined,
		);

		assert.ok(written.length > 0, 'nothing was written');
		assert.ok(
			written.join('').includes('ABCD-EFGH'),
			'the code was not shown while the command was waiting',
		);
	});
});

suite('Signing out', () => {
	test('warns that every saved context is signed out before it runs', async () => {
		const { runner, invocations } = runnerFor();
		const accounts = new AccountContextService(runner);
		await accounts.refresh(undefined);

		const warnings: string[] = [];

		await signOut({
			authentication: new AuthenticationService(runner),
			accounts,
			workspaceRoot: () => undefined,
			output: { appendLine: () => undefined },
			confirmSignOut: async warning => {
				warnings.push(warning);
				return true;
			},
		});

		assert.strictEqual(warnings.length, 1, 'no warning was given');
		assert.ok(
			warnings[0]?.includes('every saved context'),
			`the warning does not say what is signed out: ${warnings[0]}`,
		);
		assert.strictEqual(
			invocations().some(line => line.includes('logout')),
			true,
			'the sign-out never ran',
		);
	});

	test('does not sign out when the warning is not accepted', async () => {
		const { runner, invocations } = runnerFor();
		const accounts = new AccountContextService(runner);
		await accounts.refresh(undefined);

		await signOut({
			authentication: new AuthenticationService(runner),
			accounts,
			workspaceRoot: () => undefined,
			output: { appendLine: () => undefined },
			confirmSignOut: async () => false,
		});

		assert.strictEqual(
			invocations().some(line => line.includes('logout')),
			false,
			'the sign-out ran even though it was not confirmed',
		);
	});
});

suite('The sign-in command', () => {
	test('uses the device flow on a machine with no display', async () => {
		const { runner, invocations } = runnerFor();
		const accounts = new AccountContextService(runner);
		await accounts.refresh(undefined);

		await signIn({
			authentication: new AuthenticationService(runner),
			accounts,
			workspaceRoot: () => undefined,
			output: { appendLine: () => undefined },
			env: {},
			platform: 'linux',
			pickMethod: async () => {
				throw new Error('the person was asked, on a machine with no display');
			},
		});

		const login = invocations().find(
			line => line.includes('login') && !line.includes('agent-help'),
		);

		assert.ok(login, 'the sign-in never ran');
		assert.ok(login?.includes('--device'), `the device flow was not used: ${login}`);
	});
});

suite('The credential store', () => {
	/** The source files of the extension, without the tests. */
	function productionSources(): string[] {
		const sourceDirectory = path.resolve(__dirname, '..', '..', 'src');

		const walk = (directory: string): string[] =>
			fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
				const file = path.join(directory, entry.name);
				return entry.isDirectory() ? walk(file) : [file];
			});

		return walk(sourceDirectory).filter(
			file => !path.relative(sourceDirectory, file).startsWith(`test${path.sep}`),
		);
	}

	test('is never read by the extension', () => {
		const files = productionSources();

		assert.ok(files.length > 0, 'no source files were found');

		for (const file of files) {
			const source = fs.readFileSync(file, 'utf8');
			const name = path.relative(path.resolve(__dirname, '..', '..', 'src'), file);

			assert.doesNotMatch(
				source,
				/tokens\.json|ENTIRE_TOKEN_STORE|token_store/,
				`${name} reads the credential store`,
			);
		}
	});

	test('is never asked of the CLI', async () => {
		const { runner, invocations } = runnerFor();
		const service = new AuthenticationService(runner);

		await service.refresh(undefined);
		await service.signIn({ method: 'browser' }, undefined);
		await service.signOut(undefined);

		for (const invocation of invocations()) {
			assert.strictEqual(
				invocation.toLowerCase().includes('token'),
				false,
				`the CLI was asked for a credential: ${invocation}`,
			);
		}
	});
});
