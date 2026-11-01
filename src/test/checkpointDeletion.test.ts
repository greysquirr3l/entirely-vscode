import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as path from 'path';

import {
	checkpointDeleteArguments,
	classifyReadBack,
	decodeDryRun,
	decideDeletable,
	deletionConfirmation,
	isCheckpointId,
	planDeleteFlags,
	type Checkpoint,
	type DeleteFlags,
	type DeleteScope,
	type DeletionConfirmation,
} from '../lib/entire';
import {
	DELETE_SCOPES,
	checkpointFromTarget,
	deleteCheckpoint,
	type CheckpointDeletionDependencies,
	type CheckpointDeletionUi,
} from '../commands/checkpointDeletion';
import { CheckpointDeletionService } from '../services/checkpointDeletion';
import { clampCheckpointDeletionTimeout } from '../services/configuration';
import {
	DELETE_HELP,
	DRY_RUN_END,
	PLAN,
	PLAN_WITH_REMOTE,
	fakeCheckpointDeletionCli,
	type FakeCheckpointDeletionCli,
} from './support/checkpointDeletionCli';

const CHECKPOINT_ID = '01M5CC1T802WHX8DWF4FP7195H';
const BRANCH = 'feat/checkpoint-deletion';
const LOGIN = 'alice@us.auth.entire.io';

/** The plan the real CLI printed, for a checkpoint id. */
function plan(id: string): string {
	return PLAN.split('{id}').join(id).split('{fanout}').join(id.slice(-2)) + '\n\n' + DRY_RUN_END;
}

const FLAGS: DeleteFlags = {
	dryRun: '--dry-run',
	skipPrompt: '--force',
	localOnly: '--local-only',
};

const CHECKPOINT = {
	id: CHECKPOINT_ID,
	sessionIds: [],
	sessionCount: 1,
	isTaskCheckpoint: false,
	isLogsOnly: false,
};

const ALICE = {
	name: 'alice',
	handle: LOGIN,
	server: 'us.auth.entire.io',
	active: true,
};

/** What the person answers, and what they were asked. */
class FakeDeletionUi implements CheckpointDeletionUi {
	readonly confirmations: DeletionConfirmation[] = [];
	readonly offeredScopes: DeleteScope[] = [];
	readonly typed: string[] = [];
	readonly informations: string[] = [];
	readonly warnings: string[] = [];

	constructor(
		private readonly options: {
			readonly scope?: DeleteScope | undefined;
			readonly confirm?: boolean;
			readonly typed?: string | undefined;
		} = {},
	) {}

	async confirm(prompt: DeletionConfirmation): Promise<boolean> {
		this.confirmations.push(prompt);
		return this.options.confirm ?? true;
	}

	async chooseCheckpoint(
		title: string,
		checkpoints: readonly Checkpoint[],
	): Promise<Checkpoint | undefined> {
		return checkpoints[0];
	}

	async chooseScope(
		title: string,
		choices: readonly { scope: DeleteScope }[],
	): Promise<DeleteScope | undefined> {
		this.offeredScopes.push(...choices.map(choice => choice.scope));
		return this.options.scope;
	}

	async typeToConfirm(id: string): Promise<string | undefined> {
		this.typed.push(id);
		return this.options.typed;
	}

	async withProgress<T>(title: string, work: () => Promise<T>): Promise<T> {
		return work();
	}

	async inform(message: string): Promise<void> {
		this.informations.push(message);
	}

	async warn(message: string): Promise<void> {
		this.warnings.push(message);
	}
}

