import { decodeArray, decodeRecord, type DecodeResult } from './decode';

/**
 * What the control plane lists: organisations, projects, repositories,
 * the people who hold access to them, and the clusters they live on.
 *
 * Every reader here is tolerant. The CLI sends a few dozen fields per row
 * and the extension needs a handful, so a row without a name is skipped
 * and a field of an unexpected kind reads as absent. One odd row must not
 * hide the rest of the list.
 */

/** An organisation the login can see. */
export interface Organisation {
	readonly id: string;
	readonly name: string;
	readonly region?: string;
	/** False when the CLI says this login may not delete the organisation. */
	readonly canDelete?: boolean;
	readonly canManageMembers?: boolean;
}

/** A project, the unit that owns repositories. */
export interface Project {
	readonly id: string;
	readonly name: string;
	readonly ownerName?: string;
	readonly ownerType?: string;
	readonly region?: string;
	readonly repositoryCount?: number;
	readonly canDelete?: boolean;
	readonly canManageAccess?: boolean;
	readonly canCreateRepository?: boolean;
}

/** A repository inside a project. */
export interface ControlRepository {
	readonly id: string;
	readonly name: string;
	/** The project that owns it, by name. */
	readonly project: string;
	readonly provider?: string;
	readonly visibility?: string;
	readonly state?: string;
	readonly clusterSlug?: string;
	readonly canManage?: boolean;
}

/** One grant of access, on an organisation, a project or a repository. */
export interface AccessGrant {
	/** The id of the person or account the grant is for. */
	readonly granteeId?: string;
	readonly granteeName?: string;
	readonly displayName?: string;
	readonly role: string;
	/** Whether the grant is held on the object itself or inherited. */
	readonly source?: string;
	readonly granteeType?: string;
}

/** A cluster a project or repository can be placed on. */
export interface ControlCluster {
	readonly slug: string;
	readonly host?: string;
	readonly jurisdiction?: string;
	readonly isDefault?: boolean;
}

