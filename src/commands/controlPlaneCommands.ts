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
	);
}
