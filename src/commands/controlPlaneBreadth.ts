import * as fs from 'fs';
import * as path from 'path';
import {
	forgeOf,
	isControlOperand,
	isEmailAddress,
	isFolderPath,
	isProtectionBranch,
	isRemoteName,
	repositoryReference,
	type ControlRepository,
	type Invitation,
	type MirrorPlacement,
	type Organisation,
	type ProtectionRule,
	type Project,
} from '../lib/entire';
import type { ControlNode } from '../providers/controlPlaneProvider';
import { change, guarded, type ControlPlaneDependencies, type ControlResult } from './controlPlane';

/**
 * The control plane's breadth: the commands that read one organisation,
 * one project, one repository's visibility, protection and mirrors, and
 * the commands that create an organisation or a project, invite somebody,
 * set and lift a repository's protection, place and take away its
 * mirrors, clone a repository, and point a git remote at Entire.
 *
 * A read is shown in a document of its own. A change is confirmed first,
 * in the words of what it will do, and is then read back from the CLI
 * rather than taken from its exit status.
 */

/** Shows one organisation, as the CLI reports it. */
export async function showOrganisation(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const organisation = await organisationOf(deps, node);
		if (!organisation) {
			return 'cancelled';
		}
		const read = await deps.source.organisation(organisation.name);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the organisation ${organisation.name}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Organisation ${organisation.name}`, asDocument(read.value));
		return 'done';
	});
}

/** Shows one project, as the CLI reports it. */
export async function showProject(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const project = await projectOf(deps, node);
		if (!project) {
			return 'cancelled';
		}
		const read = await deps.source.project(project.id);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the project ${project.name}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Project ${project.name}`, asDocument(read.value));
		return 'done';
	});
}

/** Shows the invitations an organisation has sent. */
export async function listInvitations(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const organisation = await organisationOf(deps, node);
		if (!organisation) {
			return 'cancelled';
		}
		const read = await deps.source.invitations(organisation.name);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the invitations of ${organisation.name}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Invitations of ${organisation.name}`, invitationDocument(read.value));
		return 'done';
	});
}

/** Shows whether a repository is public or private. */
export async function showRepositoryVisibility(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		const id = await repositoryIdOf(deps, node);
		if (!reference || !id) {
			return 'cancelled';
		}
		const read = await deps.source.visibility(id);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the visibility of ${reference}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Visibility of ${reference}`, asDocument(read.value));
		return 'done';
	});
}

