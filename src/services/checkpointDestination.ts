import {
	canSeeRepo,
	decodeRepoIdentity,
	decodeVisibleRepos,
	describeDestination,
	isInvisibleToLogin,
	oneLine,
	parseForgeRef,
	resolveCheckpointDestination,
	unwrap,
	type CheckpointDestination,
	type ForgeRef,
	type RepoIdentity,
	type VisibleRepo,
} from '../lib/entire';
import type { EntireSettings, WorkspaceStatus } from '../lib/entire';
import type { CliRunner } from './cli';

/**
 * What the extension found out about where checkpoints are going.
 *
 * The findings are facts about the workspace, and the remedy is a
 * suggestion the user may take or leave. Keeping them apart means the
 * report can say what is true without arguing for what to do about it.
 */
export interface CheckpointDestinationReport {
	/** Where checkpoints are going. */
	readonly destination: CheckpointDestination;
	/**
	 * The repository the workspace itself is on, when the CLI could name
	 * one. This is the repository the user may be migrating to or from.
	 */
	readonly workspaceRepo?: RepoIdentity;
	/**
	 * Whether the login can see the checkpoint repository.
	 *
	 * Absent when the question does not apply, or when the CLI could not
	 * answer it.
	 */
	readonly checkpointRepoVisible?: boolean;
	/**
	 * Whether the acting login can see where the checkpoints are going.
	 *
	 * This is the question a workspace that looks untracked actually
	 * turns on: the checkpoints are on the server, but the login the
	 * extension is acting as cannot reach them. Absent when the question
	 * does not apply — the checkpoints stay on this machine, or where they
	 * go is not known — or when the CLI could not answer it.
	 */
	readonly visible?: boolean;
	/** Why the checkpoint repository cannot be reached, when it cannot be. */
	readonly problem?: string;
	/** What could be done about it. */
	readonly remedy?: string;
	/** The command that would show the repositories Entire can reach. */
	readonly remedyCommand?: readonly string[];
}

/**
 * The repository the checkpoints are going to, as a forge reference.
 *
 * A checkpoint repository is named `owner/repo` in the settings and has no
 * forge of its own, so the provider decides which forge it is on. Without
 * one there is nothing to look up, which is why the provider is read from
 * the settings rather than guessed at.
 */
function checkpointRepoRef(destination: CheckpointDestination): ForgeRef | undefined {
	if (destination.kind !== 'dedicated') {
		return undefined;
	}

	const provider = destination.provider;
	if (!provider) {
		return undefined;
	}

	return parseForgeRef(`/${provider === 'github' ? 'gh' : 'gl'}/${destination.repo}`);
}

/**
 * The report as it is built.
 *
 * The facts are gathered one at a time, so the report is written as it is
 * found and frozen when it is returned.
 */
interface MutableReport {
	destination: CheckpointDestination;
	workspaceRepo?: RepoIdentity;
	checkpointRepoVisible?: boolean;
	visible?: boolean;
	problem?: string;
	remedy?: string;
	remedyCommand?: readonly string[];
}

/**
 * Reads where checkpoints are going, and whether Entire can reach them.
 *
 * Everything here is a fact the CLI reported. Nothing is assumed about
 * what the user wants, and nothing is decided on their behalf: the report
 * is a description, and the remedy is a suggestion.
 */
