import { confirmMigration, describeMigrationOutcome, type AccountContext } from '../lib/entire';
import type { CheckpointMigrationService } from '../services/checkpointMigration';
import type { DoctorDepthService } from '../services/doctorDepth';
import { presentOutput, reportUnavailable, whileIdle, type DepthFiles, type DepthSettings, type DoctorDepthUi } from './doctorDepth';

export interface MigrationDependencies {
	readonly depth: DoctorDepthService;
	readonly migration: CheckpointMigrationService;
	readonly files: DepthFiles;
	readonly ui: DoctorDepthUi;
	readonly settings: () => DepthSettings;
	/** The login the CLI will act as, read again just before the question. */
	readonly acting: () => Promise<AccountContext | undefined>;
	/** What the repository is called, when the CLI's help does not say. */
	readonly workspaceName: () => string | undefined;
	readonly running?: { active: boolean };
}

export type MigrationFlowResult = 'migrated' | 'unchanged' | 'unconfirmed' | 'failed' | 'cancelled' | 'declined' | 'reported' | 'busy' | 'unavailable' | 'no-login';

const MIGRATE = 'Migrate…';
const CLOSE = 'Close';
const SHOW_OUTPUT = "Show the CLI's output";
const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who the migration would run as. Sign in first.';

/**
 * Reports what the checkpoint migration would do, then, if the person
 * agrees, does it once.
 *
 * The dry run is the first and only call until the person confirms. The
 * migration is local and additive: it creates refs, never pushes, and is
 * checked afterwards by counting the checkpoint refs again.
 */
export async function migrateCheckpoints(deps: MigrationDependencies): Promise<MigrationFlowResult> {
	const { ui } = deps;
	// The login is read once, so the dry run, the question and the run all name the same one.
	const acting = await deps.acting();

	const report = await whileIdle<{ result: MigrationFlowResult; repository?: string; before?: number; dryRunFlag?: string }>(
		deps.running,
		ui,
		{ result: 'busy' },
		async later => {
			const check = await deps.depth.checkMigrate();
			if (!check.ok) {
				later(() => reportUnavailable(ui, check));
				return { result: 'unavailable' };
			}
			const dryRunFlag = check.flags.dryRun;
			if (!dryRunFlag) {
				void ui.notify('warn', 'This Entire CLI does not describe a dry run of `doctor migrate-checkpoints`, so the migration is not offered. Update the CLI.');
				return { result: 'unavailable' };
			}
			const before = await deps.migration.countRefs();
			const read = await ui.withProgress('Reading the migration report…', signal => deps.migration.dryRun(dryRunFlag, acting, signal));
			switch (read.kind) {
				case 'cancelled':
					void ui.notify('info', 'The migration report was cancelled. Nothing was written.');
					return { result: 'cancelled' };
				case 'failed':
					void ui.notify('warn', `The migration report could not be read: ${read.detail}. Nothing was written.`);
					return { result: 'failed' };
				case 'empty':
					void ui.notify('info', 'The CLI printed no report, so there is nothing to confirm. Nothing was written.');
					return { result: 'reported' };
				case 'report':
					await presentOutput({ ui, files: deps.files, settings: deps.settings }, 'dry-run', read.text, read.truncated);
					return { result: 'reported', repository: check.repository, before, dryRunFlag };
			}
		},
	);
	if (report.dryRunFlag === undefined) {
		return report.result;
	}

	const choice = await ui.notify(
		'info',
		'The dry run is open. Migrating is idempotent: checkpoints already converted are skipped.',
		[MIGRATE, CLOSE],
	);
	if (choice !== MIGRATE) {
		return 'reported';
	}

	let shownOutput: string | undefined;
	const applied = await whileIdle<MigrationFlowResult>(deps.running, ui, 'busy', async later => {
		if (!acting) {
			void ui.notify('warn', NO_LOGIN);
			return 'no-login';
		}
		const repository = report.repository ?? deps.workspaceName() ?? 'this repository';
		if (!(await ui.confirm(confirmMigration(repository, acting, report.before)))) {
			return 'declined';
		}

		// Counted again here, so refs another process made while the question was open are not taken as ours.
		const before = await deps.migration.countRefs();
		const { outcome, output } = await ui.withProgress(`Creating checkpoint refs as ${acting.handle}…`, signal =>
			deps.migration.apply(acting, before, signal),
		);
		shownOutput = output.trim().length > 0 ? output : undefined;
		const message = describeMigrationOutcome(outcome);
		const actions = shownOutput ? [SHOW_OUTPUT] : [];
		later(async () => {
			const picked = await ui.notify(outcome.kind === 'migrated' || outcome.kind === 'unchanged' ? 'info' : 'warn', message, actions);
			if (picked === SHOW_OUTPUT && shownOutput !== undefined) {
				await presentOutput({ ui, files: deps.files, settings: deps.settings }, 'migration', shownOutput, false);
			}
		});
		return outcome.kind;
	});
	return applied;
}