/** Shows the branch protection rules a repository has. */
export async function listProtectionRules(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		const id = await repositoryIdOf(deps, node);
		if (!reference || !id) {
			return 'cancelled';
		}
		const read = await deps.source.protection(id);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the protection of ${reference}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Protection of ${reference}`, protectionDocument(read.value));
		return 'done';
	});
}

/** Shows the clusters a repository is mirrored on. */
export async function listMirrors(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		const read = await deps.source.mirrors(reference);
		if (!read.ok) {
			await deps.ui.warn(`Cannot read the mirrors of ${reference}: ${read.detail}.`);
			return 'failed';
		}
		await deps.ui.showResult(`Mirrors of ${reference}`, mirrorDocument(read.value));
		return 'done';
	});
}

/** Creates an organisation. */
export async function createOrganisation(deps: ControlPlaneDependencies): Promise<ControlResult> {
	return guarded(deps, async () => {
		const name = await deps.ui.ask({
			title: 'New organisation',
			prompt: 'The name of the organisation.',
			validate: value => (isControlOperand(value.trim()) ? undefined : 'Use letters, digits, dots, dashes and underscores.'),
		});
		if (name === undefined) {
			return 'cancelled';
		}
		const region = await jurisdictionOf(deps);
		if (region === undefined) {
			return 'cancelled';
		}
		return change(deps, { kind: 'create-organisation', name: name.trim(), region });
	});
}

/** Invites an address to an organisation. */
export async function inviteToOrganisation(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const organisation = await organisationOf(deps, node);
		if (!organisation) {
			return 'cancelled';
		}
		const email = await deps.ui.ask({
			title: `Invite to ${organisation.name}`,
			prompt: 'The email address to invite.',
			validate: value => (isEmailAddress(value.trim()) ? undefined : 'That is not an email address.'),
		});
		if (email === undefined) {
			return 'cancelled';
		}
		const choices = await deps.source.choices({ kind: 'invite-role' });
		let role: string | undefined;
		if (choices.ok && choices.value.length > 0) {
			role = await deps.ui.pick(`Role of ${email.trim()}`, choices.value);
			if (role === undefined) {
				return 'cancelled';
			}
		}
		return change(deps, { kind: 'invite', org: organisation.name, email: email.trim(), role });
	});
}

/** Revokes an invitation an organisation has sent. */
export async function revokeInvitation(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const organisation = await organisationOf(deps, node);
		if (!organisation) {
			return 'cancelled';
		}
		const email = await deps.ui.ask({
			title: `Revoke an invitation of ${organisation.name}`,
			prompt: 'The email address the invitation was sent to.',
			validate: value => (isEmailAddress(value.trim()) ? undefined : 'That is not an email address.'),
		});
		if (email === undefined) {
			return 'cancelled';
		}
		return change(deps, { kind: 'revoke-invitation', org: organisation.name, email: email.trim() });
	});
}

/** Creates a project under an organisation or an account. */
export async function createProject(deps: ControlPlaneDependencies): Promise<ControlResult> {
	return guarded(deps, async () => {
		const name = await deps.ui.ask({
			title: 'New project',
			prompt: 'The name of the project.',
			validate: value => (isControlOperand(value.trim()) ? undefined : 'Use letters, digits, dots, dashes and underscores.'),
		});
		if (name === undefined) {
			return 'cancelled';
		}
		const owner = await deps.ui.ask({
			title: 'New project',
			prompt: 'The owner: an organisation name, or an account such as github:alice.',
			validate: value => (isControlOperand(value.trim()) ? undefined : 'Use letters, digits, dots, dashes, underscores and colons.'),
		});
		if (owner === undefined) {
			return 'cancelled';
		}
		const choices = await deps.source.choices({ kind: 'owner-type' });
		let ownerType: string | undefined;
		if (choices.ok && choices.value.length > 0) {
			ownerType = await deps.ui.pick(`Kind of owner ${owner.trim()}`, choices.value);
			if (ownerType === undefined) {
				return 'cancelled';
			}
		}
		const region = await jurisdictionOf(deps);
		if (region === undefined) {
			return 'cancelled';
		}
		return change(deps, {
			kind: 'create-project',
			name: name.trim(),
			owner: owner.trim(),
			ownerType,
			region,
		});
	});
}

/** Protects a branch from force pushes, or from direct pushes altogether. */
export async function addProtectionRule(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		if (forgeOf(reference) !== 'et') {
			await deps.ui.inform(
				`The protection of ${reference} is the upstream's: branch protection is governed by the repository on GitHub, ` +
					"and its default branch is always protected on Entire.",
			);
			return 'cancelled';
		}
		const branch = await deps.ui.ask({
			title: `Protect ${reference}`,
			prompt: 'The branch to protect: HEAD, a branch name, or a pattern such as release/*.',
			validate: value => (isProtectionBranch(value.trim()) ? undefined : 'A branch name cannot begin with a dash or contain a space.'),
		});
		if (branch === undefined) {
			return 'cancelled';
		}
		const level = await deps.ui.pick(`What to refuse on ${branch.trim()}`, ['Refuse every direct push', 'Keep the current level']);
		if (level === undefined) {
			return 'cancelled';
		}
		return change(deps, {
			kind: 'add-protection',
			repo: reference,
			branch: branch.trim(),
			serverSideMergeOnly: level === 'Refuse every direct push' ? true : undefined,
		});
	});
}

/** Removes a branch protection rule. */
export async function removeProtectionRule(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		if (forgeOf(reference) !== 'et') {
			await deps.ui.inform(
				`The protection of ${reference} is the upstream's: branch protection is governed by the repository on GitHub, ` +
					"and its default branch is always protected on Entire.",
			);
			return 'cancelled';
		}
		const branch = await deps.ui.ask({
			title: `Unprotect ${reference}`,
			prompt: 'The branch to unprotect: HEAD, a branch name, or a pattern such as release/*.',
			validate: value => (isProtectionBranch(value.trim()) ? undefined : 'A branch name cannot begin with a dash or contain a space.'),
		});
		if (branch === undefined) {
			return 'cancelled';
		}
		return change(deps, { kind: 'remove-protection', repo: reference, branch: branch.trim() });
	});
}

