import * as assert from 'assert';
import { spawnSync } from 'child_process';

import {
	CHECKPOINT_REF_PREFIX,
	classifyMigration,
	confirmMigration,
	describeMigrationOutcome,
	type AccountContext,
} from '../lib/entire';
import { migrateCheckpoints, type MigrationDependencies } from '../commands/migrateCheckpoints';
import { ALICE } from './support/activityCli';
import { fakeDoctorCli, type FakeDoctorCli, type FakeDoctorOptions } from './support/doctorCli';
import { harness } from './support/depthHarness';
import type { DepthScript } from './support/depthUi';

const BOB: AccountContext = { name: 'bob@eu.auth.entire.io', handle: 'bob', server: 'https://eu.auth.entire.io', active: true };
const DRY_RUN_CALL = 'alice@us.auth.entire.io|doctor migrate-checkpoints --dry-run';
const APPLY_CALL = `${ALICE.name}|doctor migrate-checkpoints`;

function setup(options: FakeDoctorOptions = {}, script: DepthScript = {}, acting: () => Promise<AccountContext | undefined> = () => Promise.resolve(ALICE)) {
	const cli = fakeDoctorCli(options);
	const built = harness(cli, { choose: message => (/dry run is open/.test(message) ? 'Migrate…' : undefined), ...script });
	const deps: MigrationDependencies = {
		depth: built.service,
		migration: built.migration,
		files: built.files,
		ui: built.ui,
		settings: built.settings,
		acting,
		workspaceName: () => 'workspace-folder',
	};
	return { cli, deps, ui: built.ui };
}

function applies(cli: FakeDoctorCli): string[] {
	return cli.callsTo('doctor migrate-checkpoints').filter(line => !line.includes('--dry-run'));
}

