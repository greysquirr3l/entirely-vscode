import * as vscode from 'vscode';

import type { AccountContext } from '../lib/entire';
import type { AgentIntegrationService } from '../services/agentIntegrations';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { SessionsProvider, SessionItemNode } from '../providers/sessionsProvider';
import type { AuthenticationProvider } from '../providers/authenticationProvider';
import type { CliRunner } from '../services/cli';
import { CaptureControlService } from '../services/captureControl';
import { readExtensionSettings } from '../services/configuration';
import { INSTALL_COMMAND, INSTALL_DOCS } from '../services/onboarding';
import type { StatusController } from '../services/statusController';
import { cleanSessionData, configureEntire, disableCapture, setUpRunners, uninstallEntire } from './captureControl';
import { EditorCaptureUi } from './captureUi';

export interface CaptureCommandDependencies {
	readonly runner: CliRunner;
	readonly documents: GeneratedDocuments;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly statusController: StatusController;
	readonly authenticationProvider: AuthenticationProvider;
	readonly sessions: SessionsProvider;
	readonly agentIntegrations: AgentIntegrationService;
}

/**
 * Registers the commands that stop, remove, configure and clean capture and
 * set up runners.
 *
 * None of them runs on its own: each is reached by choosing it, and each
 * asks before it changes anything. One flag is shared by all five, so only
 * one of them runs at a time.
 */
export function registerCaptureCommands(context: vscode.ExtensionContext, deps: CaptureCommandDependencies): void {
	const dependencies = {
		service: new CaptureControlService({
			runner: deps.runner,
			timeoutSeconds: () => readExtensionSettings().captureControlTimeout,
			runnerTimeoutSeconds: () => readExtensionSettings().runnerSetupTimeout,
		}),
		ui: new EditorCaptureUi(deps.documents),
		folders: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
		acting: deps.acting,
		refresh: {
			status: () => deps.statusController.refresh(),
			account: () => deps.authenticationProvider.refresh(),
			sessions: () => deps.sessions.refresh(),
		},
		setUpAgain: () => deps.statusController.setUp(),
		invalidateAgents: () => deps.agentIntegrations.invalidate(),
		installCommand: INSTALL_COMMAND,
		installDocs: INSTALL_DOCS,
		running: { active: false },
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.disableCapture', async () => {
			await disableCapture(dependencies);
		}),
		vscode.commands.registerCommand('entirely.uninstallEntire', async () => {
			await uninstallEntire(dependencies);
		}),
		vscode.commands.registerCommand('entirely.configureEntire', async () => {
			await configureEntire(dependencies);
		}),
		vscode.commands.registerCommand('entirely.cleanSessionData', async (target?: SessionItemNode) => {
			await cleanSessionData(dependencies, target?.session?.id);
		}),
		vscode.commands.registerCommand('entirely.setUpRunners', async () => {
			await setUpRunners(dependencies);
		}),
	);
}