/** The flow's dependencies, over a fake CLI. */
function deps(
	cli: FakeCheckpointDeletionCli,
	ui: FakeDeletionUi,
	options: {
		/** `null` is no login at all; `undefined` is the default one. */
		readonly acting?: typeof ALICE | null;
		readonly listFails?: boolean;
		/** The listed checkpoint is read-only imported history. */
		readonly imported?: boolean;
	} = {},
): CheckpointDeletionDependencies {
	const service = new CheckpointDeletionService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		timeoutSeconds: () => 30,
	});
	let reads = 0;
	return {
		checkpoints: async () => {
			reads += 1;
			// The list fails on the read-back, after the deletion: the
			// first read is the one the flow starts from.
			if (options.listFails && reads > 1) {
				return { checkpoints: [], emptyReason: 'the CLI is not installed' };
			}
			return {
				checkpoints: cli
					.listed()
					.map(id => ({ ...CHECKPOINT, id, imported: options.imported })),
			};
		},
		detail: async id => ({
			id,
			branch: BRANCH,
			filesTouched: [],
			sessionCount: 1,
			sessions: [],
			partial: false,
		}),
		deletion: service,
		acting: async () => (options.acting === undefined ? ALICE : (options.acting ?? undefined)),
		ui,
		refresh: () => undefined,
	};
}

suite('Checkpoint deletion flags', () => {
	test('finds each flag by what the help says it does', () => {
		const plan = planDeleteFlags(DELETE_HELP);
		assert.ok(plan.ok);
		assert.strictEqual(plan.dryRun, '--dry-run');
		assert.strictEqual(plan.skipPrompt, '--force');
		assert.strictEqual(plan.localOnly, '--local-only');
	});

	test('follows a CLI that names its flags differently', () => {
		const plan = planDeleteFlags(`Flags:
      --preview            Print what would be deleted without changing anything
      --yes                Delete without asking for confirmation
      --machine            Delete only the local copy; leave every remote untouched
`);
		assert.ok(plan.ok);
		assert.strictEqual(plan.dryRun, '--preview');
		assert.strictEqual(plan.skipPrompt, '--yes');
		assert.strictEqual(plan.localOnly, '--machine');
	});

	test('refuses a CLI whose help does not describe a preview', () => {
		const plan = planDeleteFlags(`Flags:
  -f, --force   Delete without asking for confirmation
      --local-only   Delete only the local copy; leave every remote untouched
`);
		assert.ok(!plan.ok);
		assert.match(plan.detail, /update the CLI/);
	});

	test('refuses a CLI whose help does not describe the local-only flag', () => {
		const plan = planDeleteFlags(`Flags:
      --dry-run   Print what would be deleted without changing anything
  -f, --force   Delete without asking for confirmation
`);
		assert.ok(!plan.ok);
		assert.match(plan.detail, /update the CLI/);
	});
});

suite('Checkpoint deletion arguments', () => {
	test('puts the id after the end-of-options marker', () => {
		assert.deepStrictEqual(checkpointDeleteArguments(FLAGS, CHECKPOINT_ID, 'everywhere', 'preview'), [
			'checkpoint',
			'delete',
			'--dry-run',
			'--',
			CHECKPOINT_ID,
		]);
		assert.deepStrictEqual(checkpointDeleteArguments(FLAGS, CHECKPOINT_ID, 'everywhere', 'delete'), [
			'checkpoint',
			'delete',
			'--force',
			'--',
			CHECKPOINT_ID,
		]);
		assert.deepStrictEqual(checkpointDeleteArguments(FLAGS, CHECKPOINT_ID, 'local-only', 'delete'), [
			'checkpoint',
			'delete',
			'--force',
			'--local-only',
			'--',
			CHECKPOINT_ID,
		]);
	});

	test('refuses an id the CLI could not be given', () => {
		assert.ok(isCheckpointId(CHECKPOINT_ID));
		assert.ok(!isCheckpointId('--force'));
		assert.ok(!isCheckpointId('not an id'));
	});
});

