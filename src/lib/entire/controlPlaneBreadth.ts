import { decodeArray, decodeRecord, type DecodeResult } from './decode';
import { decodeOrganisations, decodeProjects, repositoryPath, type ControlRepository, type Organisation, type Project } from './controlPlane';
import { END_OF_OPTIONS } from './operand';
import type { FlagWant } from './controlPlaneFlags';

/**
 * The control plane's breadth: the commands that read one organisation,
 * one project, one repository's visibility and protection, and one
 * organisation's invitations, and the commands that create an
 * organisation or a project, invite somebody, place and remove a
 * repository's mirrors, and set and lift a repository's protection.
 *
 * Every flag here is found by what the CLI's help says about it, and only
 * a flag the help lists can be sent. A CLI that renames one is followed;
 * a CLI that drops a required one is reported rather than sent a flag it
 * would refuse.
 */

/** A repository's visibility, as the CLI reports it. */
export interface RepoVisibility {
	/** The repository the answer is about, in the form the CLI used. */
	readonly repo?: string;
	/** `public` or `private`, when the CLI says which. */
	readonly visibility?: string;
}

/**
 * One protection rule.
 *
 * The CLI's shape for a rule is not known, so the fields it might use are
 * optional and the rule as the CLI sent it is kept for showing.
 */
export interface ProtectionRule {
	readonly id?: string;
	readonly kind?: string;
	readonly level?: string;
	/** The rule as the CLI sent it, as JSON. */
	readonly raw: string;
}

/**
 * One invitation.
 *
 * As with a protection rule, the shape is not known, so the fields it
 * might use are optional and the invitation as the CLI sent it is kept.
 */
export interface Invitation {
	readonly id?: string;
	readonly email?: string;
	readonly role?: string;
	readonly status?: string;
	/** The invitation as the CLI sent it, as JSON. */
	readonly raw: string;
}

/** One mirror placement: a repository, and the cluster it is copied on. */
export interface MirrorPlacement {
	/** The repository, in the form the CLI used. */
	readonly repo: string;
	/** The cluster's public host. */
	readonly cluster?: string;
	readonly clusterSlug?: string;
	readonly status?: string;
	readonly cloneUrl?: string;
}

