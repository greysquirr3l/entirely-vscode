import * as vscode from 'vscode';

import {
	nameGrant,
	repositoryPath,
	type AccessGrant,
	type ControlCluster,
	type ControlRepository,
	type GrantScope,
	type Organisation,
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
				const repositories = await this.source.repositories(node.project);
				const nodes = asNodes(repositories, 'repositories', list =>
					list.map((repository): ControlNode => ({ kind: 'repository', repository })),
				);
				return [...nodes, { kind: 'access', scope: 'project', target: node.project.id, label: node.project.name }];
			}

			case 'repository': {
				const path = repositoryPath(node.repository);
				return path === undefined ? [] : this.grantNodes('repo', path, path);
			}

			case 'organisation':
				return this.grantNodes('org', node.organisation.name, node.organisation.name);

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
			case 'organisations':
				return asNodes(await this.source.organisations(), 'organisations', list =>
					list.map((organisation): ControlNode => ({ kind: 'organisation', organisation })),
				);
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
				item.contextValue = 'entirely.cpProject';
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
				item.contextValue = path === undefined ? 'entirely.cpRepositoryMirror' : 'entirely.cpRepository';
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