suite('Checkpoint migration: the confirmation and the outcomes', () => {
	test('the question names the repository, the login, the refs and what is not done', () => {
		const question = confirmMigration('gh/acme/widgets', ALICE, 3);
		assert.strictEqual(question.message, 'Create per-checkpoint refs in gh/acme/widgets as alice (login alice@us.auth.entire.io)?');
		assert.match(question.detail, /refs\/entire\/checkpoints\//);
		assert.match(question.detail, /nothing is pushed/);
		assert.match(question.detail, /no undo/);
		assert.match(question.detail, /Currently 3 refs exist there/);
		assert.strictEqual(question.action, 'Create the refs');
		assert.match(confirmMigration('r', { handle: 'a', name: 'a' }, 1).message, /as a\?$/);
		assert.match(confirmMigration('r', ALICE, 1).detail, /Currently 1 ref exist there/);
		assert.match(confirmMigration('r', ALICE, undefined).detail, /could not be counted/);
	});

	test('judges the outcome by the refs counted before and after', () => {
		assert.deepStrictEqual(classifyMigration(2, 5), { kind: 'migrated', created: 3 });
		assert.deepStrictEqual(classifyMigration(2, 2), { kind: 'unchanged' });
		assert.strictEqual(classifyMigration(undefined, 2).kind, 'unconfirmed');
		assert.strictEqual(classifyMigration(2, undefined).kind, 'unconfirmed');
		assert.match(describeMigrationOutcome({ kind: 'migrated', created: 2 }), /Created 2 refs under refs\/entire\/checkpoints\/\. They are queued for push/);
		assert.match(describeMigrationOutcome({ kind: 'unchanged' }), /already converted/);
		assert.match(describeMigrationOutcome({ kind: 'cancelled' }), /running it again is safe/);
		assert.match(describeMigrationOutcome({ kind: 'failed', detail: 'boom' }), /boom.*not retried/);
		assert.ok(CHECKPOINT_REF_PREFIX.endsWith('/'));
	});
});

suite('Checkpoint migration: the report and the apply', () => {
	test('migrate-report: the dry run is the first and only call until the person confirms, and nothing is written', async () => {
		const { cli, deps, ui } = setup({}, { choose: () => 'Close' });
		assert.strictEqual(await migrateCheckpoints(deps), 'reported');
		assert.deepStrictEqual(cli.callsTo('doctor migrate-checkpoints'), [DRY_RUN_CALL]);
		assert.deepStrictEqual(cli.refs(), []);
		assert.deepStrictEqual(ui.opened, ['document:dry-run']);
		assert.match(ui.documents[0].text, /^Dry run: nothing was written\./);
		assert.match(ui.documents[0].text, /Would migrate 2 checkpoints/);
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(ui.notices[0].actions, ['Migrate…', 'Close']);
		assert.match(ui.notices[0].message, /idempotent/);
	});

	test('migrate-apply: runs once as the confirmed login with no flag and no push, and counts the refs again', async () => {
		let reads = 0;
		const { cli, deps, ui } = setup({ migrateCreates: 3 }, {}, () => Promise.resolve(reads++ === 0 ? ALICE : BOB));
		cli.runner.setContext('pinned@example.invalid');
		assert.strictEqual(await migrateCheckpoints(deps), 'migrated');

		const question = ui.confirmations[0];
		assert.match(question.message, /gh\/acme\/widgets/);
		assert.match(question.message, /alice \(login alice@us\.auth\.entire\.io\)/);
		assert.match(question.detail, /refs\/entire\/checkpoints\//);
		assert.match(question.detail, /nothing is pushed/);
		assert.match(question.detail, /Currently 0 refs exist there/);

		assert.deepStrictEqual(cli.callsTo('doctor migrate-checkpoints'), [DRY_RUN_CALL, APPLY_CALL]);
		assert.deepStrictEqual(applies(cli), [APPLY_CALL], 'exactly one run, with no remote flag and no other flag');
		assert.strictEqual(cli.refs().length, 3);
		assert.match(ui.notices.at(-1)?.message ?? '', /Created 3 refs/);
		assert.ok(!cli.calls().some(line => /remote|push/.test(line)));
	});

	test('the dry run runs as the login the question names, even when another is pinned', async () => {
		const { cli, deps } = setup({}, { choose: () => 'Close' });
		cli.runner.setContext('pinned@example.invalid');
		await migrateCheckpoints(deps);
		assert.deepStrictEqual(cli.callsTo('doctor migrate-checkpoints'), [DRY_RUN_CALL]);
	});

	test('refs another process made while the question was open are not counted as migrated', async () => {
		const holder: { cli?: FakeDoctorCli } = {};
		const { cli, deps, ui } = setup({ migrateCreates: 2 }, {
			onConfirm: () => {
				spawnSync('git', ['update-ref', 'refs/entire/checkpoints/zz/foreign', 'HEAD'], { cwd: holder.cli?.repo });
			},
		});
		holder.cli = cli;
		assert.strictEqual(await migrateCheckpoints(deps), 'migrated');
		assert.match(ui.notices.at(-1)?.message ?? '', /Created 2 refs/);
		assert.strictEqual(cli.refs().length, 3);
	});

	test('the CLI output is behind a button, not inline', async () => {
		const { deps, ui } = setup({}, { choose: message => (/dry run is open/.test(message) ? 'Migrate…' : "Show the CLI's output") });
		await migrateCheckpoints(deps);
		assert.deepStrictEqual(ui.notices.at(-1)?.actions, ["Show the CLI's output"]);
		assert.deepStrictEqual(ui.opened, ['document:dry-run', 'document:migration']);
		assert.match(ui.documents[1].text, /Migrated 2 checkpoints/);
		assert.doesNotMatch(ui.notices.at(-1)?.message ?? '', /Migrated 2 checkpoints/);
	});

	test('migrate-declined: declining the confirmation leaves only the dry run in the call log', async () => {
		const { cli, deps } = setup({}, { confirms: [false] });
		assert.strictEqual(await migrateCheckpoints(deps), 'declined');
		assert.deepStrictEqual(cli.callsTo('doctor migrate-checkpoints'), [DRY_RUN_CALL]);
		assert.deepStrictEqual(cli.refs(), []);
	});

	test('no login means nothing is run beyond the report', async () => {
		const { cli, deps, ui } = setup({}, {}, () => Promise.resolve(undefined));
		assert.strictEqual(await migrateCheckpoints(deps), 'no-login');
		assert.match(ui.notices.at(-1)?.message ?? '', /No Entire login is available/);
		assert.deepStrictEqual(applies(cli), []);
	});

	test('names the workspace folder when the help does not name the repository', async () => {
		const help = 'Flags:\n      --dry-run   Report what would be migrated without writing refs\n';
		const { deps, ui } = setup({ helps: { 'doctor_migrate-checkpoints': help } });
		await migrateCheckpoints(deps);
		assert.match(ui.confirmations[0].message, /in workspace-folder as/);
	});

	test('a dry run that fails stops there, with the CLI detail', async () => {
		const { cli, deps, ui } = setup({ fail: { 'dry-run': 'no checkpoint branch found' } });
		assert.strictEqual(await migrateCheckpoints(deps), 'failed');
		assert.match(ui.notices[0].message, /no checkpoint branch found. Nothing was written/);
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(applies(cli), []);
	});

	test('an empty report offers nothing to confirm', async () => {
		const { cli, deps, ui } = setup({ dryRunText: '' });
		assert.strictEqual(await migrateCheckpoints(deps), 'reported');
		assert.deepStrictEqual(ui.documents, []);
		assert.deepStrictEqual(applies(cli), []);
	});

	test('a long report is bounded like any other output', async () => {
		const { deps, ui } = setup({ dryRunText: `${'checkpoint line'.padEnd(80, '.')}\n`.repeat(20_000) }, { choose: () => 'Close' });
		await migrateCheckpoints(deps);
		assert.match(ui.documents[0].text, /left out\. Use Save the whole output/);
		assert.ok(ui.documents[0].saveWhole);
	});
});

suite('Checkpoint migration: every outcome, never retried', () => {
	test('unchanged when the count is equal, on a repeat run too', async () => {
		const first = setup({ migrateCreates: 0 });
		assert.strictEqual(await migrateCheckpoints(first.deps), 'unchanged');
		assert.match(first.ui.notices.at(-1)?.message ?? '', /No new refs were created/);

		const second = setup({ migrateCreates: 2 });
		assert.strictEqual(await migrateCheckpoints(second.deps), 'migrated');
		assert.strictEqual(await migrateCheckpoints(second.deps), 'unchanged', 'the second run finds every checkpoint converted');
		assert.strictEqual(applies(second.cli).length, 2);
	});

	test('unconfirmed when git cannot count after the run', async () => {
		const { cli, deps, ui } = setup({ breakGit: true });
		assert.strictEqual(await migrateCheckpoints(deps), 'unconfirmed');
		assert.match(ui.notices.at(-1)?.message ?? '', /unconfirmed: the CLI finished, but the checkpoint refs could not be counted/);
		assert.strictEqual(applies(cli).length, 1);
	});

	test('failed with the CLI detail, and not retried', async () => {
		const { cli, deps, ui } = setup({ fail: { migrate: 'boom: the store is locked' } });
		assert.strictEqual(await migrateCheckpoints(deps), 'failed');
		assert.match(ui.notices.at(-1)?.message ?? '', /failed: boom: the store is locked\. It was not retried/);
		assert.strictEqual(applies(cli).length, 1);
	});

	test('cancelled says some refs may exist and that running it again is safe', async () => {
		const { cli, deps, ui } = setup({ slow: { migrate: 5 } }, { cancelAfterMs: 500 });
		assert.strictEqual(await migrateCheckpoints(deps), 'cancelled');
		assert.match(ui.notices.at(-1)?.message ?? '', /Some refs may already exist; running it again is safe/);
		assert.strictEqual(applies(cli).length, 1);
	});

	test('a timeout is a failure that names the setting and is not retried', async function () {
		this.timeout(15_000);
		const cli = fakeDoctorCli({ slow: { migrate: 5 } });
		const built = harness(cli, { choose: message => (/dry run is open/.test(message) ? 'Migrate…' : undefined) }, { applySeconds: 1 });
		const deps: MigrationDependencies = { depth: built.service, migration: built.migration, files: built.files, ui: built.ui, settings: built.settings, acting: () => Promise.resolve(ALICE), workspaceName: () => undefined };
		assert.strictEqual(await migrateCheckpoints(deps), 'failed');
		assert.match(built.ui.notices.at(-1)?.message ?? '', /migrateCheckpointsTimeout/);
		assert.strictEqual(applies(cli).length, 1);
	});
});
