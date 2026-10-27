import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	INSTALL_COMMAND,
	OnboardingPrompt,
	actionFor,
	detectFault,
	labelFor,
	messageFor,
	type OnboardingAction,
	type WorkspaceFault,
} from '../services/onboarding';
import { enableArguments } from '../services/setup';
import type { CliDiscovery } from '../services/cli/types';
import type { WorkspaceStatus } from '../lib/entire';

/** A CLI found on PATH. */
const ON_PATH: CliDiscovery = {
	state: 'available',
	path: '/usr/local/bin/entire',
	location: 'path',
	directory: '/usr/local/bin',
	version: '1.0.0',
};

/** A CLI found in the directory it installs to, which is off PATH. */
const OFF_PATH: CliDiscovery = {
	state: 'available',
	path: '/home/dev/.local/bin/entire',
	location: 'install-location',
	directory: '/home/dev/.local/bin',
	version: '1.0.0',
};

/** A repository that is not set up for Entire. */
const NOT_SET_UP: WorkspaceStatus = {
	kind: 'not-set-up',
	enabled: false,
	reason: 'not enabled',
};

/** A repository that is set up. */
const TRACKED: WorkspaceStatus = { kind: 'tracked', enabled: true, agents: [], activeSessions: [] };

suite('Entire onboarding detection', () => {
	test('finds a missing CLI', () => {
		const fault = detectFault({
			cli: { state: 'absent' },
			status: undefined,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'cli-absent');
		assert.deepStrictEqual(actionFor(fault), { kind: 'install' });
	});

	test('finds a repository that is not set up', () => {
		const fault = detectFault({
			cli: ON_PATH,
			status: NOT_SET_UP,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'not-set-up');
		assert.deepStrictEqual(actionFor(fault), { kind: 'enable' });
	});

	test('finds a CLI the terminal cannot see', () => {
		const fault = detectFault({
			cli: OFF_PATH,
			status: TRACKED,
			isRepository: true,
			onTerminalPath: false,
		});

		assert.strictEqual(fault.kind, 'off-path');
		assert.deepStrictEqual(actionFor(fault), {
			kind: 'repair-path',
			directory: '/home/dev/.local/bin',
		});
	});

	test('finds nothing when the terminal can see the CLI', () => {
		// A CLI the extension found off the PATH is still a fault when the
		// terminal can see it, because the terminal is what has to run it.
		const fault = detectFault({
			cli: OFF_PATH,
			status: TRACKED,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'ok');
		assert.strictEqual(actionFor(fault), undefined);
	});

	test('prefers setting the repository up over repairing the PATH', () => {
		const fault = detectFault({
			cli: OFF_PATH,
			status: NOT_SET_UP,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'not-set-up');
	});

	test('offers nothing outside a repository', () => {
		const fault = detectFault({
			cli: ON_PATH,
			status: NOT_SET_UP,
			isRepository: false,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'ok');
		assert.strictEqual(actionFor(fault), undefined);
	});

	test('offers nothing when the workspace is set up', () => {
		const fault = detectFault({
			cli: ON_PATH,
			status: TRACKED,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'ok');
	});

	test('offers nothing when the CLI is broken', () => {
		const fault = detectFault({
			cli: { state: 'broken', path: '/x/entire', location: 'path', directory: '/x', detail: 'boom' },
			status: undefined,
			isRepository: true,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'ok');
	});

	test('offers to install the CLI even outside a repository', () => {
		const fault = detectFault({
			cli: { state: 'absent' },
			status: undefined,
			isRepository: false,
			onTerminalPath: true,
		});

		assert.strictEqual(fault.kind, 'cli-absent');
	});

	test('never offers to disable or uninstall', () => {
		// The action type has no disable or uninstall case at all, so the
		// kinds below are the complete set of things that can be offered.
		const kinds = new Set<string>();

		const faults: WorkspaceFault[] = [
			{ kind: 'cli-absent' },
			{ kind: 'not-set-up' },
			{ kind: 'off-path', directory: '/x' },
			{ kind: 'ok' },
		];

		for (const fault of faults) {
			const action = actionFor(fault);
			if (action) {
				kinds.add(action.kind);
			}
		}

		assert.deepStrictEqual([...kinds].sort(), ['enable', 'install', 'repair-path']);
	});

	test('offers exactly one action for every fault', () => {
		const faults: WorkspaceFault[] = [
			{ kind: 'cli-absent' },
			{ kind: 'not-set-up' },
			{ kind: 'off-path', directory: '/x' },
		];

		for (const fault of faults) {
			const action = actionFor(fault);
			assert.ok(action, 'every fault has an action');
			assert.ok(labelFor(action).length > 0);
			assert.ok(messageFor(fault).length > 0);
		}
	});
});

suite('Entire onboarding prompt', () => {
	test('offers the prompt once per folder and never again', async () => {
		const state = new Map<string, unknown>();
		const shown: string[] = [];

		const prompt = new OnboardingPrompt({
			state: {
				get: <T>(key: string, fallback?: T) => (state.get(key) as T) ?? fallback,
				update: async (key: string, value: unknown) => {
					state.set(key, value);
				},
			} as never,
			folders: () => ['/work/sandbox'],
			detect: async () => ({ kind: 'cli-absent' }),
			run: async () => undefined,
			notify: async message => {
				shown.push(message);
				return undefined;
			},
		});

		assert.strictEqual(await prompt.offer(), true);
		assert.strictEqual(await prompt.offer(), false);
		assert.strictEqual(shown.length, 1);
	});

	test('asks each folder once', async () => {
		const state = new Map<string, unknown>();
		const shown: string[] = [];

		const prompt = new OnboardingPrompt({
			state: {
				get: <T>(key: string, fallback?: T) => (state.get(key) as T) ?? fallback,
				update: async (key: string, value: unknown) => {
					state.set(key, value);
				},
			} as never,
			folders: () => ['/work/one'],
			detect: async () => ({ kind: 'cli-absent' }),
			run: async () => undefined,
			notify: async message => {
				shown.push(message);
				return undefined;
			},
		});

		assert.strictEqual(await prompt.offer(), true);

		const other = new OnboardingPrompt({
			state: {
				get: <T>(key: string, fallback?: T) => (state.get(key) as T) ?? fallback,
				update: async (key: string, value: unknown) => {
					state.set(key, value);
				},
			} as never,
			folders: () => ['/work/two'],
			detect: async () => ({ kind: 'cli-absent' }),
			run: async () => undefined,
			notify: async message => {
				shown.push(message);
				return undefined;
			},
		});

		assert.strictEqual(await other.offer(), true);
		assert.strictEqual(shown.length, 2);
	});

	test('offers exactly one action button', async () => {
		let actions: string[] = [];

		const prompt = new OnboardingPrompt({
			state: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined } as never,
			folders: () => ['/work/sandbox'],
			detect: async () => ({ kind: 'cli-absent' }),
			run: async () => undefined,
			notify: async (_message, ...offered) => {
				actions = offered;
				return undefined;
			},
		});

		await prompt.offer();
		assert.strictEqual(actions.length, 1);
	});

	test('runs the action the user chose', async () => {
		const chosen: OnboardingAction[] = [];

		const prompt = new OnboardingPrompt({
			state: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined } as never,
			folders: () => ['/work/sandbox'],
			detect: async () => ({ kind: 'not-set-up' }),
			run: async action => {
				chosen.push(action);
			},
			notify: async (_message, ...offered) => offered[0],
		});

		await prompt.offer();
		assert.deepStrictEqual(chosen, [{ kind: 'enable' }]);
	});

	test('runs nothing when the notification is ignored', async () => {
		const chosen: OnboardingAction[] = [];

		const prompt = new OnboardingPrompt({
			state: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined } as never,
			folders: () => ['/work/sandbox'],
			detect: async () => ({ kind: 'not-set-up' }),
			run: async action => {
				chosen.push(action);
			},
			notify: async () => undefined,
		});

		await prompt.offer();
		assert.deepStrictEqual(chosen, []);
	});

	test('offers nothing when the workspace needs nothing', async () => {
		let shown = false;

		const prompt = new OnboardingPrompt({
			state: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined } as never,
			folders: () => ['/work/sandbox'],
			detect: async () => ({ kind: 'ok' }),
			run: async () => undefined,
			notify: async () => {
				shown = true;
				return undefined;
			},
		});

		assert.strictEqual(await prompt.offer(), false);
		assert.strictEqual(shown, false);
	});
});

suite('Entire onboarding prompt shape', () => {
	test('uses a notification, never a dialog', () => {
		const root = path.resolve(__dirname, '..', '..');
		const source = fs.readFileSync(path.join(root, 'src', 'services', 'onboarding.ts'), 'utf8');

		assert.match(source, /showInformationMessage/);
		assert.doesNotMatch(source, /showQuickPick|showInputBox|showModal|createQuickPick/);
	});

	test('is only offered from the extension, never from a hook', () => {
		const root = path.resolve(__dirname, '..', '..');
		const source = path.join(root, 'src');

		const offenders: string[] = [];
		const walk = (folder: string): void => {
			for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
				const full = path.join(folder, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!entry.name.endsWith('.ts')) {
					continue;
				}
				if (entry.name === 'extension.ts' || entry.name === 'onboarding.test.ts') {
					continue;
				}
				if (fs.readFileSync(full, 'utf8').includes('onboarding.offer')) {
					offenders.push(path.relative(root, full));
				}
			}
		};

		walk(source);
		assert.deepStrictEqual(offenders, [], 'the prompt must not be raised from a hook path');
	});

	test('points at the documented install method rather than running it', () => {
		assert.strictEqual(INSTALL_COMMAND, 'curl -fsSL https://entire.com/install.sh | bash');
	});

	test('never runs an installer', () => {
		const root = path.resolve(__dirname, '..', '..');
		const source = fs.readFileSync(path.join(root, 'src', 'services', 'onboarding.ts'), 'utf8');

		// The install command is shown to the user, never handed to a shell.
		assert.doesNotMatch(source, /child_process|exec\(|spawn\(|execFile|shell\./);
	});
});

suite('Entire setup', () => {
	test('enables without initialising a repository', async () => {
		const flags = ['--agent', '--no-init-repo', '--json'];
		const runner = {
			usage: async () => ({
				ok: true as const,
				value: {
					command: 'enable',
					flags: flags.map(name => ({ name, description: '' })),
					raw: '',
				},
			}),
		};

		const args = await enableArguments(runner as never);
		assert.ok(args);
		assert.ok(args.includes('--no-init-repo'));
		assert.ok(!args.includes('--init-repo'));
		assert.ok(!args.includes('--yes'));
	});
});