function text(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads `entire org get --json`, which sends one organisation. */
export function decodeOrganisationDetail(value: unknown): DecodeResult<Organisation> {
	const record = decodeRecord(value, 'organisation');
	if (!record.ok) {
		return record;
	}
	const decoded = decodeOrganisations([record.value]);
	if (!decoded.ok) {
		return decoded;
	}
	const organisation = decoded.value[0];
	return organisation === undefined
		? { ok: false, issue: { kind: 'missing', path: 'organisation.name', detail: 'the organisation has no name' } }
		: { ok: true, value: organisation };
}

/** Reads `entire project get --json`, which sends one project. */
export function decodeProjectDetail(value: unknown): DecodeResult<Project> {
	const record = decodeRecord(value, 'project');
	if (!record.ok) {
		return record;
	}
	const decoded = decodeProjects([record.value]);
	if (!decoded.ok) {
		return decoded;
	}
	const project = decoded.value[0];
	return project === undefined
		? { ok: false, issue: { kind: 'missing', path: 'project.name', detail: 'the project has no name' } }
		: { ok: true, value: project };
}

/** Reads `entire repo visibility get --json`. */
export function decodeRepoVisibility(value: unknown): DecodeResult<RepoVisibility> {
	const record = decodeRecord(value, 'visibility');
	if (!record.ok) {
		return record;
	}
	return { ok: true, value: { repo: text(record.value, 'repo'), visibility: text(record.value, 'visibility') } };
}

/** Reads `entire repo protection list --json`. */
export function decodeProtectionRules(value: unknown): DecodeResult<readonly ProtectionRule[]> {
	const rows = decodeArray(value, 'protection');
	if (!rows.ok) {
		return rows;
	}
	const rules: ProtectionRule[] = [];
	for (let index = 0; index < rows.value.length; index++) {
		const record = decodeRecord(rows.value[index], `protection[${index}]`);
		if (!record.ok) {
			continue;
		}
		rules.push({
			id: text(record.value, 'id'),
			kind: text(record.value, 'kind') ?? text(record.value, 'type'),
			level: text(record.value, 'level') ?? text(record.value, 'rule'),
			raw: JSON.stringify(record.value),
		});
	}
	return { ok: true, value: rules };
}

/** Reads `entire org invite list --json`. */
export function decodeInvitations(value: unknown): DecodeResult<readonly Invitation[]> {
	const rows = decodeArray(value, 'invitations');
	if (!rows.ok) {
		return rows;
	}
	const invitations: Invitation[] = [];
	for (let index = 0; index < rows.value.length; index++) {
		const record = decodeRecord(rows.value[index], `invitations[${index}]`);
		if (!record.ok) {
			continue;
		}
		invitations.push({
			id: text(record.value, 'id'),
			email: text(record.value, 'email'),
			role: text(record.value, 'role'),
			status: text(record.value, 'status'),
			raw: JSON.stringify(record.value),
		});
	}
	return { ok: true, value: invitations };
}

/**
 * Reads `entire repo mirror list --json`.
 *
 * The CLI sends one repository with its placements; this reads one row
 * per placement, so a repository that is on two clusters is two rows.
 */
export function decodeMirrors(value: unknown): DecodeResult<readonly MirrorPlacement[]> {
	const rows = decodeArray(value, 'mirrors');
	if (!rows.ok) {
		return rows;
	}
	const placements: MirrorPlacement[] = [];
	for (let index = 0; index < rows.value.length; index++) {
		const record = decodeRecord(rows.value[index], `mirrors[${index}]`);
		if (!record.ok) {
			continue;
		}
		const repo = text(record.value, 'repo');
		if (repo === undefined) {
			continue;
		}
		const listed = record.value.placements;
		const entries = Array.isArray(listed) ? listed : [];
		if (entries.length === 0) {
			placements.push({ repo, status: text(record.value, 'status') });
			continue;
		}
		for (let position = 0; position < entries.length; position++) {
			const placement = decodeRecord(entries[position], `mirrors[${index}].placements[${position}]`);
			if (!placement.ok) {
				continue;
			}
			placements.push({
				repo,
				cluster: text(placement.value, 'cluster'),
				clusterSlug: text(placement.value, 'clusterSlug'),
				status: text(placement.value, 'status'),
				cloneUrl: text(placement.value, 'cloneUrl'),
			});
		}
	}
	return { ok: true, value: placements };
}

/** The flags of `entire org get`. */
export const ORG_GET_WANTS = { json: { name: /json/i, description: /\bjson\b/i, required: true } } as const;

/** The flags of `entire org create`. */
export const ORG_CREATE_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	region: { name: /region/i, description: /jurisdiction/i },
} as const;

/** The flags of `entire org invite list`. */
export const ORG_INVITE_LIST_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	status: { name: /status/i, description: /lifecycle state/i },
} as const;

/** The flags of `entire org invite send`. */
export const ORG_INVITE_SEND_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i },
	email: { name: /email/i, description: /email address/i, required: true },
	role: { name: /role/i, description: /role the invitation grants/i },
} as const;

/** The flags of `entire org invite revoke`. */
export const ORG_INVITE_REVOKE_WANTS = {
	email: { name: /email/i, description: /email address/i, required: true },
} as const;

/** The flags of `entire project get`. */
export const PROJECT_GET_WANTS = { json: { name: /json/i, description: /\bjson\b/i, required: true } } as const;

/** The flags of `entire project create`. */
export const PROJECT_CREATE_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i },
	owner: { name: /owner/i, description: /owning org|owning account/i, required: true },
	ownerType: { name: /owner-type/i, description: /owner kind/i },
	region: { name: /region/i, description: /jurisdiction/i },
} as const;

/** The flags of `entire repo visibility get`. */
export const REPO_VISIBILITY_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
} as const;

/** The flags of the `entire repo protection` commands. */
export const REPO_PROTECTION_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i },
	serverSideMergeOnly: { name: /server-side-merge-only/i, description: /refuse every direct push/i },
} as const;

/** The flags of `entire repo mirror add` and `entire repo mirror remove`. */
export const REPO_MIRROR_PLACEMENT_WANTS = {
	cluster: { name: /cluster/i, description: /cluster host/i },
	noWait: { name: /no-wait/i, description: /without waiting|as soon as/i },
	timeout: { name: /timeout/i, description: /how long to wait/i },
} as const;

