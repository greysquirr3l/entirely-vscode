import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	cleanArguments,
	cleanPreviewArguments,
	configureArguments,
	disableArguments,
	isCheckpointRemote,
	isCleanSessionId,
	isRunnerName,
	missingForStep,
	planCaptureFlags,
	readBackendChoices,
	readRemoteProviders,
	readSourceChoices,
	runnerSetupArguments,
	sensitiveFlags,
	uninstallArguments,
	type CaptureFlags,
} from '../lib/entire';
import { CLEAN_HELP, CONFIGURE_HELP, DISABLE_HELP, RUNNER_SETUP_HELP } from './support/captureCli';

const ROOT = path.resolve(__dirname, '..', '..');

function planned(command: Parameters<typeof planCaptureFlags>[0], help: string): CaptureFlags {
	const plan = planCaptureFlags(command, help);
	assert.ok(plan.ok, plan.ok ? '' : plan.detail);
	return plan.flags;
}

suite('Capture control: flags come from the help', () => {
	test('picks each role of disable from the 0.12.2 help', () => {
		assert.deepStrictEqual(planned('disable', DISABLE_HELP), { uninstall: '--uninstall', skipPrompt: '--force', local: '--local', project: '--project' });
	});

	test('picks each role of configure, and keeps the hook reinstall apart from the absolute path flag', () => {
		const flags = planned('configure', CONFIGURE_HELP);
		assert.deepStrictEqual(flags, {
			telemetry: '--telemetry',
			absoluteHookPath: '--absolute-git-hook-path',
			reinstallHook: '--force',
			checkpointRemote: '--checkpoint-remote',
			checkpointBackend: '--checkpoint-backend',
			skipPushSessions: '--skip-push-sessions',
			summaryProvider: '--summarize-provider',
			summaryModel: '--summarize-model',
			summaryTimeout: '--summarize-timeout-seconds',
			local: '--local',
			project: '--project',
		});
	});

	test('picks each role of clean, and the preview is found by name or by what the line says', () => {
		assert.deepStrictEqual(planned('clean', CLEAN_HELP), { all: '--all', dryRun: '--dry-run', skipPrompt: '--force', session: '--session' });
		const renamed = CLEAN_HELP.replace('-d, --dry-run          Preview what would be deleted without deleting', '    --show-only        Preview what would be deleted without deleting');
		assert.strictEqual(planned('clean', renamed).dryRun, '--show-only');
	});

	test('picks each role of runner setup, never the debug directory, from the prose list and the flag table', () => {
		const flags = planned('runner setup', RUNNER_SETUP_HELP);
		assert.deepStrictEqual(flags, {
			defaultsOnly: '--defaults-only',
			printPrompt: '--print-prompt',
			dryRun: '--dry-run',
			yes: '--yes',
			agent: '--agent',
			sources: '--sources',
		});
		assert.ok(!Object.values(flags).includes('--debug-dir'));
	});

	test('a help text with no flag table is refused, and no fallback table fills it in', () => {
		const plan = planCaptureFlags('clean', 'entire clean — Clean up Entire session data\n');
		assert.ok(!plan.ok);
		assert.match(plan.detail, /clean/);
	});

	test('names the roles an action cannot do without', () => {
		const noPreview = planned('clean', CLEAN_HELP.replace(/ {2}-d, --dry-run.*\n/, ''));
		assert.strictEqual(noPreview.dryRun, undefined);
		assert.deepStrictEqual(missingForStep({ kind: 'clean-preview', scope: { kind: 'head' } }, noPreview), ['preview flag']);
		assert.deepStrictEqual(missingForStep({ kind: 'clean', scope: { kind: 'head' } }, noPreview), []);
		const noSkip = planned('clean', CLEAN_HELP.replace(/ {2}-f, --force.*\n/, ''));
		assert.deepStrictEqual(missingForStep({ kind: 'clean', scope: { kind: 'all' } }, noSkip), ['flag that skips the confirmation prompt']);
		assert.deepStrictEqual(missingForStep({ kind: 'uninstall' }, planned('disable', DISABLE_HELP.replace(/ {6}--uninstall.*\n/, ''))), ['mode that removes Entire completely']);
		assert.deepStrictEqual(missingForStep({ kind: 'runner-tailor', options: { agent: 'x' } }, planned('runner setup', RUNNER_SETUP_HELP.replace(/ {6}--agent string.*\n/, ''))), ['flag that names the agent for this run']);
	});

	test('no source file under lib/entire/capture*.ts names a flag outside a comment', () => {
		const files = [
			...fs.readdirSync(path.join(ROOT, 'src', 'lib', 'entire')).filter(name => name.startsWith('capture')).map(name => path.join('src', 'lib', 'entire', name)),
			path.join('src', 'services', 'captureControl.ts'),
			path.join('src', 'commands', 'captureControl.ts'),
			path.join('src', 'commands', 'captureCommands.ts'),
		];
		const spelling = /--(?:uninstall|force|local|project|dry-run|all|session|telemetry|yes|defaults-only|print-prompt|agent|sources|debug-dir|limit|checkpoint-remote|checkpoint-backend|absolute-git-hook-path|skip-push-sessions|summarize-[a-z-]+)\b/;
		const offenders: string[] = [];
		for (const file of files) {
			const code = fs
				.readFileSync(path.join(ROOT, file), 'utf8')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.split('\n')
				.map(line => line.replace(/(^|\s)\/\/.*$/, ''))
				.join('\n');
			if (spelling.test(code)) {
				offenders.push(file);
			}
		}
		assert.deepStrictEqual(offenders, []);
	});
});

