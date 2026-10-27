import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import { parseJson } from '../services/cli/json';
import { parseUsage } from '../services/cli/usage';
import { documentedLocations, pathEntries } from '../services/cli/locations';
import { decodeWorkspaceStatus, unwrap } from '../lib/entire';
import { findCandidate, parseVersion } from '../services/cli/discovery';

/** The `status --json` shape of a tracked repository, as the CLI prints it. */
const TRACKED_STATUS =
	'{"enabled":true,"agents":["Copilot CLI"],"active_sessions":[{"agent":"Copilot CLI","session_id":"abc-123","worktree_path":"/work/sandbox","branch":"master","status":"active"}],"agent_help":"entire agent-help"}';

/** The `session --json` shape of a repository Entire does not track. */
const UNTRACKED_STATUS =
	'{"enabled":false,"agents":null,"active_sessions":null,"error":"not a git repository"}';

/** The `session list --json` shape, as the CLI prints it. */
const SESSION_LIST =
	'[{"session_id":"abc-123","agent":"Copilot CLI","status":"active","branch":"master","worktree_path":"/work/sandbox","started_at":"2026-10-26T23:34:45.832442304Z","last_active":"2026-10-26T23:34:50.249468583Z","turns":0,"pending_turns":0,"checkpoints":0,"last_prompt":"add a test"}]';

/**
 * A fake CLI that answers the commands the extension uses, with the shapes
 * the real CLI prints.
 */
const WORKING_CLI = [
	'case "$1" in',
	'\tversion) echo "entire 0.12.2" ;;',
	`\tstatus) echo '${TRACKED_STATUS}' ;;`,
	`\tsession) echo '${SESSION_LIST}' ;;`,
	`\tagent-help) printf 'Usage: entire status [flags]\\n\\nFlags:\\n  --detailed    Show the per-settings-file breakdown\\n  --json        Emit JSON\\n' ;;`,
	'\t*) echo "unknown command" >&2; exit 2 ;;',
	'esac',
].join('\n');

/** A CLI that cannot report its version. */
const BROKEN_CLI = ['echo "entire: unexpected failure" >&2', 'exit 3'].join('\n');

/** A CLI that answers `version` but never returns for anything else. */
const HANGING_CLI = [
	'case "$1" in',
	'\tversion) echo "entire 0.12.2" ;;',
	'\t*) sleep 30 ;;',
	'esac',
].join('\n');

/** A CLI that prints a warning before its payload. */
const WARNING_CLI = [
	'echo "warning: the configuration file is out of date"',
	`echo '${TRACKED_STATUS}'`,
].join('\n');

/** A CLI that writes to both streams. */
const NOISY_CLI = [
	`echo '${TRACKED_STATUS}'`,
	'echo "a diagnostic on stderr" >&2',
].join('\n');

const temporaryDirectories: string[] = [];

