import {
	CHECKPOINT_REF_PREFIX,
	classifyMigration,
	failureDetail,
	migrateApplyArguments,
	migrateDryRunArguments,
	type AccountContext,
	type MigrationOutcome,
} from '../lib/entire';
import type { CliRunner } from './cli';
import { countRefs } from './gitRefs';

export interface CheckpointMigrationOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, the dry run may take. */
	readonly readTimeoutSeconds: () => number;
	/** How long, in seconds, the migration may take. */
	readonly applyTimeoutSeconds: () => number;
}

/** What the dry run came to. */
export type DryRunRead =
	| { readonly kind: 'report'; readonly text: string; readonly truncated: boolean }
	| { readonly kind: 'empty' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly detail: string };

/** The migration's result and what the CLI printed, which is shown only on request. */
export interface MigrationResult {
	readonly outcome: MigrationOutcome;
	readonly output: string;
}

/**
 * Runs the checkpoint migration in two steps: a dry run that writes nothing,
 * then, after the person agrees, the migration itself.
 *
 * The migration runs once, as the login that was confirmed, with no flag at
 * all, so it never names a remote and, with no terminal to answer its
 * question, never pushes. It is verified by counting the checkpoint refs
 * before and after, not by trusting what the CLI printed.
 */
export class CheckpointMigrationService {
	constructor(private readonly options: CheckpointMigrationOptions) {}

	/** How many checkpoint refs exist now, or undefined when git cannot say. */
	countRefs(): Promise<number | undefined> {
		return countRefs(this.options.workspaceRoot(), CHECKPOINT_REF_PREFIX);
	}

	async dryRun(dryRunFlag: string, signal?: AbortSignal): Promise<DryRunRead> {
		const result = await this.options.runner.run(migrateDryRunArguments(dryRunFlag), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.readTimeoutSeconds() * 1000,
			withholdBodies: true,
			signal,
		});
		if (!result.ok) {
			return result.reason === 'cancelled'
				? { kind: 'cancelled' }
				: { kind: 'failed', detail: failureDetail(result.stderr, result.stdout, result.detail) };
		}
		return result.stdout.trim().length === 0 ? { kind: 'empty' } : { kind: 'report', text: result.stdout, truncated: result.truncated === true };
	}

	/** Applies the migration once as the confirmed login. `before` is the count taken before the dry run. */
	async apply(acting: AccountContext, before: number | undefined, signal?: AbortSignal): Promise<MigrationResult> {
		const result = await this.options.runner.run(migrateApplyArguments(), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.applyTimeoutSeconds() * 1000,
			context: acting.name,
			withholdBodies: true,
			signal,
		});
		if (!result.ok) {
			const output = result.stdout + result.stderr;
			if (result.reason === 'cancelled') {
				return { outcome: { kind: 'cancelled' }, output };
			}
			const said = failureDetail(result.stderr, result.stdout, result.detail);
			const detail =
				result.reason === 'timeout'
					? `${said}; raise entirely.migrateCheckpointsTimeout if it needs longer. Some refs may already exist, and running it again is safe`
					: said;
			return { outcome: { kind: 'failed', detail }, output };
		}
		const after = await this.countRefs();
		return { outcome: classifyMigration(before, after), output: result.stdout + (result.stderr.length > 0 ? `\n${result.stderr}` : '') };
	}
}
