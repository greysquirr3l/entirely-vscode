import * as vscode from 'vscode';

import {
	forgeOf,
	isGithubSourced,
	nameGrant,
	repositoryPath,
	repositoryReference,
	type AccessGrant,
	type ControlCluster,
	type ControlRepository,
	type GrantScope,
	type Invitation,
	type MirrorPlacement,
	type Organisation,
	type ProtectionRule,
	type Project,
} from '../lib/entire';
import type { ControlPlaneSource, Read } from '../services/controlPlane';

export type ControlNode =
	| { readonly kind: 'acting'; readonly text: string }
	| { readonly kind: 'group'; readonly group: 'projects' | 'organisations' | 'clusters' }
	| { readonly kind: 'project'; readonly project: Project }
	| { readonly kind: 'repository'; readonly repository: ControlRepository }
	| { readonly kind: 'organisation'; readonly organisation: Organisation }
	| { readonly kind: 'access'; readonly scope: GrantScope; readonly target: string; readonly label: string }
	| { readonly kind: 'grant'; readonly scope: GrantScope; readonly target: string; readonly label: string; readonly grant: AccessGrant }
	| { readonly kind: 'cluster'; readonly cluster: ControlCluster }
	| { readonly kind: 'detail'; readonly label: string; readonly value: string }
	| { readonly kind: 'invitation'; readonly invitation: Invitation }
	| { readonly kind: 'protection'; readonly rule: ProtectionRule }
	| { readonly kind: 'placement'; readonly placement: MirrorPlacement }
	| { readonly kind: 'message'; readonly text: string };

const GROUP_LABELS = { projects: 'Projects', organisations: 'Organisations', clusters: 'Clusters' } as const;

/** What the view shows when it has not been opened as a login yet. */
const NO_LOGIN = 'No Entire login is available. Sign in to see projects and repositories.';

/**
 * The Control Plane view: the projects, repositories, organisations,
 * grants and clusters the acting login can see.
 *
 * Nothing here polls. Every level is read from the CLI when it is opened
 * and again on refresh, because each read is a request to the Entire
 * servers. A level that cannot be read is replaced by a line that says why,
 * never by an empty list that would read as "nothing there".
 */
export class ControlPlaneProvider implements vscode.TreeDataProvider<ControlNode> {
	private readonly changed = new vscode.EventEmitter<ControlNode | undefined>();

	readonly onDidChangeTreeData: vscode.Event<ControlNode | undefined> = this.changed.event;

	/**
	 * @param source where the control plane is read
	 * @param acting says who the view is shown as, or nothing when there is no login
	 */
	constructor(
		private readonly source: ControlPlaneSource,
		private readonly acting: () => string | undefined,
	) {}

	/** Reads every open level again. */
	refresh(): void {
		this.changed.fire(undefined);
	}