suite('Checkpoint deletion confirmation', () => {
	test('names the checkpoint, its branch, the login and what it would reach', () => {
		const confirmation = deletionConfirmation({
			id: CHECKPOINT_ID,
			scope: 'everywhere',
			acting: LOGIN,
			branch: BRANCH,
			dryRun: plan(CHECKPOINT_ID),
		});
		assert.strictEqual(confirmation.message, `Delete checkpoint ${CHECKPOINT_ID}?`);
		assert.strictEqual(confirmation.action, 'Delete Checkpoint Everywhere');
		assert.match(confirmation.detail, new RegExp(CHECKPOINT_ID));
		assert.match(confirmation.detail, new RegExp(BRANCH));
		assert.match(confirmation.detail, new RegExp(LOGIN));
		assert.match(confirmation.detail, /Remotes:/);
		assert.match(confirmation.detail, /Dry run: nothing was changed\./);
		assert.match(confirmation.detail, /This machine and every checkpoint remote/);
		assert.match(confirmation.detail, /every checkpoint remote that holds the checkpoint/);
		assert.match(confirmation.detail, /cannot be undone/);
		assert.match(confirmation.detail, /full transcript/);
		assert.match(confirmation.detail, /entire\/checkpoints\/v1/);
		assert.strictEqual(confirmation.typeToConfirm, CHECKPOINT_ID);
	});

	test('a local-only confirmation does not claim the deletion cannot be undone', () => {
		const confirmation = deletionConfirmation({
			id: CHECKPOINT_ID,
			scope: 'local-only',
			acting: LOGIN,
			branch: BRANCH,
		});
		assert.strictEqual(confirmation.action, 'Delete Local Copy');
		assert.ok(
			!/cannot be undone/.test(confirmation.detail),
			'a local deletion must not be called irreversible',
		);
		assert.match(confirmation.detail, /This machine only/);
		assert.match(confirmation.detail, /No checkpoint remote is contacted/);
		assert.match(confirmation.detail, /sync remote/);
		assert.strictEqual(confirmation.typeToConfirm, undefined);
	});

	test('says the commit is not reported when there is no branch', () => {
		const confirmation = deletionConfirmation({
			id: CHECKPOINT_ID,
			scope: 'local-only',
			acting: LOGIN,
		});
		assert.match(confirmation.detail, /Commit not reported\./);
	});
});

suite('Checkpoint deletion decisions', () => {
	test('refuses an imported checkpoint before any CLI call', () => {
		const decision = decideDeletable({ ...CHECKPOINT, imported: true });
		assert.ok(!decision.ok);
		assert.strictEqual(decision.reason, 'imported');
	});

	test('refuses a checkpoint whose id is not one the CLI could be given', () => {
		const decision = decideDeletable({ ...CHECKPOINT, id: 'not an id' });
		assert.ok(!decision.ok);
		assert.strictEqual(decision.reason, 'bad-id');
	});

	test('reads the plan the CLI printed', () => {
		const reading = decodeDryRun(plan(CHECKPOINT_ID));
		assert.match(reading.text, /^Checkpoint /);
		assert.match(reading.text, /Remotes:\n  none configured/);
		assert.match(reading.text, /Dry run: nothing was changed\./);
		assert.strictEqual(reading.truncated, false);
	});

	test('a plan too long to show is cut, and says so', () => {
		const long = plan(CHECKPOINT_ID) + '\n' + '  01M6AEG27M697D463Z49694KKM  edebce2b-aa62-41df-b3d3-1e65ab54c240\n'.repeat(80);
		const reading = decodeDryRun(long);
		assert.strictEqual(reading.truncated, true);
		assert.ok(reading.text.length < long.length, 'the plan is shorter than it was');
		assert.match(reading.text, /… the rest of the plan was not shown\.$/);
	});

	test('a read-back that cannot tell says so', () => {
		assert.strictEqual(classifyReadBack([CHECKPOINT_ID], [], CHECKPOINT_ID), 'gone');
		assert.strictEqual(classifyReadBack([CHECKPOINT_ID], [CHECKPOINT_ID], CHECKPOINT_ID), 'still-listed');
		assert.strictEqual(classifyReadBack([CHECKPOINT_ID], undefined, CHECKPOINT_ID), 'unknown');
		assert.strictEqual(classifyReadBack([], [], CHECKPOINT_ID), 'unknown');
	});
});

