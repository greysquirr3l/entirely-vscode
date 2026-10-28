import {
	decodeArray,
	decodeRecord,
	fields,
	optionalBoolean,
	optionalString,
	requireString,
	type DecodeResult,
} from './decode';
import type { EntireSettings } from './settings';
import type { WorkspaceStatus } from './types';

/**
 * A forge a repository can live on.
 *
 * Entire hosts repositories of its own and mirrors GitHub ones. GitLab
 * appears only as a place to keep checkpoints, never as a repository
 * Entire mirrors.
 */
export type Forge = 'github' | 'gitlab' | 'entire';

/**
 * A repository, named the way the CLI names it.
 *
 * The CLI writes a GitHub repository as `/gh/<owner>/<repo>` and one of
 * Entire's own as `/et/<project>/<repo>`. The path is kept as the CLI
 * writes it, so that it can be handed straight back to the CLI.
 */
export interface ForgeRef {
	readonly forge: Forge;
	/** The owner on GitHub and GitLab, the project on Entire. */
	readonly namespace: string;
	/** The repository's own name. */
	readonly name: string;
	/** The reference, as the CLI writes it. */
	readonly path: string;
}

/** The prefixes the CLI writes, and the forge each of them names. */
const FORGE_PREFIXES: Readonly<Record<string, Forge>> = {
	gh: 'github',
	github: 'github',
	gl: 'gitlab',
	gitlab: 'gitlab',
	et: 'entire',
	entire: 'entire',
};

/**
 * Reads a repository reference the way the CLI writes one.
 *
 * The CLI writes the reference with a leading slash, and prints it without
 * one in the `Current repo:` line of its own help, so both are read.
 * Anything else is not a reference this extension knows how to talk about.
 */
export function parseForgeRef(value: string): ForgeRef | undefined {
	const trimmed = value.trim();
	const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
	const parts = body.split('/');

	if (parts.length !== 3) {
		return undefined;
	}

	const [prefix, namespace, name] = parts;
	if (!prefix || !namespace || !name) {
		return undefined;
	}

	const forge = FORGE_PREFIXES[prefix.toLowerCase()];
	if (!forge) {
		return undefined;
	}

	return {
		forge,
		namespace,
		name,
		path: `/${prefix.toLowerCase()}/${namespace}/${name}`,
	};
}

/** How the CLI says a checkpoint destination was chosen. */
export type CheckpointDestinationSource = 'default' | 'config' | 'dedicated' | 'unknown';

/**
 * Where checkpoints are uploaded to.
 *
 * Three destinations, and they are not interchangeable: checkpoints that
 * stay on the machine are not on the forge at all, checkpoints that go to
 * this repository are on it whatever it is hosted on, and checkpoints that
 * go to a repository of their own are on a repository the user chose.
 */
export type CheckpointDestination =
	| {
			/** Checkpoints stay on this machine. */
			readonly kind: 'local-only';
	  }
	| {
			/** Checkpoints go to the workspace's own repository. */
			readonly kind: 'same-repo';
			/** The git remote they are pushed through. */
			readonly remote: string;
			readonly source: CheckpointDestinationSource;
	  }
	| {
			/** Checkpoints go to a repository of their own. */
			readonly kind: 'dedicated';
			/** The repository, as `owner/repo`. */
			readonly repo: string;
			/**
			 * The provider the repository is on.
			 *
			 * Absent when the settings do not say, which is a reason to
			 * report the repository and not to decide what can be done
			 * about it.
			 */
			readonly provider?: 'github' | 'gitlab';
			readonly source: CheckpointDestinationSource;
	  };

/**
 * Works out where checkpoints are being uploaded.
 *
 * The CLI is the source of truth for where they are going, and the
 * settings are the source of truth for which provider a checkpoint
 * repository is on. A destination the CLI describes in a way this
 * extension does not recognise is reported as no destination at all,
 * rather than guessed at.
 */