suite('Entire CLI runner', () => {
	suiteTeardown(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function makeDirectory(prefix: string): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}

	/** Writes a fake `entire` binary into a directory and returns the path. */
	function writeFakeCli(directory: string, body: string): string {
		fs.mkdirSync(directory, { recursive: true });
		const file = path.join(directory, 'entire');
		fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
		fs.chmodSync(file, 0o755);
		return file;
	}

	/** A runner bound to a fake CLI in its own fake home directory. */
	function runnerFor(body: string): { runner: CliRunner; home: string; binary: string } {
		const home = makeDirectory('entire-cli-home-');
		const binary = writeFakeCli(path.join(home, '.local', 'bin'), body);
		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		return { runner: new CliRunner(locator), home, binary };
	}

	test('reports the CLI as absent when no binary exists', async () => {
		const home = makeDirectory('entire-cli-empty-');
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));

		const discovery = await runner.discover();
		assert.strictEqual(discovery.state, 'absent');

		const result = await runner.run(['status', '--json']);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false && result.reason, 'absent');
	});

	test('reports the CLI as broken when it exits non-zero', async () => {
		const { runner } = runnerFor(BROKEN_CLI);

		const discovery = await runner.discover();
		assert.strictEqual(discovery.state, 'broken');
		if (discovery.state === 'broken') {
			assert.match(discovery.detail, /unexpected failure/);
		}

		const result = await runner.run(['status', '--json']);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false && result.reason, 'broken');
	});

	test('finds a CLI at a documented install location off PATH and names the directory', async () => {
		const home = makeDirectory('entire-cli-offpath-');
		const installDirectory = path.join(home, '.local', 'bin');
		writeFakeCli(installDirectory, WORKING_CLI);

		// The binary is deliberately not on PATH.
		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));

		const discovery = await runner.discover();
		assert.strictEqual(discovery.state, 'available');
		if (discovery.state === 'available') {
			assert.strictEqual(discovery.location, 'install-location');
			assert.strictEqual(discovery.directory, installDirectory);
			assert.strictEqual(discovery.path, path.join(installDirectory, 'entire'));
			assert.strictEqual(discovery.version, '0.12.2');
		}
	});

	test('reports a CLI on PATH as being on PATH', async () => {
		const home = makeDirectory('entire-cli-onpath-');
		const binDirectory = path.join(home, 'bin');
		writeFakeCli(binDirectory, WORKING_CLI);

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: binDirectory } }));

		const discovery = await runner.discover();
		assert.strictEqual(discovery.state, 'available');
		if (discovery.state === 'available') {
			assert.strictEqual(discovery.location, 'path');
			assert.strictEqual(discovery.directory, binDirectory);
		}
	});

	test('reports a timeout as a failure instead of hanging', async () => {
		const { runner } = runnerFor(HANGING_CLI);

		const result = await runner.run(['status', '--json'], { timeoutMs: 250 });
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.reason, 'timeout');
		}
	});

	test('decodes the status payload the CLI prints', async () => {
		const { runner } = runnerFor(WORKING_CLI);

		const result = await runner.runJson(
			['status', '--json'],
			value => value as Record<string, unknown>,
		);

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.enabled, true);
			assert.deepStrictEqual(result.value.agents, ['Copilot CLI']);
			assert.strictEqual(Array.isArray(result.value.active_sessions), true);
		}
	});

	test('decodes the session list payload the CLI prints', async () => {
		const { runner } = runnerFor(WORKING_CLI);

		const result = await runner.runJson(
			['session', 'list', '--json'],
			value => value as { session_id: string; agent: string; status: string }[],
		);

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.length, 1);
			assert.strictEqual(result.value[0].session_id, 'abc-123');
			assert.strictEqual(result.value[0].agent, 'Copilot CLI');
			assert.strictEqual(result.value[0].status, 'active');
		}
	});

	test('reads the payload of a repository Entire does not track', async () => {
		const { runner } = runnerFor([
			'case "$1" in',
			'\tversion) echo "entire 0.12.2" ;;',
			`\tstatus) echo '${UNTRACKED_STATUS}' ;;`,
			'\t*) echo "unknown command" >&2; exit 2 ;;',
			'esac',
		].join('\n'));

		const result = await runner.runJson(
			['status', '--json'],
			value => value as { enabled: boolean; agents: string[] | null; error?: string },
		);

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.enabled, false);
			assert.strictEqual(result.value.agents, null);
			assert.strictEqual(result.value.error, 'not a git repository');
		}
	});

	test('parses JSON that is preceded by a warning line', async () => {
		const { runner } = runnerFor(WARNING_CLI);

		const result = await runner.runJson(
			['status', '--json'],
			value => value as Record<string, unknown>,
		);

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.enabled, true);
		}
	});

	test('captures stdout and stderr separately', async () => {
		const { runner } = runnerFor(NOISY_CLI);

		const result = await runner.run(['status', '--json']);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.stdout.trim(), TRACKED_STATUS);
		assert.strictEqual(result.stderr.trim(), 'a diagnostic on stderr');
	});

	test('reports a malformed payload as invalid output', async () => {
		const { runner } = runnerFor('echo "this is not json"');

		const result = await runner.runJson(['status', '--json'], value => value as unknown);
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.reason, 'invalid-output');
		}
	});

	test('reads the flags from the CLI own agent-help output', async () => {
		const { runner } = runnerFor(WORKING_CLI);

		const result = await runner.usage('status');
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			const names = result.value.flags.map(flag => flag.name);
			assert.deepStrictEqual(names, ['--detailed', '--json']);
			assert.strictEqual(result.value.flags[1].description, 'Emit JSON');
		}
	});

	test('re-uses the resolved CLI path instead of rediscovering it', async () => {
		const { runner } = runnerFor(WORKING_CLI);

		const first = await runner.discover();
		const second = await runner.discover();
		assert.strictEqual(first.state, 'available');
		assert.deepStrictEqual(first, second);
	});

	test('picks up a CLI installed after the first lookup', async () => {
		const home = makeDirectory('entire-cli-late-');
		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		const runner = new CliRunner(locator);

		assert.strictEqual((await runner.discover()).state, 'absent');

		writeFakeCli(path.join(home, '.local', 'bin'), WORKING_CLI);
		locator.invalidate();

		assert.strictEqual((await runner.discover()).state, 'available');
	});

	test('looks again for the CLI when the configured path changes', async () => {
		const home = makeDirectory('entire-cli-path-');
		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		const runner = new CliRunner(locator);

		const first = makeDirectory('entire-cli-first-');
		const second = makeDirectory('entire-cli-second-');
		writeFakeCli(first, WORKING_CLI);
		writeFakeCli(second, WORKING_CLI);

		runner.setConfiguredPath(path.join(first, 'entire'));
		const found = await runner.discover();
		assert.strictEqual(found.state, 'available');
		if (found.state !== 'available') {
			return;
		}
		assert.strictEqual(found.path, path.join(first, 'entire'));

		// The setting changed, so the CLI is looked up again rather than
		// the answer being remembered.
		runner.setConfiguredPath(path.join(second, 'entire'));
		const moved = await runner.discover();
		assert.strictEqual(moved.state, 'available');
		if (moved.state !== 'available') {
			return;
		}
		assert.strictEqual(moved.path, path.join(second, 'entire'));
	});

	test('goes back to the usual search when the configured path is taken away', async () => {
		const home = makeDirectory('entire-cli-back-');
		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		const runner = new CliRunner(locator);

		const elsewhere = makeDirectory('entire-cli-elsewhere-');
		writeFakeCli(elsewhere, WORKING_CLI);

		runner.setConfiguredPath(path.join(elsewhere, 'entire'));
		assert.strictEqual((await runner.discover()).state, 'available');

		runner.setConfiguredPath(undefined);
		assert.strictEqual((await runner.discover()).state, 'absent');
	});
});