	async getChildren(node?: ControlNode): Promise<ControlNode[]> {
		if (!node) {
			const acting = this.acting();
			if (acting === undefined) {
				return [{ kind: 'message', text: NO_LOGIN }];
			}
			return [
				{ kind: 'acting', text: `Acting as ${acting}` },
				{ kind: 'group', group: 'projects' },
				{ kind: 'group', group: 'organisations' },
				{ kind: 'group', group: 'clusters' },
			];
		}

		switch (node.kind) {
			case 'group':
				return this.groupChildren(node.group);

			case 'project': {
				const detail = await this.source.project(node.project.id);
				const repositories = await this.source.repositories(node.project);
				const nodes = asNodes(repositories, 'repositories', list =>
					list.map((repository): ControlNode => ({ kind: 'repository', repository })),
				);
				return [
					...detailNodes(detail, project => [
						['Identifier', project.id],
						['Owner', project.ownerName],
						['Owner kind', project.ownerType],
						['Region', project.region],
					]),
					...nodes,
					// The access of a project of mirrors is GitHub's, and is read
					// there rather than changed here.
					...(isGithubSourced(node.project)
						? [
								{
									kind: 'message' as const,
									text:
										'The access of this project is a read-only projection of what GitHub grants. ' +
										'Give and take access on GitHub.',
								},
							]
						: [
								{
									kind: 'access' as const,
									scope: 'project' as const,
									target: node.project.id,
									label: node.project.name,
								},
							]),
				];
			}

			case 'repository': {
				const path = repositoryPath(node.repository);
				const reference = repositoryReference(node.repository);
				if (path === undefined || reference === undefined) {
					return [{ kind: 'message', text: 'This repository has no address on Entire, so nothing more can be read for it.' }];
				}
				// The CLI reads these two by the repository's ULID: it refuses a
				// `/gh/` reference for them and asks for the id instead.
				const detail = await this.source.visibility(node.repository.id);
				const protection = await this.source.protection(node.repository.id);
				const mirrors = await this.source.mirrors(reference);
				const github = forgeOf(reference) === 'gh';
				return [
					...visibilityNodes(detail, github),
					...protectionNodes(protection, github),
					...placementNodes(mirrors),
					...(await this.grantNodes('repo', path, path)),
				];
			}

			case 'organisation': {
				const detail = await this.source.organisation(node.organisation.name);
				const invitations = await this.source.invitations(node.organisation.name);
				return [
					...detailNodes(detail, organisation => [
						['Identifier', organisation.id],
						['Region', organisation.region],
					]),
					...invitationNodes(invitations),
					...(await this.grantNodes('org', node.organisation.name, node.organisation.name)),
				];
			}

			case 'access':
				return this.grantNodes(node.scope, node.target, node.label);

			default:
				return [];
		}
	}

	private async groupChildren(group: 'projects' | 'organisations' | 'clusters'): Promise<ControlNode[]> {
		switch (group) {
			case 'projects':
				return asNodes(await this.source.projects(), 'projects', list =>
					list.map((project): ControlNode => ({ kind: 'project', project })),
				);
			case 'organisations': {
				const read = await this.source.organisations();
				if (!read.ok) {
					return [{ kind: 'message', text: `Could not read the organisations: ${read.detail}.` }];
				}
				if (read.value.length === 0) {
					return [
						{
							kind: 'message',
							text:
								'This login sees no organisations. A personal account has no account-wide membership, so an organisation is how a team gets a home on Entire.',
						},
					];
				}
				return read.value.map((organisation): ControlNode => ({ kind: 'organisation', organisation }));
			}
			case 'clusters':
				return asNodes(await this.source.clusters(), 'clusters', list =>
					list.map((cluster): ControlNode => ({ kind: 'cluster', cluster })),
				);
		}
	}

	private async grantNodes(scope: GrantScope, target: string, label: string): Promise<ControlNode[]> {
		return asNodes(await this.source.grants(scope, target, label), 'grants', list =>
			list.map((grant): ControlNode => ({ kind: 'grant', scope, target, label, grant })),
		);
	}