/** The flags of `entire repo mirror detach`. */
export const REPO_MIRROR_DETACH_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i },
	dryRun: { name: /dry-run/i, description: /preconditions/i },
	into: { name: /into/i, description: /native repository/i, required: true },
	noWait: { name: /no-wait/i, description: /without waiting/i },
	timeout: { name: /timeout/i, description: /how long to wait/i },
	yes: { name: /yes/i, description: /\bskip the confirmation prompt\b/i },
} as const;

/** The flags of `entire repo mirror resync`. */
export const REPO_MIRROR_RESYNC_WANTS = { json: { name: /json/i, description: /\bjson\b/i } } as const;

/** The flags of `entire repo mirror list`. */
export const REPO_MIRROR_LIST_WANTS = {
	json: { name: /json/i, description: /\bjson\b/i, required: true },
	forge: { name: /forge/i, description: /which repositories to list/i },
	name: { name: /name/i, description: /substring of the name/i },
} as const;

/** The flags of `entire repo clone`. */
export const REPO_CLONE_WANTS = {
	cluster: { name: /cluster/i, description: /cluster host/i },
	nearest: { name: /nearest/i, description: /fastest/i },
} as const;

/** The flags of `entire repo remote add`. */
export const REPO_REMOTE_ADD_WANTS = {
	cluster: { name: /cluster/i, description: /cluster host/i },
	override: { name: /override/i, description: /repoint/i },
} as const;

function withValue(flag: string, value: string): string {
	return `${flag}=${value}`;
}

/**
 * An email address, as far as one can be told.
 *
 * The CLI is the judge of what it will accept, so this only rejects what
 * cannot be an address at all: no spaces, one `@`, and something on both
 * sides of it.
 */
export function isEmailAddress(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * A folder path, relative to the workspace.
 *
 * The path may name a folder inside the workspace, or the workspace
 * itself, but it is never absolute and never climbs out of it.
 */
export function isFolderPath(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.startsWith('-') || trimmed.startsWith('/')) {
		return false;
	}
	if (/^[A-Za-z]:/.test(trimmed)) {
		return false;
	}
	return !trimmed.split(/[\/]/).includes('..');
}

/**
 * A URL with any credentials removed.
 *
 * A remote's URL is shown to the person and written into a confirmation,
 * so the part of it that carries a name and a password is taken away
 * before it is shown.
 */