suite('Entire CLI output parsing', () => {
	test('reads JSON that has a warning before it', () => {
		const parsed = parseJson('warning: something went sideways\n{"enabled":true}');
		assert.strictEqual(parsed.ok, true);
		if (parsed.ok) {
			assert.deepStrictEqual(parsed.value, { enabled: true });
		}
	});

	test('reads JSON that has a warning after it', () => {
		const parsed = parseJson('{"enabled":true}\nwarning: something went sideways');
		assert.strictEqual(parsed.ok, true);
		if (parsed.ok) {
			assert.deepStrictEqual(parsed.value, { enabled: true });
		}
	});

	test('reads an array payload', () => {
		const parsed = parseJson('[{"session_id":"abc"}]');
		assert.strictEqual(parsed.ok, true);
		if (parsed.ok) {
			assert.ok(Array.isArray(parsed.value));
		}
	});

	test('does not mistake a brace in a warning for the payload', () => {
		const parsed = parseJson('warning: unexpected token { at line 1\n{"enabled":true}');
		assert.strictEqual(parsed.ok, true);
		if (parsed.ok) {
			assert.deepStrictEqual(parsed.value, { enabled: true });
		}
	});

	test('reports empty output rather than throwing', () => {
		const parsed = parseJson('   \n  ');
		assert.strictEqual(parsed.ok, false);
	});

	test('reports text that is not JSON', () => {
		const parsed = parseJson('the CLI said something unexpected');
		assert.strictEqual(parsed.ok, false);
	});
});

suite('Entire CLI install locations', () => {
	test('includes the directory the CLI installs into', () => {
		const locations = documentedLocations('linux', '/home/someone', {});
		const directories = locations.map(location => location.directory);
		assert.ok(directories.includes(path.join('/home/someone', '.local', 'bin')));
		assert.ok(directories.includes(path.join('/usr', 'local', 'bin')));
	});

	test('uses the XDG data directory when one is set', () => {
		const locations = documentedLocations('linux', '/home/someone', {
			XDG_DATA_HOME: '/custom/data',
		});
		const directories = locations.map(location => location.directory);
		assert.ok(directories.includes(path.join('/custom/data', 'entire', 'bin')));
	});

	test('uses the Windows locations on Windows', () => {
		const locations = documentedLocations('win32', 'C:\\Users\\someone', {
			LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local',
		});
		const labels = locations.map(location => location.label);
		assert.ok(labels.some(label => label.includes('%LOCALAPPDATA%')));
	});
});

suite('Entire CLI usage parsing', () => {
	test('reads the flags and their descriptions', () => {
		const usage = parseUsage(
			'status',
			[
				'Usage: entire status [flags]',
				'',
				'Flags:',
				'  --detailed    Show the per-settings-file breakdown',
				'  --json        Emit JSON',
			].join('\n'),
		);

		assert.deepStrictEqual(
			usage.flags.map(flag => flag.name),
			['--detailed', '--json'],
		);
		assert.strictEqual(usage.flags[0].description, 'Show the per-settings-file breakdown');
	});

	test('ignores the flags listed in the usage synopsis', () => {
		const usage = parseUsage('status', 'Usage: entire status [--detailed] [--json]');
		assert.deepStrictEqual(usage.flags, []);
	});

	test('keeps the raw text', () => {
		const raw = 'Usage: entire status [flags]';
		assert.strictEqual(parseUsage('status', raw).raw, raw);
	});
});