	getTreeItem(node: ControlNode): vscode.TreeItem {
		switch (node.kind) {
			case 'acting': {
				const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon('account');
				item.tooltip = 'Every change made from this view is made as this login.';
				item.contextValue = 'entirely.cpActing';
				return item;
			}
			case 'group': {
				const item = new vscode.TreeItem(GROUP_LABELS[node.group], vscode.TreeItemCollapsibleState.Expanded);
				item.id = `group:${node.group}`;
				item.contextValue = `entirely.cpGroup.${node.group}`;
				return item;
			}
			case 'project': {
				const { project } = node;
				const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Collapsed);
				item.id = `project:${project.id}`;
				item.description = [project.ownerName, project.repositoryCount === undefined ? undefined : `${project.repositoryCount} ${project.repositoryCount === 1 ? 'repository' : 'repositories'}`]
					.filter((part): part is string => part !== undefined)
					.join(' · ');
				item.tooltip = tooltip([
					`Project ${project.name}`,
					project.region ? `Region ${project.region}` : undefined,
					project.canDelete === false ? 'You cannot delete this project.' : undefined,
					project.canCreateRepository === false ? 'You cannot create repositories in it.' : undefined,
				]);
				item.iconPath = new vscode.ThemeIcon('project');
				// A project of GitHub mirrors holds no access of its own.
				item.contextValue = isGithubSourced(project) ? 'entirely.cpMirroredProject' : 'entirely.cpProject';
				return item;
			}
			case 'repository': {
				const { repository } = node;
				const path = repositoryPath(repository);
				const item = new vscode.TreeItem(
					repository.name,
					path === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
				);
				item.id = `repository:${repository.id}`;
				item.description = [repository.visibility, repository.state].filter((part): part is string => part !== undefined).join(' · ');
				item.tooltip = tooltip([
					path ?? `${repository.name} is a mirror and is managed upstream`,
					repository.clusterSlug ? `Cluster ${repository.clusterSlug}` : undefined,
					repository.canManage === false ? 'You cannot manage this repository.' : undefined,
				]);
				item.iconPath = new vscode.ThemeIcon(repository.visibility === 'public' ? 'repo' : 'lock');
				item.contextValue =
					path === undefined
						? 'entirely.cpRepositoryMirror'
						: isGithubSourced({ id: repository.projectId, name: repository.project })
							? 'entirely.cpMirroredRepository'
							: 'entirely.cpRepository';
				return item;
			}
			case 'organisation': {
				const { organisation } = node;
				const item = new vscode.TreeItem(organisation.name, vscode.TreeItemCollapsibleState.Collapsed);
				item.id = `organisation:${organisation.id}`;
				item.description = organisation.region;
				item.tooltip = tooltip([
					`Organisation ${organisation.name}`,
					organisation.canDelete === false ? 'You cannot delete this organisation.' : undefined,
					organisation.canManageMembers === false ? 'You cannot manage its members.' : undefined,
				]);
				item.iconPath = new vscode.ThemeIcon('organization');
				item.contextValue = 'entirely.cpOrganisation';
				return item;
			}
			case 'access': {
				const item = new vscode.TreeItem('Access', vscode.TreeItemCollapsibleState.Collapsed);
				item.id = `access:${node.scope}:${node.target}`;
				item.iconPath = new vscode.ThemeIcon('key');
				item.contextValue = 'entirely.cpAccess';
				return item;
			}
			case 'grant': {
				const { grant } = node;
				const item = new vscode.TreeItem(nameGrant(grant), vscode.TreeItemCollapsibleState.None);
				item.description = [grant.role, grant.source].filter((part): part is string => part !== undefined).join(' · ');
				item.iconPath = new vscode.ThemeIcon(grant.granteeType === 'team' || grant.granteeType === 'org' ? 'organization' : 'person');
				item.contextValue = /inherit/i.test(grant.source ?? '') ? 'entirely.cpGrantInherited' : 'entirely.cpGrant';
				return item;
			}
			case 'cluster': {
				const { cluster } = node;
				const item = new vscode.TreeItem(cluster.slug, vscode.TreeItemCollapsibleState.None);
				item.description = [cluster.jurisdiction, cluster.isDefault ? 'default' : undefined].filter((part): part is string => part !== undefined).join(' · ');
				item.tooltip = cluster.host;
				item.iconPath = new vscode.ThemeIcon('server');
				item.contextValue = 'entirely.cpCluster';
				return item;
			}
			case 'detail': {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
				item.description = node.value;
				item.tooltip = `${node.label}: ${node.value}`;
				item.iconPath = new vscode.ThemeIcon('symbol-field');
				item.contextValue = 'entirely.cpDetail';
				return item;
			}
			case 'invitation': {
				const { invitation } = node;
				const label = invitation.email ?? invitation.id ?? 'Invitation';
				const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
				item.description = [invitation.role, invitation.status].filter((part): part is string => part !== undefined).join(' · ');
				item.tooltip = invitation.raw;
				item.iconPath = new vscode.ThemeIcon('mail');
				item.contextValue = 'entirely.cpInvitation';
				return item;
			}
			case 'protection': {
				const { rule } = node;
				const label = rule.id ?? rule.kind ?? 'Protection rule';
				const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
				item.description = rule.level ?? rule.kind;
				item.tooltip = rule.raw;
				item.iconPath = new vscode.ThemeIcon('shield');
				item.contextValue = 'entirely.cpProtection';
				return item;
			}
			case 'placement': {
				const { placement } = node;
				const label = placement.cluster ?? placement.clusterSlug ?? placement.repo;
				const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
				item.description = [placement.status, placement.cloneUrl].filter((part): part is string => part !== undefined).join(' · ');
				item.tooltip = placement.repo;
				item.iconPath = new vscode.ThemeIcon('server-environment');
				item.contextValue = 'entirely.cpPlacement';
				return item;
			}
			case 'message': {
				const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon('info');
				return item;
			}
		}
	}

	dispose(): void {
		this.changed.dispose();
	}
}