/** Places a repository on one or more clusters. */
export async function addMirror(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		const clusters = await deps.source.clusters();
		if (!clusters.ok) {
			await deps.ui.warn(`Cannot list the clusters: ${clusters.detail}.`);
			return 'failed';
		}
		const hosts = clusters.value.map(cluster => cluster.host ?? cluster.slug);
		const picked = await deps.ui.pickMany(`Clusters to mirror ${reference} onto`, hosts);
		if (picked.length === 0) {
			return 'cancelled';
		}
		return change(deps, { kind: 'add-mirror', repo: reference, clusters: picked });
	});
}

/** Takes a repository off one or more clusters. */
export async function removeMirror(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		const mirrors = await deps.source.mirrors(reference);
		if (!mirrors.ok) {
			await deps.ui.warn(`Cannot read the mirrors of ${reference}: ${mirrors.detail}.`);
			return 'failed';
		}
		const hosts = [...new Set(mirrors.value.map(placement => placement.cluster ?? placement.clusterSlug).filter(host => host !== undefined))];
		if (hosts.length === 0) {
			await deps.ui.inform(`${reference} is not mirrored on any cluster.`);
			return 'cancelled';
		}
		const picked = await deps.ui.pickMany(`Clusters to take ${reference} off`, hosts);
		if (picked.length === 0) {
			return 'cancelled';
		}
		return change(deps, { kind: 'remove-mirror', repo: reference, clusters: picked });
	});
}

/** Turns a mirror into a repository of Entire's own. */
export async function detachMirror(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		if (forgeOf(reference) !== 'gh') {
			await deps.ui.inform(`${reference} is already a repository of Entire's own, so there is no mirror to detach.`);
			return 'cancelled';
		}
		const into = await deps.ui.ask({
			title: `Detach ${reference}`,
			prompt: 'The repository it becomes, as /et/<project>/<repo>.',
			validate: value => (isNativePath(value.trim()) ? undefined : 'Write it as /et/<project>/<repo>.'),
		});
		if (into === undefined) {
			return 'cancelled';
		}
		// The CLI's own plan comes first, so the person sees what it will do.
		const plan = await deps.source.detachPlan(reference, into.trim());
		if (!plan.ok) {
			await deps.ui.warn(
				`The Entire CLI's plan for this detach does not hold: ${plan.detail}. ` +
					'Extra mirror placements are the usual reason; remove them first, then try again.',
			);
			return 'cancelled';
		}
		await deps.ui.inform(`The Entire CLI's plan for this detach:\n${plan.value}`);
		return change(deps, { kind: 'detach-mirror', repo: reference, into: into.trim() });
	});
}

/** Asks the CLI to fetch a mirror's changes again. */
export async function resyncMirror(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		if (forgeOf(reference) !== 'gh') {
			await deps.ui.inform(`${reference} is a repository of Entire's own, so it has no upstream to fetch from.`);
			return 'cancelled';
		}
		return change(deps, { kind: 'resync-mirror', repo: reference });
	});
}

/** Clones a repository from Entire into this workspace. */
export async function cloneRepository(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const reference = await repositoryReferenceOf(deps, node);
		if (!reference) {
			return 'cancelled';
		}
		const root = deps.source.workspaceRoot();
		if (root === undefined) {
			await deps.ui.warn('This workspace has no folder to clone into.');
			return 'cancelled';
		}
		const name = reference.split('/').pop() ?? reference;
		const parent = await deps.ui.ask({
			title: `Clone ${reference}`,
			prompt: 'The folder to clone into, relative to this workspace. Leave it as . for the workspace itself.',
			value: '.',
			validate: value => (isFolderPath(value.trim()) ? undefined : 'A folder path is relative to this workspace and cannot start with a dash.'),
		});
		if (parent === undefined) {
			return 'cancelled';
		}
		const target = path.join(parent.trim(), name);
		const resolved = path.resolve(root, target);
		if (resolved !== root && !resolved.startsWith(root + path.sep)) {
			await deps.ui.warn('A clone cannot be written outside this workspace.');
			return 'cancelled';
		}
		if (fs.existsSync(resolved) && !isEmptyFolder(resolved)) {
			await deps.ui.warn(`${resolved} already exists and is not empty, so nothing is cloned into it. Choose another folder.`);
			return 'cancelled';
		}
		const cluster = await clusterFor(deps, reference);
		if (cluster === null) {
			return 'cancelled';
		}
		return change(deps, { kind: 'clone-repository', repo: reference, target, resolved, cluster });
	});
}