suite('Checkpoint deletion flow', () => {
	test('runs the dry-run first, shows it, and deletes once as the confirmed login', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'everywhere', typed: CHECKPOINT_ID });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'done');
		const calls = cli.calls().map(call => call.line);
		const helpAt = calls.findIndex(call => call.includes('agent-help checkpoint delete'));
		const dryRunAt = calls.findIndex(call => call.includes('--dry-run'));
		const deleteAt = calls.findIndex(call => call.includes('--force'));
		assert.ok(helpAt >= 0, 'the help is read');
		assert.ok(dryRunAt > helpAt, 'the dry-run runs after the help');
		assert.ok(deleteAt > dryRunAt, 'the dry-run must run before the deletion');
		assert.strictEqual(cli.mutations().length, 1, 'the deletion runs once');
		assert.strictEqual(cli.mutations()[0].context, 'alice', 'the deletion runs as the confirmed login');
		assert.match(ui.confirmations[0].detail, /Dry run: nothing was changed\./);
		assert.match(ui.confirmations[0].detail, /Remotes:/);
		assert.match(ui.informations[0], new RegExp(`Deleted checkpoint ${CHECKPOINT_ID}`));
	});

	test('deletes nothing when the modal is declined', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'everywhere', confirm: false });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'cancelled');
		assert.strictEqual(cli.mutations().length, 0);
	});

	test('deletes nothing when the id is not typed, or is typed wrongly', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const declined = new FakeDeletionUi({ scope: 'everywhere', typed: undefined });
		assert.strictEqual(await deleteCheckpoint(deps(cli, declined)), 'cancelled');

		const wrong = new FakeDeletionUi({ scope: 'everywhere', typed: '01HZY7Q3M4N5' });
		assert.strictEqual(await deleteCheckpoint(deps(cli, wrong)), 'cancelled');

		assert.strictEqual(cli.mutations().length, 0);
	});

	test('a local-only deletion needs no typed id', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'local-only' });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'done', ui.warnings.join(' | '));
		assert.deepStrictEqual(ui.typed, []);
		assert.match(cli.mutations()[0].line, /--local-only/);
		assert.match(ui.informations[0], /Deleted the local copy/);
		assert.match(ui.informations[0], /may still hold it/);
	});

	test('a CLI without the command says so and deletes nothing', async () => {
		const cli = fakeCheckpointDeletionCli({
			without: ['checkpoint delete'],
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
		});
		const ui = new FakeDeletionUi({ scope: 'everywhere' });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'failed');
		assert.strictEqual(cli.mutations().length, 0);
		assert.match(ui.warnings[0], /update the CLI/);
	});

	test('a refusal is the CLI own message, and nothing is retried', async () => {
		const cli = fakeCheckpointDeletionCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
			localOnlyRefusal:
				'Error: --local-only refused: the sync remote holds a copy of this checkpoint',
		});
		const ui = new FakeDeletionUi({ scope: 'local-only' });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'failed');
		assert.strictEqual(cli.mutations().length, 1, 'a refusal is not retried');
		assert.match(ui.warnings[0], /sync remote holds a copy/);
	});

	test('a checkpoint that is still listed is reported as not confirmed', async () => {
		const cli = fakeCheckpointDeletionCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
			keepOnDelete: true,
		});
		const ui = new FakeDeletionUi({ scope: 'everywhere', typed: CHECKPOINT_ID });
		const result = await deleteCheckpoint(deps(cli, ui));

		assert.strictEqual(result, 'unconfirmed');
		assert.match(ui.warnings[0], /not confirmed/);
	});

	test('a list that cannot be read is reported as not confirmed', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'everywhere', typed: CHECKPOINT_ID });
		const result = await deleteCheckpoint(deps(cli, ui, { listFails: true }));

		assert.strictEqual(result, 'unconfirmed');
		assert.match(ui.warnings[0], /not confirmed/);
	});

	test('an imported checkpoint is refused before anything is asked', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'everywhere' });
		const result = await deleteCheckpoint(deps(cli, ui, { imported: true }));

		assert.strictEqual(result, 'cancelled');
		assert.strictEqual(cli.calls().length, 0);
		assert.match(ui.warnings[0], /read-only/);
	});

	test('without a login nothing is asked and nothing runs', async () => {
		const cli = fakeCheckpointDeletionCli({ checkpoints: [{ checkpoint_id: CHECKPOINT_ID }] });
		const ui = new FakeDeletionUi({ scope: 'everywhere' });
		const result = await deleteCheckpoint(deps(cli, ui, { acting: null }));

		assert.strictEqual(result, 'no-login');
		assert.strictEqual(cli.calls().length, 0);
		assert.match(ui.warnings[0], /login/i);
	});

	test('the id and the CLI output stay out of the invocation record', async () => {
		const cli = fakeCheckpointDeletionCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
			remote: 'checkpoints',
		});
		const ui = new FakeDeletionUi({ scope: 'everywhere', typed: CHECKPOINT_ID });
		await deleteCheckpoint(deps(cli, ui));

		const deletions = cli.recorded.filter(entry =>
			entry.invocation.args.some(argument => argument === 'delete'),
		);
		assert.ok(deletions.length > 0, 'the deletions were recorded');
		for (const entry of cli.recorded) {
			assert.ok(
				!entry.invocation.args.includes(CHECKPOINT_ID),
				`the checkpoint id is in the record: ${entry.invocation.args.join(' ')}`,
			);
		}
		for (const entry of deletions) {
			assert.strictEqual(entry.bodies.stdout, undefined, 'the CLI output is kept out of the record');
			assert.strictEqual(entry.bodies.stderr, undefined, 'the CLI output is kept out of the record');
		}
		assert.ok(
			!JSON.stringify(cli.recorded).includes('its transcript'),
			'the dry-run text is kept out of the record',
		);
	});

	test('the fake says what the real CLI said', () => {
		const cli = fakeCheckpointDeletionCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
		});
		const said = spawnSync(
			path.join(cli.dir, '.local', 'bin', 'entire'),
			['checkpoint', 'delete', '--dry-run', '--', CHECKPOINT_ID],
			{ cwd: cli.dir, encoding: 'utf8' },
		);

		assert.strictEqual(said.status, 0, said.stderr);
		// The CLI ends its output with a newline, and so does the fake.
		assert.strictEqual(said.stdout, `${plan(CHECKPOINT_ID)}\n`);
	});

	test('the plan names the remotes that hold the checkpoint', async () => {
		const cli = fakeCheckpointDeletionCli({
			checkpoints: [{ checkpoint_id: CHECKPOINT_ID }],
			remote: 'checkpoints',
		});
		const ui = new FakeDeletionUi({ scope: 'everywhere', typed: CHECKPOINT_ID });
		await deleteCheckpoint(deps(cli, ui));

		// The CLI's plan says which remotes hold the checkpoint, and the
		// confirmation shows the plan as the CLI printed it.
		assert.match(ui.confirmations[0].detail, /Remotes:/);
		assert.match(ui.confirmations[0].detail, /checkpoints .*holds ref/);
	});

	test('a tree row names one checkpoint, and a list of rows names none', () => {
		const find = (id: string) => (id === CHECKPOINT_ID ? CHECKPOINT : undefined);

		assert.strictEqual(checkpointFromTarget({ id: CHECKPOINT_ID }, find)?.id, CHECKPOINT_ID);
		assert.strictEqual(checkpointFromTarget({ checkpoint: CHECKPOINT }, find)?.id, CHECKPOINT_ID);
		assert.strictEqual(checkpointFromTarget(undefined, find), undefined);
		assert.strictEqual(checkpointFromTarget({ id: 'other' }, find), undefined);
		// There is no batch form: a list of rows is asked about one
		// checkpoint at a time, as the person chooses.
		assert.strictEqual(checkpointFromTarget([{ id: CHECKPOINT_ID }], find), undefined);
	});

	test('the scope is asked with no item chosen for the user', () => {
		assert.deepStrictEqual(
			DELETE_SCOPES.map(choice => choice.scope),
			['everywhere', 'local-only'],
		);
	});
});

suite('Checkpoint deletion settings', () => {
	test('the timeout is put inside the range the extension will wait for', () => {
		assert.strictEqual(clampCheckpointDeletionTimeout(1), 5);
		assert.strictEqual(clampCheckpointDeletionTimeout(10000), 900);
		assert.strictEqual(clampCheckpointDeletionTimeout(120), 120);
		assert.strictEqual(clampCheckpointDeletionTimeout(Number.NaN), 120);
	});
});