suite('Entire CLI discovery helpers', () => {
	test('reads a plain version', () => {
		assert.strictEqual(parseVersion('0.12.2'), '0.12.2');
	});

	test('reads a version that carries the program name', () => {
		assert.strictEqual(parseVersion('entire 0.12.2'), '0.12.2');
	});

	test('reads a version with a leading v', () => {
		assert.strictEqual(parseVersion('v0.12.2'), '0.12.2');
	});

	test('reads a pre-release version', () => {
		assert.strictEqual(parseVersion('entire 0.13.0-rc.1'), '0.13.0-rc.1');
	});

	test('reads a version from a JSON payload', () => {
		assert.strictEqual(parseVersion('{"version":"0.12.2"}'), '0.12.2');
	});

	test('reports no version for empty output', () => {
		assert.strictEqual(parseVersion('  \n '), undefined);
	});

	test('splits PATH into its entries', () => {
		const entries = pathEntries({ PATH: ['/one', '/two', ''].join(path.delimiter) });
		assert.deepStrictEqual(entries, ['/one', '/two']);
	});

	test('reports no PATH entries when PATH is unset', () => {
		assert.deepStrictEqual(pathEntries({}), []);
	});

	test('uses a configured path in preference to everything else', () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-cli-configured-'));
		temporaryDirectories.push(home);

		const configured = path.join(home, 'somewhere', 'entire');
		fs.mkdirSync(path.dirname(configured), { recursive: true });
		fs.writeFileSync(configured, '#!/bin/sh\necho "entire 0.12.2"\n', 'utf8');
		fs.chmodSync(configured, 0o755);

		const candidate = findCandidate({ configuredPath: configured, homeDir: home, env: { PATH: '' } });
		assert.ok(candidate);
		assert.strictEqual(candidate.location, 'configured');
		assert.strictEqual(candidate.path, configured);
	});

	test('finds nothing when the configured path does not exist', () => {
		const candidate = findCandidate({
			configuredPath: '/nowhere/at/all/entire',
			homeDir: '/nowhere',
			env: { PATH: '' },
		});
		assert.strictEqual(candidate, undefined);
	});
});

suite('Entire CLI locator', () => {
	test('exposes the resolved path without running another lookup', async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-cli-peek-'));
		temporaryDirectories.push(home);

		const installDirectory = path.join(home, '.local', 'bin');
		fs.mkdirSync(installDirectory, { recursive: true });
		fs.writeFileSync(path.join(installDirectory, 'entire'), '#!/bin/sh\necho "entire 0.12.2"\n', 'utf8');
		fs.chmodSync(path.join(installDirectory, 'entire'), 0o755);

		const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
		assert.strictEqual(locator.peek(), undefined);

		await locator.current();
		const peeked = locator.peek();
		assert.ok(peeked);
		assert.strictEqual(peeked.state, 'available');
		if (peeked.state === 'available') {
			assert.strictEqual(peeked.path, path.join(installDirectory, 'entire'));
		}
	});
});

suite('Entire CLI with domain decoders', () => {
	test('decodes the status payload through the runner', async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-cli-domain-'));
		temporaryDirectories.push(home);

		const installDirectory = path.join(home, '.local', 'bin');
		fs.mkdirSync(installDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(installDirectory, 'entire'),
			'#!/bin/sh\ncase "$1" in\n\tversion) echo "entire 0.12.2" ;;\n\tstatus) echo \'{"enabled":false,"agents":null,"active_sessions":null,"error":"not a git repository"}\' ;;\n\tesac\n',
			'utf8',
		);
		fs.chmodSync(path.join(installDirectory, 'entire'), 0o755);

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const result = await runner.runJson(['status', '--json'], value =>
			unwrap(decodeWorkspaceStatus(value)),
		);

		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(result.value.kind, 'not-a-repository');
		}
	});

	test('reports a payload the decoder rejects as invalid output', async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-cli-badshape-'));
		temporaryDirectories.push(home);

		const installDirectory = path.join(home, '.local', 'bin');
		fs.mkdirSync(installDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(installDirectory, 'entire'),
			'#!/bin/sh\ncase "$1" in\n\tversion) echo "entire 0.12.2" ;;\n\tstatus) echo \'{"unexpected":true}\' ;;\n\tesac\n',
			'utf8',
		);
		fs.chmodSync(path.join(installDirectory, 'entire'), 0o755);

		const runner = new CliRunner(new CliLocator({ homeDir: home, env: { PATH: '' } }));
		const result = await runner.runJson(['status', '--json'], value =>
			unwrap(decodeWorkspaceStatus(value)),
		);

		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.reason, 'invalid-output');
			assert.match(result.detail, /status\.enabled/);
		}
	});
});