/** Whether a folder holds nothing, so a clone may be written into it. */
function isEmptyFolder(folder: string): boolean {
	try {
		return fs.statSync(folder).isDirectory() && fs.readdirSync(folder).length === 0;
	} catch {
		return false;
	}
}

/**
 * The cluster a repository is reached on.
 *
 * The CLI reaches a repository through one cluster, and asks which when
 * there is more than one, so the clusters the repository is on are read
 * and offered.
 */
async function clusterFor(deps: ControlPlaneDependencies, reference: string): Promise<string | undefined | null> {
	const mirrors = await deps.source.mirrors(reference);
	if (!mirrors.ok) {
		// The clone can still go ahead; the CLI picks the cluster itself.
		await deps.ui.inform(`Cannot read where ${reference} is mirrored: ${mirrors.detail}. The CLI will choose the cluster.`);
		return undefined;
	}
	const hosts = [...new Set(mirrors.value.map(placement => placement.cluster ?? placement.clusterSlug).filter(host => host !== undefined))];
	if (hosts.length === 0) {
		return undefined;
	}
	if (hosts.length === 1) {
		return hosts[0];
	}
	const picked = await deps.ui.pick(`The cluster to clone ${reference} from`, hosts);
	return picked;
}

/** Points a git remote in this checkout at an Entire cluster. */
export async function addRemote(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const name = await deps.ui.ask({
			title: 'Add an Entire remote',
			prompt: 'The name the remote is given, such as entire.',
			validate: value => (isRemoteName(value.trim()) ? undefined : 'Use letters, digits, dots, dashes and underscores, starting with a letter or digit.'),
		});
		if (name === undefined) {
			return 'cancelled';
		}
		const reference = await repositoryReferenceOf(deps, node);
		if (reference === undefined) {
			return 'cancelled';
		}
		// The cluster the remote points at, when the repository is on one.
		const cluster = await clusterFor(deps, reference);
		if (cluster === null) {
			return 'cancelled';
		}
		// A name that is taken is repointed only when the person says so.
		const existing = deps.source.remoteUrl(name.trim());
		if (existing !== undefined) {
			await deps.ui.inform(`The remote ${name.trim()} already points at ${existing}.`);
			const repoint = await deps.ui.confirm({
				message: `Repoint the remote ${name.trim()}?`,
				detail: `It points at ${existing}. Repointing it replaces that address, and the old one is lost to this checkout.`,
				action: 'Repoint Remote',
			});
			if (!repoint) {
				return 'cancelled';
			}
			return change(deps, { kind: 'add-remote', name: name.trim(), repo: reference, cluster, override: true, previous: existing });
		}
		return change(deps, { kind: 'add-remote', name: name.trim(), repo: reference, cluster });
	});
}

/**
 * The ULID of the repository a command is about.
 *
 * The CLI reads a repository's visibility and its protection by its
 * ULID: it refuses a `/gh/` reference for those two, and asks for the
 * id instead.
 */
async function repositoryIdOf(deps: ControlPlaneDependencies, node?: ControlNode): Promise<string | undefined> {
	if (node?.kind === 'repository') {
		return node.repository.id;
	}
	return undefined;
}

/** The organisation a command is about: the one clicked, or one the person picks. */
async function organisationOf(deps: ControlPlaneDependencies, node?: ControlNode): Promise<Organisation | undefined> {
	if (node?.kind === 'organisation') {
		return node.organisation;
	}
	const organisations = await deps.source.organisations();
	if (!organisations.ok) {
		await deps.ui.warn(`Cannot list the organisations: ${organisations.detail}.`);
		return undefined;
	}
	if (organisations.value.length === 0) {
		await deps.ui.warn('This login can see no organisations.');
		return undefined;
	}
	const name = await deps.ui.pick('Organisation', organisations.value.map(organisation => organisation.name));
	if (name === undefined) {
		return undefined;
	}
	const chosen = organisations.value.find(organisation => organisation.name === name);
	if (!chosen) {
		await deps.ui.warn(`There is no organisation named ${name}.`);
		return undefined;
	}
	return chosen;
}

