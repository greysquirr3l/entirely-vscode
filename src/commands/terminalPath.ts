import * as vscode from 'vscode';

import { platformSegment } from '../lib/terminalPath';
import type { CliRunner } from '../services/cli';
import {
	planRepair,
	scopeDetail,
	scopeName,
	writeRepair,
	type RepairPlan,
	type RepairRefusal,
	type RepairScope,
} from '../services/terminalPath';

/** What the command needs to do its job. */
export interface TerminalPathDependencies {
	readonly runner: CliRunner;
}

/**
 * The scope the user picked, if they picked one.
 */
async function chooseScope(
	scopes: readonly RepairScope[],
): Promise<RepairScope | undefined> {
	const items = scopes.map(scope => ({
		label: scopeName(scope),
		description: scopeDetail(scope),
		scope,
	}));

	const chosen = await vscode.window.showQuickPick(items, {
		title: 'Where should the terminal PATH be repaired?',
		placeHolder: 'The editor keeps this setting in one of these places',
	});

	return chosen?.scope;
}

/**
 * The scopes that could be written on this machine.
 *
 * The editor keeps a terminal environment for the platform it runs on, so
 * there is nothing to write on a platform it does not know. A workspace
 * needs a folder to be written at all, and a folder needs a workspace
 * folder to point at.
 *
 * The editor also decides which scopes a setting may be written at, and
 * it decides it per setting. That decision is the editor's to make and
 * the extension's to report, so a scope the editor refuses is offered
 * and then refused plainly, rather than being guessed at here.
 */
export function availableScopes(options: {
	readonly platform?: NodeJS.Platform;
	readonly resource?: vscode.Uri;
	readonly hasWorkspace: boolean;
}): RepairScope[] {
	const scopes: RepairScope[] = [];

	if (options.resource) {
		scopes.push('folder');
	}
	if (options.hasWorkspace) {
		scopes.push('workspace');
	}
	scopes.push('user');

	return scopes;
}

/**
 * The explanation of a refusal, as it is shown to the user.
 */
function explainRefusal(refusal: RepairRefusal): string {
	switch (refusal.kind) {
		case 'unsupported-platform':
			return 'The editor does not keep a terminal environment for this platform.';
		case 'no-workspace':
			return 'There is no workspace here to write a workspace-scoped change to.';
		case 'scope-refused':
			return `The editor would not accept the change in ${scopeName(refusal.scope)}: ${refusal.detail}`;
	}
}

/**
 * The explanation of what was written, as it is shown to the user.
 */
export function explainRepair(plan: RepairPlan): string {
	if (plan.action === 'remove') {
		return `Took ${plan.directory} off the terminal PATH in ${scopeName(plan.scope)}.`;
	}

	return `Added ${plan.directory} to the terminal PATH in ${scopeName(plan.scope)}, as ${plan.setting}.`;
}

/**
 * Puts the Entire CLI on the PATH of the editor's terminals.
 *
 * The CLI is normally installed in `~/.local/bin`, which the integrated
 * terminal does not inherit. The extension itself is unaffected — it runs
 * the CLI by absolute path — so this is the terminal's problem and not
 * the extension's.
 *
 * Nothing is written until the user has chosen a scope and confirmed. The
 * editor's own settings are the only thing that is touched: no shell
 * profile is read or written, and no shell command is run.
 */
export async function repairTerminalPath(
	deps: TerminalPathDependencies,
): Promise<void> {
	const discovery = await deps.runner.discover();

	if (discovery.state === 'absent') {
		await vscode.window.showInformationMessage(
			'The Entire CLI is not installed, so there is no path to repair.',
		);
		return;
	}

	if (discovery.state === 'broken') {
		await vscode.window.showErrorMessage(
			`The Entire CLI at ${discovery.path} could not be run, so there is no path to repair.`,
		);
		return;
	}

	const platform = process.platform;
	const segment = platformSegment(platform);
	if (!segment) {
		await vscode.window.showInformationMessage(
			`Entirely does not know how the editor names the terminal environment on ${platform}.`,
		);
		return;
	}

	const resource = vscode.workspace.workspaceFolders?.[0]?.uri;
	const scopes = availableScopes({
		platform,
		resource,
		hasWorkspace: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
	});

	// A scope the editor refused is taken off the list, so the user is
	// offered the scopes that are left rather than the same refusal again.
	let offered = scopes;

	for (;;) {
		const scope = await chooseScope(offered);
		if (!scope) {
			return;
		}

		const planned = planRepair({
			directory: discovery.directory,
			scope,
			platform,
			resource,
		});

		if (planned.kind === 'refused') {
			await vscode.window.showErrorMessage(explainRefusal(planned.refusal));
			return;
		}

		const plan = planned.plan;
		const confirmLabel = plan.action === 'remove' ? 'Take It Off' : 'Add It';
		const confirmed = await vscode.window.showWarningMessage(
			plan.action === 'remove'
				? `Take ${plan.directory} off the terminal PATH in ${scopeName(plan.scope)}?`
				: `Add ${plan.directory} to the terminal PATH in ${scopeName(plan.scope)}?`,
			{ modal: true },
			confirmLabel,
		);

		if (confirmed !== confirmLabel) {
			// The user did not accept, so nothing was written.
			return;
		}

		const written = await writeRepair(plan, resource);

		if (written.kind === 'refused') {
			const refusal = written.refusal;
			await vscode.window.showErrorMessage(explainRefusal(refusal));

			if (refusal.kind !== 'scope-refused') {
				return;
			}

			const remaining = offered.filter(candidate => candidate !== refusal.scope);
			if (remaining.length === 0) {
				return;
			}

			offered = remaining;
			continue;
		}

		const caveats: string[] = [
			explainRepair(plan),
			'Terminals that are already open keep the PATH they started with.',
		];

		if (written.kind === 'shadowed') {
			caveats.push(
				`${scopeName(written.by)} already sets the terminal PATH, so the change in ${scopeName(scope)} will not take effect until that is changed too.`,
			);
		}

		if (scope !== 'user' && !vscode.workspace.isTrusted) {
			caveats.push(
				'This workspace is not trusted, so the editor will ignore the setting until you trust it.',
			);
		}

		await vscode.window.showInformationMessage(caveats.join(' '));
		return;
	}
}