suite('Capture control: arguments', () => {
	const disable = planned('disable', DISABLE_HELP);
	const configure = planned('configure', CONFIGURE_HELP);
	const clean = planned('clean', CLEAN_HELP);
	const runner = planned('runner setup', RUNNER_SETUP_HELP);

	test('disable carries only the chosen target; uninstall carries the mode and the skip flag, and no target', () => {
		assert.deepStrictEqual(disableArguments(disable, 'local'), ['disable', '--local']);
		assert.deepStrictEqual(disableArguments(disable, 'project'), ['disable', '--project']);
		assert.deepStrictEqual(uninstallArguments(disable), ['disable', '--uninstall', '--force']);
		assert.strictEqual(disableArguments({ project: '--project' }, 'local'), undefined);
		assert.strictEqual(uninstallArguments({ uninstall: '--uninstall' }), undefined);
	});

	test('configure passes exactly the chosen settings and the target, a boolean off as flag=false', () => {
		assert.deepStrictEqual(configureArguments(configure, [{ key: 'telemetry', value: false }], 'local'), ['configure', '--telemetry=false', '--local']);
		assert.deepStrictEqual(
			configureArguments(configure, [{ key: 'checkpointBackend', value: 'refs' }, { key: 'summaryTimeout', value: 0 }, { key: 'reinstallHook' }], 'project'),
			['configure', '--checkpoint-backend=refs', '--summarize-timeout-seconds=0', '--force', '--project'],
		);
		assert.strictEqual(configureArguments(configure, [], 'local'), undefined);
		assert.strictEqual(configureArguments(configure, [{ key: 'telemetry', value: true }, { key: 'telemetry', value: false }], 'local'), undefined);
		assert.strictEqual(configureArguments({ telemetry: '--telemetry' }, [{ key: 'telemetry', value: true }], 'local'), undefined);
	});

	test('a typed remote and model go as their own arguments so the recorder can hide them', () => {
		const args = configureArguments(configure, [{ key: 'checkpointRemote', value: 'github:acme/cp' }, { key: 'summaryModel', value: 'my/model' }], 'local');
		assert.deepStrictEqual(args, ['configure', '--checkpoint-remote', 'github:acme/cp', '--summarize-model', 'my/model', '--local']);
		assert.deepStrictEqual(sensitiveFlags(configure), ['--checkpoint-remote', '--summarize-model']);
	});

	test('clean: the default scope, all, and one session after its flag, never as a bare operand', () => {
		assert.deepStrictEqual(cleanPreviewArguments(clean, { kind: 'head' }), ['clean', '--dry-run']);
		assert.deepStrictEqual(cleanArguments(clean, { kind: 'head' }), ['clean', '--force']);
		assert.deepStrictEqual(cleanArguments(clean, { kind: 'all' }), ['clean', '--force', '--all']);
		assert.deepStrictEqual(cleanArguments(clean, { kind: 'session', id: 'sess-1' }), ['clean', '--force', '--session=sess-1']);
		assert.deepStrictEqual(cleanPreviewArguments(clean, { kind: 'session', id: 'sess-1' }), ['clean', '--dry-run', '--session=sess-1']);
	});

	test('clean refuses a session id that could be read as a flag', () => {
		for (const id of ['-x', '--all', '', 'a b', 'a/b', '../x']) {
			assert.strictEqual(isCleanSessionId(id), false, id);
			assert.strictEqual(cleanArguments(clean, { kind: 'session', id }), undefined, id);
		}
		assert.strictEqual(isCleanSessionId('2026-10-30-abc.1'), true);
	});

	test('runner setup builds each of its four forms and never the debug directory', () => {
		assert.deepStrictEqual(runnerSetupArguments(runner, 'defaults'), ['runner', 'setup', '--defaults-only']);
		assert.deepStrictEqual(runnerSetupArguments(runner, 'print-prompt'), ['runner', 'setup', '--print-prompt']);
		assert.deepStrictEqual(runnerSetupArguments(runner, 'dry-run', { sources: ['repo', 'prs'] }), ['runner', 'setup', '--dry-run', '--sources=repo,prs']);
		assert.deepStrictEqual(runnerSetupArguments(runner, 'tailor', { agent: 'codex', runner: 'risk' }), ['runner', 'setup', '--yes', '--agent=codex', '--', 'risk']);
		for (const mode of ['defaults', 'print-prompt', 'dry-run', 'tailor'] as const) {
			assert.ok(!runnerSetupArguments(runner, mode, { agent: 'a', sources: ['repo'] })?.some(arg => arg.includes('debug')));
		}
	});

	test('a tailoring option is only passed to a form that tailors', () => {
		assert.deepStrictEqual(runnerSetupArguments(runner, 'defaults', { agent: 'codex', sources: ['repo'] }), ['runner', 'setup', '--defaults-only']);
		assert.deepStrictEqual(runnerSetupArguments(runner, 'print-prompt', { agent: 'codex' }), ['runner', 'setup', '--print-prompt']);
	});

	test('a runner name that starts with a dash, has whitespace or is too long is refused', () => {
		for (const name of ['-risk', '--yes', 'a b', '', 'x'.repeat(65), 'a/b']) {
			assert.strictEqual(isRunnerName(name), false, name);
			assert.strictEqual(runnerSetupArguments(runner, 'tailor', { runner: name }), undefined, name);
		}
		assert.strictEqual(isRunnerName('trail-risk'), true);
	});
});