export function resolveCheckpointDestination(
	status: WorkspaceStatus,
	settings: EntireSettings,
): CheckpointDestination | undefined {
	if (status.kind !== 'tracked') {
		return undefined;
	}

	if (status.checkpointPushDisabled) {
		return { kind: 'local-only' };
	}

	const remote = status.checkpointSyncRemote;
	if (!remote) {
		return undefined;
	}

	switch (status.checkpointSyncRemoteSource) {
		case 'dedicated':
			return {
				kind: 'dedicated',
				repo: remote,
				provider: settings.checkpointRemote?.provider,
				source: 'dedicated',
			};
		case 'default':
		case 'config':
			return { kind: 'same-repo', remote, source: status.checkpointSyncRemoteSource };
		default:
			return undefined;
	}
}

/**
 * Describes where checkpoints are going, in one line.
 *
 * The line is what the user would say about it, so that it reads the same
 * way as the CLI's own words.
 */
export function describeDestination(destination: CheckpointDestination): string {
	switch (destination.kind) {
		case 'local-only':
			return 'this machine only';
		case 'same-repo':
			return `the \`${destination.remote}\` remote of this repository`;
		case 'dedicated':
			return `the dedicated checkpoint repository ${destination.repo}`;
	}
}

/**
 * The repository the CLI resolved for a workspace.
 *
 * The CLI names a repository the same way for a mirror and for one of its
 * own, in a `repo` field, and adds fields to that payload that say how
 * private it is.
 */
export interface RepoIdentity {
	readonly ref: ForgeRef;
	/** Whether the repository is private, when the CLI said. */
	readonly private?: boolean;
	/** The visibility, when the CLI said. */
	readonly visibility?: string;
}

/**
 * Reads the repository the CLI resolved.
 *
 * The CLI answers with a different payload for a mirror than for a
 * repository of its own, but both name the repository the same way, so
 * that is what is read here.
 */
export function decodeRepoIdentity(value: unknown): DecodeResult<RepoIdentity> {
	const record = decodeRecord(value, 'repo');
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, 'repo');

	const repo = requireString(read, 'repo');
	if (!repo.ok) {
		return repo;
	}

	const ref = parseForgeRef(repo.value);
	if (!ref) {
		return {
			ok: false,
			issue: {
				kind: 'wrong-type',
				path: 'repo.repo',
				detail: `expected a forge-qualified repository reference, got "${repo.value}"`,
			},
		};
	}

	const visibility = optionalString(read, 'visibility');
	if (!visibility.ok) {
		return visibility;
	}

	return {
		ok: true,
		value: {
			ref,
			private: optionalBoolean(read, 'private'),
			visibility: visibility.value,
		},
	};
}

/**
 * A repository the CLI can see from this login.
 *
 * The CLI lists both the repositories it has mirrored and the ones it
 * could mirror. Either way the login can see them, which is what decides
 * whether Entire can read them.
 */
export interface VisibleRepo {
	readonly ref: ForgeRef;
	/** The state the CLI words it with, such as `ready` or `available`. */
	readonly status?: string;
	/** The access the login has, for a repository it could mirror. */
	readonly access?: string;
}

/**
 * Reads the repositories the CLI can see.
 *
 * A row that cannot be read is left out rather than failing the whole
 * list: one repository the CLI has added a field to must not hide every
 * other one.
 */
export function decodeVisibleRepos(value: unknown): DecodeResult<readonly VisibleRepo[]> {
	const rows = decodeArray(value, 'repos');
	if (!rows.ok) {
		return rows;
	}

	const repos: VisibleRepo[] = [];

	for (let index = 0; index < rows.value.length; index++) {
		const path = `repos[${index}]`;
		const record = decodeRecord(rows.value[index], path);
		if (!record.ok) {
			return record;
		}

		const read = fields(record.value, path);

		const repo = requireString(read, 'repo');
		if (!repo.ok) {
			return repo;
		}

		const ref = parseForgeRef(repo.value);
		if (!ref) {
			continue;
		}

		const status = optionalString(read, 'status');
		if (!status.ok) {
			return status;
		}

		const access = optionalString(read, 'access');
		if (!access.ok) {
			return access;
		}

		repos.push({ ref, status: status.value, access: access.value });
	}

	return { ok: true, value: repos };
}

/**
 * Whether the CLI can see a repository.
 *
 * The comparison ignores case, because the CLI does not promise to write
 * an owner the way the user typed it.
 */
export function canSeeRepo(repos: readonly VisibleRepo[], ref: ForgeRef): boolean {
	const wanted = ref.path.toLowerCase();

	return repos.some(candidate => candidate.ref.path.toLowerCase() === wanted);
}