function text(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function flag(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === 'boolean' ? value : undefined;
}

function count(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function capabilities(record: Record<string, unknown>): Record<string, unknown> {
	const value = record.capabilities;
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The rows of a listing.
 *
 * A listing is an array, or an `{items}` envelope when the CLI was asked
 * for a single page.
 */
function rowsOf(value: unknown, path: string): DecodeResult<unknown[]> {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const items = (value as Record<string, unknown>).items;
		if (Array.isArray(items)) {
			return { ok: true, value: items };
		}
	}
	return decodeArray(value, path);
}

function recordsOf(value: unknown, path: string): DecodeResult<Record<string, unknown>[]> {
	const rows = rowsOf(value, path);
	if (!rows.ok) {
		return rows;
	}
	const records: Record<string, unknown>[] = [];
	for (let index = 0; index < rows.value.length; index++) {
		const record = decodeRecord(rows.value[index], `${path}[${index}]`);
		if (record.ok) {
			records.push(record.value);
		}
	}
	return { ok: true, value: records };
}

/** Reads `entire org list --json`. */
export function decodeOrganisations(value: unknown): DecodeResult<readonly Organisation[]> {
	const records = recordsOf(value, 'organisations');
	if (!records.ok) {
		return records;
	}
	const organisations: Organisation[] = [];
	for (const record of records.value) {
		const name = text(record, 'name');
		if (name === undefined) {
			continue;
		}
		const caps = capabilities(record);
		organisations.push({
			id: text(record, 'id') ?? name,
			name,
			region: text(record, 'region'),
			canDelete: flag(caps, 'canDelete'),
			canManageMembers: flag(caps, 'canManageMembers'),
		});
	}
	return { ok: true, value: organisations };
}

/** Reads `entire project list --json`. */
export function decodeProjects(value: unknown): DecodeResult<readonly Project[]> {
	const records = recordsOf(value, 'projects');
	if (!records.ok) {
		return records;
	}
	const projects: Project[] = [];
	for (const record of records.value) {
		const name = text(record, 'name');
		if (name === undefined) {
			continue;
		}
		const caps = capabilities(record);
		projects.push({
			id: text(record, 'id') ?? name,
			name,
			ownerName: text(record, 'ownerName'),
			ownerType: text(record, 'ownerType'),
			region: text(record, 'region'),
			repositoryCount: count(record, 'repositoryCount'),
			canDelete: flag(caps, 'canDelete'),
			canManageAccess: flag(caps, 'canManageAccess'),
			canCreateRepository: flag(caps, 'canCreateRepository'),
		});
	}
	return { ok: true, value: projects };
}

/**
 * Reads `entire repo list --project NAME --json`.
 *
 * A row does not say which project it is in, so the caller supplies the
 * project it asked about.
 */
export function decodeControlRepositories(value: unknown, project: string): DecodeResult<readonly ControlRepository[]> {
	const records = recordsOf(value, 'repositories');
	if (!records.ok) {
		return records;
	}
	const repositories: ControlRepository[] = [];
	for (const record of records.value) {
		const name = text(record, 'name');
		if (name === undefined) {
			continue;
		}
		repositories.push({
			id: text(record, 'id') ?? name,
			name,
			project,
			provider: text(record, 'provider'),
			visibility: text(record, 'visibility'),
			state: text(record, 'state'),
			clusterSlug: text(record, 'clusterSlug'),
			canManage: flag(capabilities(record), 'canManage'),
		});
	}
	return { ok: true, value: repositories };
}

/** Reads `entire <scope> grant list --json`. */
export function decodeAccessGrants(value: unknown): DecodeResult<readonly AccessGrant[]> {
	const records = recordsOf(value, 'grants');
	if (!records.ok) {
		return records;
	}
	const grants: AccessGrant[] = [];
	for (const record of records.value) {
		const role = text(record, 'role');
		const granteeId = text(record, 'granteeId');
		const granteeName = text(record, 'granteeName');
		if (role === undefined || (granteeId === undefined && granteeName === undefined)) {
			continue;
		}
		grants.push({
			granteeId,
			granteeName,
			displayName: text(record, 'displayName'),
			role,
			source: text(record, 'source'),
			granteeType: text(record, 'granteeType'),
		});
	}
	return { ok: true, value: grants };
}

/** Reads `entire cluster list --json`. */
export function decodeControlClusters(value: unknown): DecodeResult<readonly ControlCluster[]> {
	const records = recordsOf(value, 'clusters');
	if (!records.ok) {
		return records;
	}
	const clusters: ControlCluster[] = [];
	for (const record of records.value) {
		const slug = text(record, 'slug') ?? text(record, 'host');
		if (slug === undefined) {
			continue;
		}
		clusters.push({
			slug,
			host: text(record, 'host'),
			jurisdiction: text(record, 'jurisdiction'),
			isDefault: flag(record, 'isDefault'),
		});
	}
	return { ok: true, value: clusters };
}

/**
 * The path the CLI addresses an Entire-native repository by.
 *
 * Only a native repository has one; a mirror of a GitHub repository is
 * addressed another way, and the CLI's delete and edit commands refuse it,
 * so no path is offered for it.
 */
export function repositoryPath(repository: Pick<ControlRepository, 'project' | 'name' | 'provider'>): string | undefined {
	if (repository.provider !== undefined && repository.provider !== 'entire') {
		return undefined;
	}
	return `/et/${repository.project}/${repository.name}`;
}

/** Drops the `provider:` prefix of a handle and lower-cases it, for comparing. */
function bareHandle(value: string): string {
	const colon = value.indexOf(':');
	return (colon >= 0 ? value.slice(colon + 1) : value).toLowerCase();
}

/**
 * Whether a grant is for the person a handle such as `github:alice` names.
 *
 * The CLI sends an id for every grant and a name only when one resolved,
 * and the shape of either was not observed for every kind of grant, so
 * the handle is compared on its own without the provider.
 */
export function grantIsFor(grant: AccessGrant, handle: string): boolean {
	const wanted = bareHandle(handle);
	return [grant.granteeName, grant.granteeId, grant.displayName].some(
		candidate => candidate !== undefined && bareHandle(candidate) === wanted,
	);
}

/** The provider-qualified handle a grant can be revoked by, when the CLI gave one. */
export function grantHandle(grant: AccessGrant): string | undefined {
	return [grant.granteeName, grant.granteeId].find(candidate => candidate !== undefined && isGrantee(candidate));
}

/** What a grant is called on screen. */
export function nameGrant(grant: AccessGrant): string {
	return grant.displayName ?? grant.granteeName ?? grant.granteeId ?? 'unknown';
}

const GRANTEE = /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Whether a string is a provider-qualified handle such as `github:alice`. */
export function isGrantee(value: string): boolean {
	return GRANTEE.test(value);
}

const OPERAND = /^[^\s\u0000-\u001f-][^\s\u0000-\u001f]{0,199}$/;

/** Whether a name, ULID or path can be handed to the CLI as an operand without being read as a flag. */
export function isControlOperand(value: string): boolean {
	return OPERAND.test(value);
}

const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Whether a string can be the name of a repository to create. */
export function isRepositoryName(value: string): boolean {
	return REPOSITORY_NAME.test(value);
}

/** The most an API path may be, which is far more than any real one. */
const MAX_API_PATH = 2000;

/**
 * Whether a string is a path on an Entire API host.
 *
 * The CLI picks the host, so the extension only ever passes a path: it
 * starts with a slash, has no whitespace or control characters, and is
 * not a URL that would name a host of someone's choosing. A backslash
 * and a `.` or `..` segment, also percent-encoded, are refused because
 * they can walk out of the API's path.
 */
export function isApiPath(value: string): boolean {
	if (!value.startsWith('/') || value.startsWith('//') || value.length > MAX_API_PATH || /[\s\u0000-\u001f\\]/.test(value)) {
		return false;
	}
	const path = value.split(/[?#]/, 1)[0];
	return !path.split('/').some(segment => /^(\.|%2e){1,2}$/i.test(segment));
}
