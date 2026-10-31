import * as vscode from 'vscode';

import type { AccountContext } from '../lib/entire';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { CliRunner } from '../services/cli';
import { readExtensionSettings } from '../services/configuration';
import { ExpertsService } from '../services/experts';
import type { GitService } from '../services/gitService';
import { ReviewService } from '../services/review';
import { reviewTerminalLauncher } from '../services/reviewTerminal';
import { TokenProfileService } from '../services/tokenProfile';
import { EditorAnalysisUi } from './analysisUi';
import { expertsAsk, expertsForPath, expertsStaged, showRawReply } from './experts';
import {
	openReviewSetup,
	runReview,
	showReviewConfig,
	showReviewFindings,
	showReviewProfiles,
	type ReviewDependencies,
} from './review';
import { showTokenProfile } from './tokenProfile';

export interface AnalysisCommandDependencies {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	readonly workspaceFolder: () => vscode.Uri | undefined;
	readonly documents: GeneratedDocuments;
	readonly git: GitService | undefined;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
}

/**
 * Registers the token profile, experts and review commands.
 *
 * Every command is reached by choosing it; nothing here runs on its own or
 * on a timer. The profile and the review views only read. Experts sends the
 * question to Entire's servers and says so. Running a review asks first and
 * opens one terminal.
 */
export function registerAnalysisCommands(context: vscode.ExtensionContext, deps: AnalysisCommandDependencies): void {
	const { runner, workspaceRoot } = deps;
	const ui = new EditorAnalysisUi(deps.documents);

	const branches = async (): Promise<{ readonly current?: string; readonly local: readonly string[] }> => {
		const repository = deps.git?.repositoryFor(deps.workspaceFolder());
		return deps.git && repository ? deps.git.branches(repository) : { local: [] };
	};

	const profile = new TokenProfileService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().tokenProfileTimeout,
	});
	const experts = new ExpertsService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().expertsTimeout,
		limit: () => readExtensionSettings().expertsLimit,
		branch: () => {
			const repository = deps.git?.repositoryFor(deps.workspaceFolder());
			return deps.git && repository ? deps.git.currentBranch(repository) : undefined;
		},
	});
	const expertsDeps = { source: experts, ui, acting: deps.acting, workspaceRoot };

	const terminalListeners: vscode.Disposable[] = [];
	context.subscriptions.push({ dispose: () => vscode.Disposable.from(...terminalListeners).dispose() });
	const review: ReviewDependencies = {
		source: new ReviewService({ runner, workspaceRoot, readTimeoutSeconds: () => readExtensionSettings().reviewReadTimeout }),
		ui,
		launch: reviewTerminalLauncher(terminalListeners),
		acting: deps.acting,
		branches,
		timeoutMinutes: () => readExtensionSettings().reviewReviewerTimeoutMinutes,
		running: { active: false },
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.tokenProfile', async () => {
			await showTokenProfile({ source: profile, ui, limit: () => readExtensionSettings().tokenProfileCheckpoints });
		}),
		vscode.commands.registerCommand('entirely.expertsForPath', async (target?: unknown) => {
			// A link in the blame panel passes the file as text. It is checked to be inside the workspace before Entire is asked.
			const uri = target instanceof vscode.Uri ? target : vscode.window.activeTextEditor?.document.uri;
			const file = typeof target === 'string' && target.length > 0 ? target : uri?.scheme === 'file' ? uri.fsPath : undefined;
			await expertsForPath(expertsDeps, file);
		}),
		vscode.commands.registerCommand('entirely.expertsAsk', async () => {
			await expertsAsk(expertsDeps);
		}),
		vscode.commands.registerCommand('entirely.expertsStaged', async () => {
			await expertsStaged(expertsDeps);
		}),
		vscode.commands.registerCommand('entirely.showExpertsRawReply', async () => {
			await showRawReply({ source: experts, ui });
		}),
		vscode.commands.registerCommand('entirely.reviewProfiles', async () => {
			await showReviewProfiles(review);
		}),
		vscode.commands.registerCommand('entirely.reviewShowConfig', async () => {
			await showReviewConfig(review);
		}),
		vscode.commands.registerCommand('entirely.reviewFindings', async () => {
			await showReviewFindings(review);
		}),
		vscode.commands.registerCommand('entirely.reviewRun', async () => {
			await runReview(review);
		}),
		vscode.commands.registerCommand('entirely.reviewSetup', async () => {
			await openReviewSetup(review);
		}),
	);
}