/** The project a command is about: the one clicked, or one the person picks. */
async function projectOf(deps: ControlPlaneDependencies, node?: ControlNode): Promise<Project | undefined> {
	if (node?.kind === 'project') {
		return node.project;
	}
	const projects = await deps.source.projects();
	if (!projects.ok) {
		await deps.ui.warn(`Cannot list the projects: ${projects.detail}.`);
		return undefined;
	}
	if (projects.value.length === 0) {
		await deps.ui.warn('This login can see no projects.');
		return undefined;
	}
	return deps.ui.pickProject(projects.value);
}

/** The repository a command is about: the one clicked, or one the person picks. */
async function repositoryOf(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlRepository | undefined> {
	if (node?.kind === 'repository') {
		return node.repository;
	}
	const project = await projectOf(deps, node);
	if (!project) {
		return undefined;
	}
	const repositories = await deps.source.repositories(project);
	if (!repositories.ok) {
		await deps.ui.warn(`Cannot list the repositories of ${project.name}: ${repositories.detail}.`);
		return undefined;
	}
	if (repositories.value.length === 0) {
		await deps.ui.warn(`${project.name} holds no repositories.`);
		return undefined;
	}
	const name = await deps.ui.pick(`Repository in ${project.name}`, repositories.value.map(repository => repository.name));
	if (name === undefined) {
		return undefined;
	}
	const chosen = repositories.value.find(repository => repository.name === name);
	if (!chosen) {
		await deps.ui.warn(`There is no repository named ${name} in ${project.name}.`);
		return undefined;
	}
	return chosen;
}

/**
 * The reference the CLI addresses the repository by.
 *
 * The CLI names a mirror `/gh/<owner>/<repo>` and one of Entire's own
 * `/et/<project>/<repo>`, and a repository the listing gave no forge name
 * for cannot be named to it at all.
 */
async function repositoryReferenceOf(deps: ControlPlaneDependencies, node?: ControlNode): Promise<string | undefined> {
	const repository = await repositoryOf(deps, node);
	if (!repository) {
		return undefined;
	}
	const reference = repositoryReference(repository);
	if (reference === undefined) {
		await deps.ui.inform(`${repository.name} has no address on Entire, so the CLI cannot be told which repository this is about.`);
		return undefined;
	}
	return reference;
}

/**
 * The jurisdiction a new organisation or project is created in.
 *
 * The jurisdictions are the ones the CLI's own clusters are in, so the
 * list is the CLI's and not a set of names written down here.
 */
async function jurisdictionOf(deps: ControlPlaneDependencies): Promise<string | undefined> {
	const clusters = await deps.source.clusters();
	if (!clusters.ok || clusters.value.length === 0) {
		return undefined;
	}
	const jurisdictions = [...new Set(clusters.value.map(cluster => cluster.jurisdiction).filter(jurisdiction => jurisdiction !== undefined))];
	if (jurisdictions.length === 0) {
		return undefined;
	}
	return deps.ui.pick('Jurisdiction', jurisdictions);
}

/** A native repository path, as the CLI writes it. */
function isNativePath(value: string): boolean {
	return /^\/et\/[^/\s]+\/[^/\s]+$/.test(value);
}

/** A directory name to clone into, relative to the workspace. */
function isDirectoryName(value: string): boolean {
	return value.length > 0 && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..';
}

/** A read, as the document shows it. */
function asDocument(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

/** The invitations of an organisation, one per line. */
function invitationDocument(invitations: readonly Invitation[]): string {
	if (invitations.length === 0) {
		return 'No invitations.';
	}
	return invitations
		.map(invitation => {
			const known = [invitation.email, invitation.role, invitation.status].filter(part => part !== undefined);
			return known.length > 0 ? known.join('  ') : invitation.raw;
		})
		.join('\n');
}

/** The protection rules of a repository, one per line. */
function protectionDocument(rules: readonly ProtectionRule[]): string {
	if (rules.length === 0) {
		return 'No protection rules.';
	}
	return rules
		.map(rule => {
			const known = [rule.id, rule.kind, rule.level].filter(part => part !== undefined);
			return known.length > 0 ? known.join('  ') : rule.raw;
		})
		.join('\n');
}

/** The mirrors of a repository, one per line. */
function mirrorDocument(placements: readonly MirrorPlacement[]): string {
	if (placements.length === 0) {
		return 'Not mirrored on any cluster.';
	}
	return placements
		.map(placement =>
			[placement.repo, placement.cluster ?? placement.clusterSlug ?? '(no cluster)', placement.status ?? '']
				.filter(part => part.length > 0)
				.join('  '),
		)
		.join('\n');
}