suite('Capture control: values read from the help', () => {
	test('reads the backend choices from the description', () => {
		const description = CONFIGURE_HELP.split('\n').find(line => line.includes('--checkpoint-backend'))?.replace(/^.*?string\s+/, '') ?? '';
		assert.deepStrictEqual(readBackendChoices(description), ['refs', 'branch']);
		assert.deepStrictEqual(readBackendChoices('Storage backend: a, b or c'), ['a', 'b', 'c']);
		assert.deepStrictEqual(readBackendChoices('Storage backend'), []);
	});

	test('reads the remote providers and checks the provider:owner/repo form', () => {
		const description = 'Checkpoint remote in provider:owner/repo format; providers: github, gitlab (e.g., github:org/checkpoints-repo)';
		const providers = readRemoteProviders(description);
		assert.deepStrictEqual(providers, ['github', 'gitlab']);
		assert.strictEqual(isCheckpointRemote('github:org/repo', providers), true);
		assert.strictEqual(isCheckpointRemote('gitlab:org/repo.git', providers), true);
		for (const bad of ['github:org', 'bitbucket:org/repo', 'org/repo', 'github:org/repo/extra', 'github:../repo', '']) {
			assert.strictEqual(isCheckpointRemote(bad, providers), false, bad);
		}
		assert.strictEqual(isCheckpointRemote('anything:org/repo', []), true);
	});

	test('reads the data sources from the sources flag', () => {
		const table = planCaptureFlags('runner setup', RUNNER_SETUP_HELP);
		assert.ok(table.ok);
		assert.deepStrictEqual(readSourceChoices(table.table, '--sources'), ['repo', 'prs', 'checkpoints', 'trails', 'all']);
		assert.deepStrictEqual(readSourceChoices(table.table, undefined), []);
	});
});
