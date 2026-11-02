import * as vscode from 'vscode';

import type { ControlNode } from '../providers/controlPlaneProvider';
import {
	createRepository,
	deleteOrganisation,
	deleteProject,
	deleteRepository,
	grantAccess,
	revokeAccess,
	runApiCall,
	setRepositoryVisibility,
	type ControlPlaneDependencies,
} from './controlPlane';
import {
	addMirror,
	addProtectionRule,
	addRemote,
	cloneRepository,
	createOrganisation,
	createProject,
	detachMirror,
	inviteToOrganisation,
	listInvitations,
	listMirrors,
	listProtectionRules,
	removeMirror,
	removeProtectionRule,
	resyncMirror,
	revokeInvitation,
	showOrganisation,
	showProject,
	showRepositoryVisibility,
} from './controlPlaneBreadth';

/**
 * Registers the control plane commands.
 *
 * Each command that changes something on Entire is reached only by the
 * person choosing it, from the view's menus or the palette. None is ever
 * run for them, and the API command is not offered to any view or poller.
 */
export function registerControlPlaneCommands(context: vscode.ExtensionContext, deps: ControlPlaneDependencies): void {
	const node = (value: unknown): ControlNode | undefined =>
		typeof value === 'object' && value !== null && 'kind' in value ? (value as ControlNode) : undefined;

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.openControlPlane', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.entirely');
			await vscode.commands.executeCommand('entirely.controlPlane.focus');
			deps.refresh();
		}),
		vscode.commands.registerCommand('entirely.refreshControlPlane', () => {
			deps.refresh();
		}),
		vscode.commands.registerCommand('entirely.createRepository', async (target?: unknown) => {
			await createRepository(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.deleteRepository', async (target?: unknown) => {
			await deleteRepository(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.setRepositoryVisibility', async (target?: unknown) => {
			await setRepositoryVisibility(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.deleteProject', async (target?: unknown) => {
			await deleteProject(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.deleteOrganisation', async (target?: unknown) => {
			await deleteOrganisation(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.grantAccess', async (target?: unknown) => {
			await grantAccess(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.revokeAccess', async (target?: unknown) => {
			await revokeAccess(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.runApiCall', async () => {
			await runApiCall(deps);
		}),
		vscode.commands.registerCommand('entirely.showOrganisation', async (target?: unknown) => {
			await showOrganisation(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.showProject', async (target?: unknown) => {
			await showProject(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.listInvitations', async (target?: unknown) => {
			await listInvitations(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.showRepositoryVisibility', async (target?: unknown) => {
			await showRepositoryVisibility(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.listProtectionRules', async (target?: unknown) => {
			await listProtectionRules(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.listMirrors', async (target?: unknown) => {
			await listMirrors(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.createOrganisation', async () => {
			await createOrganisation(deps);
		}),
		vscode.commands.registerCommand('entirely.inviteToOrganisation', async (target?: unknown) => {
			await inviteToOrganisation(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.revokeInvitation', async (target?: unknown) => {
			await revokeInvitation(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.createProject', async () => {
			await createProject(deps);
		}),
		vscode.commands.registerCommand('entirely.addProtectionRule', async (target?: unknown) => {
			await addProtectionRule(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.removeProtectionRule', async (target?: unknown) => {
			await removeProtectionRule(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.addMirror', async (target?: unknown) => {
			await addMirror(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.removeMirror', async (target?: unknown) => {
			await removeMirror(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.detachMirror', async (target?: unknown) => {
			await detachMirror(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.resyncMirror', async (target?: unknown) => {
			await resyncMirror(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.cloneRepository', async (target?: unknown) => {
			await cloneRepository(deps, node(target));
		}),
		vscode.commands.registerCommand('entirely.addRemote', async (target?: unknown) => {
			await addRemote(deps, node(target));
		}),
	);
}