export async function inspectCheckpointDestination(
	runner: CliRunner,
	cwd: string | undefined,
	status: WorkspaceStatus,
	settings: EntireSettings,
): Promise<CheckpointDestinationReport> {
	const destination = resolveCheckpointDestination(status, settings);

	if (!destination) {
		const reason = 'Entire is not tracking this workspace, so there is nowhere for checkpoints to go.';
		return {
			destination: { kind: 'unknown', reason },
			problem: reason,
		};
	}

	const ref = checkpointRepoRef(destination);

	// The workspace's own repository and the list of repositories the
	// login can reach do not depend on each other, so they are asked for
	// at the same time rather than one after the other.
	const [workspace, visible] = await Promise.all([
		readWorkspaceRepo(runner, cwd),
		ref ? readVisibleRepos(runner, cwd, ref) : Promise.resolve(undefined),
	]);

	const workspaceRepo = workspace.ok ? workspace.repo : undefined;

	const report: MutableReport = { destination, workspaceRepo };

	if (destination.kind === 'unknown') {
		report.problem = destination.reason;
		report.remedy =
			'Update the Entire CLI or Entirely to a version that reports where checkpoints are going. The doctor report says which CLI is installed.';
		return report;
	}

	if (destination.kind === 'local-only') {
		report.problem =
			'Checkpoints are kept on this machine only, so they are not on Entire and cannot be seen in the dashboard.';
		report.remedy =
			'Set `push_sessions` back to `true` in .entire/settings.local.json to turn pushing back on. The CLI has no flag that clears it.';
		return report;
	}

	if (destination.kind === 'same-repo') {
		// The checkpoints are on the workspace's own repository, so
		// whether the login can see that repository is whether the
		// checkpoints can be seen.
		if (!workspace.ok) {
			report.visible = workspace.invisible ? false : undefined;
		} else {
			report.visible = true;
		}

		// Checkpoints that go to this repository are on the forge that
		// hosts it, so the forge is the workspace's own.
		if (workspaceRepo && workspaceRepo.ref.forge === 'entire') {
			report.remedy =
				'This repository is hosted on Entire, so checkpoints reach Entire through the same remote as your code.';
		} else {
			report.problem = `Checkpoints are uploaded to the \`${destination.remote}\` remote. Entire can only read them from a repository the Entire GitHub App can access.`;
			report.remedy = `If this repository is mirrored on Entire, \`entire enable --yes --checkpoint-push-remote entire\` sends the checkpoints through the Entire remote instead.`;
		}
		return report;
	}

	if (!ref) {
		report.problem = `Checkpoints are uploaded to ${destination.repo}, but the settings do not say which provider it is on.`;
		return report;
	}

	if (!visible) {
		report.problem = `Checkpoints are uploaded to ${destination.repo}, but the Entire CLI could not be asked which repositories it can reach.`;
		return report;
	}

	if (!visible.ok) {
		report.problem = `Checkpoints are uploaded to ${destination.repo}, and the Entire CLI could not say whether it can reach it: ${visible.detail}`;
		return report;
	}

	report.checkpointRepoVisible = canSeeRepo(visible.value, ref);
	report.visible = report.checkpointRepoVisible;

	if (report.checkpointRepoVisible) {
		return report;
	}

	report.problem = `Entire cannot reach ${destination.repo}: the Entire GitHub App does not have access to it, so the checkpoints it holds are never read and the dashboard stays empty.`;
	report.remedy = `Grant the Entire GitHub App access to ${destination.repo}, then push to send the checkpoints.`;
	report.remedyCommand = ['repo', 'mirror', 'list', '--forge', 'gh', '--available', '--json'];

	return report;
}

/**
 * Writes the report out, for the channel and for a bug report.
 *
 * Every value here came from the CLI or from the repository's own
 * settings, so each one is put on a single line and cannot pretend to be
 * a line of its own.
 */
export function renderCheckpointDestination(report: CheckpointDestinationReport): string {
	const lines: string[] = [];

	lines.push('### Checkpoint destination');
	lines.push('');
	lines.push(`- Destination: ${describeDestination(report.destination)}`);

	if (report.destination.kind === 'dedicated') {
		lines.push(`- Provider: ${report.destination.provider ?? '(not set)'}`);
	}

	if (report.workspaceRepo) {
		lines.push(`- This repository: ${report.workspaceRepo.ref.path}`);
	}

	if (report.checkpointRepoVisible !== undefined) {
		lines.push(`- Entire can reach it: ${report.checkpointRepoVisible ? 'yes' : 'no'}`);
	}

	if (report.problem) {
		lines.push('');
		lines.push(oneLine(report.problem));
	}

	if (report.remedy) {
		lines.push('');
		lines.push(oneLine(report.remedy));
	}

	return lines.join('\n');
}

/**
 * What reading the workspace's own repository found.
 *
 * The distinction that matters is between a repository the login cannot
 * see and a repository the CLI could not name: the first is a fact about
 * the account, and the second is only a fact about the command.
 */
type WorkspaceRepoReading =
	| { readonly ok: true; readonly repo: RepoIdentity }
	| { readonly ok: false; readonly detail: string; readonly invisible: boolean };

/**
 * Reads the repository the workspace is on.
 *
 * The CLI resolves it from the clone's own remote, so it follows the
 * repository across a move between forges without the extension having to
 * know that it happened.
 */
async function readWorkspaceRepo(
	runner: CliRunner,
	cwd: string | undefined,
): Promise<WorkspaceRepoReading> {
	const result = await runner.runJson(
		['repo', 'view', '--json'],
		value => unwrap(decodeRepoIdentity(value)),
		{ cwd },
	);

	if (!result.ok) {
		return {
			ok: false,
			detail: result.detail,
			invisible: isInvisibleToLogin(result.stderr),
		};
	}

	return { ok: true, repo: result.value };
}

/**
 * Reads the repositories the login can see on a forge.
 *
 * The CLI's list is what the GitHub App can reach, which is the only
 * thing that decides whether Entire can read a repository. The list is
 * filtered by name first, because a large account has a lot of them.
 */
async function readVisibleRepos(
	runner: CliRunner,
	cwd: string | undefined,
	ref: ForgeRef,
): Promise<{ ok: true; value: readonly VisibleRepo[] } | { ok: false; detail: string }> {
	const name = `${ref.namespace}/${ref.name}`;

	const result = await runner.runJson(
		['repo', 'mirror', 'list', '--forge', ref.forge === 'entire' ? 'et' : 'gh', '--name', name, '--json'],
		value => unwrap(decodeVisibleRepos(value)),
		{ cwd },
	);

	if (!result.ok) {
		return { ok: false, detail: result.detail };
	}

	return { ok: true, value: result.value };
}