function tooltip(lines: readonly (string | undefined)[]): string {
	return lines.filter((line): line is string => line !== undefined).join('\n');
}

/** The detail rows of a read, or one row that says why it could not be read. */
function detailNodes<T extends { readonly id: string }>(
	read: Read<T>,
	rows: (value: T) => readonly (readonly [string, string | undefined])[],
): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the detail: ${read.detail}.` }];
	}
	const detail = rows(read.value).filter((row): row is readonly [string, string] => row[1] !== undefined);
	return detail.map(([label, value]) => ({ kind: 'detail', label, value }));
}

/** The visibility of a repository, and where that visibility is kept. */
function visibilityNodes(read: Read<{ readonly visibility?: string }>, github: boolean): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the visibility: ${read.detail}.` }];
	}
	if (github) {
		return [{ kind: 'detail', label: 'Visibility', value: 'kept on GitHub' }];
	}
	return read.value.visibility === undefined
		? []
		: [{ kind: 'detail', label: 'Visibility', value: read.value.visibility }];
}

/** The protection rules of a repository, and where that protection is kept. */
function protectionNodes(read: Read<readonly ProtectionRule[]>, github: boolean): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the protection: ${read.detail}.` }];
	}
	if (github) {
		return [{ kind: 'detail', label: 'Protection', value: 'kept on GitHub' }];
	}
	if (read.value.length === 0) {
		return [{ kind: 'detail', label: 'Protection', value: 'none' }];
	}
	return read.value.map((rule): ControlNode => ({ kind: 'protection', rule }));
}

/** The mirror placements of a repository. */
function placementNodes(read: Read<readonly MirrorPlacement[]>): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the mirrors: ${read.detail}.` }];
	}
	if (read.value.length === 0) {
		return [{ kind: 'detail', label: 'Mirrored on', value: 'no cluster' }];
	}
	return read.value.map((placement): ControlNode => ({ kind: 'placement', placement }));
}

/** The open invitations of an organisation. */
function invitationNodes(read: Read<readonly Invitation[]>): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the invitations: ${read.detail}.` }];
	}
	if (read.value.length === 0) {
		return [];
	}
	return read.value.map((invitation): ControlNode => ({ kind: 'invitation', invitation }));
}

/** A listing as nodes, or one line that says why it is not one. */
function asNodes<T>(read: Read<readonly T[]>, what: string, toNodes: (list: readonly T[]) => ControlNode[]): ControlNode[] {
	if (!read.ok) {
		return [{ kind: 'message', text: `Could not read the ${what}: ${read.detail}.` }];
	}
	if (read.value.length === 0) {
		return [{ kind: 'message', text: `No ${what} are visible to this login.` }];
	}
	return toNodes(read.value);
}