export function redactUrl(url: string): string {
	return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

/**
 * The reference the CLI addresses a repository by.
 *
 * The CLI names a GitHub mirror `/gh/<owner>/<repo>` and one of Entire's
 * own `/et/<project>/<repo>`. A mirror whose listing gave no forge name
 * cannot be addressed, and says so rather than guessing one.
 */
export function repositoryReference(
	repository: Pick<ControlRepository, 'id' | 'name' | 'project' | 'provider' | 'fullName'>,
): string | undefined {
	const provider = repository.provider?.toLowerCase();
	if (provider === undefined || provider === 'entire') {
		return repositoryPath(repository) ?? `/et/${repository.project}/${repository.name}`;
	}
	const fullName = repository.fullName?.trim();
	return fullName !== undefined && fullName.length > 0 ? `/gh/${fullName}` : undefined;
}

/**
 * The forge a reference names.
 *
 * The CLI writes the forge into the reference itself, so the reference is
 * the only place the forge is read from, and a reference that names no
 * forge known here is left without one.
 */
export function forgeOf(reference: string): string | undefined {
	const trimmed = reference.trim().replace(/^\/+/, '');
	const slash = trimmed.indexOf('/');
	if (slash <= 0) {
		return undefined;
	}
	const forge = trimmed.slice(0, slash).toLowerCase();
	return forge === 'gh' || forge === 'et' ? forge : undefined;
}

/**
 * The branch a protection rule is about, as the CLI takes it.
 *
 * The CLI takes `HEAD`, a branch name, or a pattern such as `release/*`.
 * A value with a space or a leading dash would be read as something else,
 * so those are refused here.
 */
export function isProtectionBranch(value: string): boolean {
	return value.length > 0 && !value.startsWith('-') && !/\s/.test(value);
}

/**
 * The name a git remote is given.
 *
 * Git accepts more than this, but a name with a space or a leading dash
 * would be read as an option by the CLI or by git itself, so the subset
 * here is the one that is unambiguous.
 */
export function isRemoteName(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * Whether an invitation is for an address.
 *
 * The CLI's shape for an invitation is not known, so the address is looked
 * for in the field it would use, and then in the invitation as it was
 * sent, so an invitation the extension cannot read is still counted.
 */
export function invitationHolds(invitation: Invitation, email: string): boolean {
	if (invitation.email !== undefined) {
		return invitation.email.toLowerCase() === email.toLowerCase();
	}
	return invitation.raw.toLowerCase().includes(email.toLowerCase());
}

/** `entire org get --json <org>`. */
export function organisationGetArguments(json: string, name: string): readonly string[] {
	return ['org', 'get', json, END_OF_OPTIONS, name];
}

/** `entire org create <name>`, with a region when one was chosen. */
export function organisationCreateArguments(
	flags: { readonly json?: string; readonly region?: string },
	name: string,
	region: string | undefined,
): readonly string[] {
	return [
		'org',
		'create',
		...(flags.json ? [flags.json] : []),
		...(flags.region && region ? [withValue(flags.region, region)] : []),
		END_OF_OPTIONS,
		name,
	];
}

/** `entire org invite list --json <org>`, with a status when one was chosen. */
export function invitationListArguments(
	flags: { readonly json: string; readonly status?: string },
	org: string,
	status: string | undefined,
): readonly string[] {
	return [
		'org',
		'invite',
		'list',
		flags.json,
		...(flags.status && status ? [withValue(flags.status, status)] : []),
		END_OF_OPTIONS,
		org,
	];
}

/** `entire org invite send --email <email> <org>`, with a role when one was chosen. */
export function invitationSendArguments(
	flags: { readonly email: string; readonly role?: string; readonly json?: string },
	org: string,
	email: string,
	role: string | undefined,
): readonly string[] {
	return [
		'org',
		'invite',
		'send',
		...(flags.json ? [flags.json] : []),
		withValue(flags.email, email),
		...(flags.role && role ? [withValue(flags.role, role)] : []),
		END_OF_OPTIONS,
		org,
	];
}

/** `entire org invite revoke --email <email> <org>`. */
export function invitationRevokeArguments(flags: { readonly email: string }, org: string, email: string): readonly string[] {
	return ['org', 'invite', 'revoke', withValue(flags.email, email), END_OF_OPTIONS, org];
}

/** `entire project get --json <project>`. */
export function projectGetArguments(json: string, name: string): readonly string[] {
	return ['project', 'get', json, END_OF_OPTIONS, name];
}

/** `entire project create <name>`, with its owner and the kind of owner. */
export function projectCreateArguments(
	flags: { readonly owner: string; readonly ownerType?: string; readonly region?: string; readonly json?: string },
	name: string,
	owner: string,
	ownerType: string | undefined,
	region: string | undefined,
): readonly string[] {
	return [
		'project',
		'create',
		...(flags.json ? [flags.json] : []),
		withValue(flags.owner, owner),
		...(flags.ownerType && ownerType ? [withValue(flags.ownerType, ownerType)] : []),
		...(flags.region && region ? [withValue(flags.region, region)] : []),
		END_OF_OPTIONS,
		name,
	];
}

/**
 * `entire repo visibility get --json <repo>`.
 *
 * The project flag is only needed when the repository is a bare name, and
 * a bare name is never sent: the repository is named by its own
 * reference, which the CLI resolves without it.
 */
export function visibilityGetArguments(flags: { readonly json: string }, repo: string): readonly string[] {
	return ['repo', 'visibility', 'get', flags.json, END_OF_OPTIONS, repo];
}

/** `entire repo protection list <repo>`. */
export function protectionListArguments(flags: { readonly json?: string }, repo: string): readonly string[] {
	return ['repo', 'protection', 'list', ...(flags.json ? [flags.json] : []), END_OF_OPTIONS, repo];
}

/**
 * `entire repo protection add <repo> <branch>`, with the level of the rule.
 *
 * The flag takes a value: `=false` lowers an existing rule instead of
 * leaving it alone.
 */
export function protectionAddArguments(
	flags: { readonly json?: string; readonly serverSideMergeOnly?: string },
	repo: string,
	branch: string,
	serverSideMergeOnly: boolean | undefined,
): readonly string[] {
	const level =
		flags.serverSideMergeOnly && serverSideMergeOnly !== undefined
			? withValue(flags.serverSideMergeOnly, String(serverSideMergeOnly))
			: undefined;
	return [
		'repo',
		'protection',
		'add',
		...(flags.json ? [flags.json] : []),
		...(level ? [level] : []),
		END_OF_OPTIONS,
		repo,
		branch,
	];
}

/** `entire repo protection remove <repo> <branch>`. */
export function protectionRemoveArguments(flags: { readonly json?: string }, repo: string, branch: string): readonly string[] {
	return [
		'repo',
		'protection',
		'remove',
		...(flags.json ? [flags.json] : []),
		END_OF_OPTIONS,
		repo,
		branch,
	];
}

/**
 * `entire repo mirror add <repo>`, with the clusters to place it on.
 *
 * The wait flag is sent when the CLI has one, because the extension
 * would rather hear that the placement is registered than wait for the
 * whole history to be copied.
 */
export function mirrorAddArguments(
	flags: { readonly cluster?: string; readonly noWait?: string; readonly timeout?: string },
	repo: string,
	clusters: readonly string[],
): readonly string[] {
	return [
		'repo',
		'mirror',
		'add',
		...(flags.cluster && clusters.length > 0 ? [withValue(flags.cluster, clusters.join(','))] : []),
		...(flags.noWait ? [flags.noWait] : []),
		END_OF_OPTIONS,
		repo,
	];
}

/** `entire repo mirror remove <repo>`, with the clusters to take it off. */
export function mirrorRemoveArguments(
	flags: { readonly cluster?: string; readonly noWait?: string; readonly timeout?: string },
	repo: string,
	clusters: readonly string[],
): readonly string[] {
	return [
		'repo',
		'mirror',
		'remove',
		...(flags.cluster && clusters.length > 0 ? [withValue(flags.cluster, clusters.join(','))] : []),
		...(flags.noWait ? [flags.noWait] : []),
		END_OF_OPTIONS,
		repo,
	];
}

/** `entire repo mirror detach --into <path> <repo>`. */
export function mirrorDetachArguments(
	flags: {
		readonly into: string;
		readonly json?: string;
		readonly dryRun?: string;
		readonly noWait?: string;
		readonly yes?: string;
	},
	repo: string,
	into: string,
): readonly string[] {
	return [
		'repo',
		'mirror',
		'detach',
		...(flags.json ? [flags.json] : []),
		...(flags.dryRun ? [flags.dryRun] : []),
		...(flags.noWait ? [flags.noWait] : []),
		...(flags.yes ? [flags.yes] : []),
		withValue(flags.into, into),
		END_OF_OPTIONS,
		repo,
	];
}

/** `entire repo mirror resync <repo>`. */
export function mirrorResyncArguments(flags: { readonly json?: string }, repo: string): readonly string[] {
	return ['repo', 'mirror', 'resync', ...(flags.json ? [flags.json] : []), END_OF_OPTIONS, repo];
}

/**
 * `entire repo mirror list --json`, for one repository.
 *
 * The forge filter is the forge the repository's own reference names, so
 * a native repository and a mirror are each listed from their own side.
 * The name filter is the repository's reference.
 */
export function mirrorListArguments(
	flags: { readonly json: string; readonly forge?: string; readonly name?: string },
	repo: string,
	forge: string | undefined,
): readonly string[] {
	return [
		'repo',
		'mirror',
		'list',
		flags.json,
		...(flags.forge && forge ? [withValue(flags.forge, forge)] : []),
		...(flags.name ? [withValue(flags.name, repo)] : []),
		END_OF_OPTIONS,
	];
}

/** `entire repo clone <repo>`, with a target directory when one was chosen. */
export function cloneArguments(
	flags: { readonly cluster?: string; readonly nearest?: string },
	repo: string,
	target: string | undefined,
	cluster: string | undefined,
): readonly string[] {
	return [
		'repo',
		'clone',
		...(flags.cluster && cluster ? [withValue(flags.cluster, cluster)] : []),
		...(flags.nearest ? [flags.nearest] : []),
		END_OF_OPTIONS,
		repo,
		...(target ? [target] : []),
	];
}

/** `entire repo remote add <name> [repo]`, with the cluster and whether to repoint. */
export function remoteAddArguments(
	flags: { readonly cluster?: string; readonly override?: string },
	name: string,
	repo: string | undefined,
	cluster: string | undefined,
): readonly string[] {
	return [
		'repo',
		'remote',
		'add',
		...(flags.cluster && cluster ? [withValue(flags.cluster, cluster)] : []),
		...(flags.override ? [flags.override] : []),
		END_OF_OPTIONS,
		name,
		...(repo ? [repo] : []),
	];
}
