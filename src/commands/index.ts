import * as vscode from 'vscode';
import { signIn, signOut } from './authentication';
import { showCliDoctorOutput } from './cliDoctorOutput';
import { doctor } from './doctor';
import { dumpCliOutput } from './dumpCliOutput';
import { openCheckpointFile } from './openCheckpoint';
import { repairTerminalPath } from './terminalPath';
import { blameFile, clearBlame } from './blameFile';
import { readExtensionSettings } from '../services/configuration';
import type { CliDoctorSource } from '../services/cliDoctor';
import { explainCheckpoint, whyThisLine } from './whyThisLine';
import { clearCheckpointSearch, searchCheckpoints } from './checkpointSearch';
import { openSearchResult, searchWork } from './workSearch';
import type { SearchProvider, SearchTarget } from '../providers/searchProvider';
import { checkpointDestination } from './checkpointDestination';
import {
	adoptSession,
	attachSession,
	resumeStoppedSession,
	stopSession,
	type LifecycleDependencies,
} from './sessionLifecycle';
import { importHistory, type ImportDependencies } from './historyImport';
import { manageAgents, type AgentDependencies } from './agentIntegrations';
import { openTranscript, selectSession, setOwnSessionFilter } from './sessionDetail';
import {
	approveChange,
	checkoutChange,
	commentOnChange,
	linkBranch,
	mergeChange,
	unlinkBranch,
} from './trailReview';
import type { CheckpointFileNode, CheckpointsProvider } from '../providers/checkpointsProvider';
import type { SessionDetailProvider } from '../providers/sessionDetailProvider';
import type { TranscriptContentProvider } from '../providers/transcriptDocument';
import type { TokenUsageSource } from '../services/tokenUsage';
import type { SessionDetailSource } from '../services/sessionDetail';
import type { SessionItemNode, SessionsProvider } from '../providers/sessionsProvider';
import type { CheckpointFilter } from '../services/checkpointFilter';
import type { TrailsProvider } from '../providers/trailsProvider';
import type { CheckpointDetail } from '../lib/entire';
import type { GitService } from '../services/gitService';
import type { StatusController } from '../services/statusController';
import type { AccountContextService } from '../services/accountContext';
import type { AuthenticationService } from '../services/authentication';
import type { AuthenticationProvider } from '../providers/authenticationProvider';
import type { CliRunner } from '../services/cli';
import type { CliInvocationRecorder } from '../services/cli/recorder';
import type { BlameDecorations } from '../providers/blameDecorations';
import type { BlameService } from '../services/blameService';
import type { TrailService } from '../services/trailService';
import type { WhyService } from '../services/whyService';

/** The surfaces the command handlers act on. */
export interface CommandDependencies {
	readonly sessions: SessionsProvider;
	readonly sessionDetail: SessionDetailProvider;
	readonly checkpoints: CheckpointsProvider;
	/** The text the checkpoint tree is filtered by, and what the search found. */
	readonly checkpointFilter: CheckpointFilter;
	/** The Search view and what it shows. */
	readonly search: SearchProvider;
	/** Reads one session in full. */
	readonly sessionDetailSource: SessionDetailSource;
	readonly tokenUsage: TokenUsageSource;
	/** Serves transcripts as read-only documents. */
	readonly transcripts: TranscriptContentProvider;
	readonly statusController: StatusController;
	/** Who the CLI is signed in as. */
	readonly authentication: AuthenticationService;
	/** The view that says who the CLI is signed in as. */
	readonly authenticationProvider: AuthenticationProvider;
	readonly git: GitService | undefined;
	readonly workspaceFolder: () => vscode.Uri | undefined;
	readonly why: WhyService;
	/** Blames a whole file. */
	readonly blame: BlameService;
	/** Draws a blamed file's attribution in the editor. */
	readonly blameDecorations: BlameDecorations;
	/** Stops, attaches, adopts and resumes sessions. */
	readonly lifecycle: LifecycleDependencies;
	/** Lists, installs and removes agent integrations. */
	readonly agentIntegrations: AgentDependencies;
	/** Imports past agent history as read-only checkpoints. */
	readonly historyImport: ImportDependencies;
	/** The trails of the workspace, as the CLI knows them. */
	readonly trails: TrailService;
	/** The trails section of the view. */
	readonly trailsProvider: TrailsProvider;
	/** The CLI the extension talks to. */
	readonly runner: CliRunner;
	/** Which login the CLI is acting as. */
	readonly accounts: AccountContextService;
	/** Reads one checkpoint's story. */
	readonly checkpointDetail: (id: string) => Promise<CheckpointDetail | undefined>;
	/** What the CLI has been asked to do so far. */
	readonly recorder: CliInvocationRecorder;
	/** The CLI's own diagnostics, for the doctor report. */
	readonly cliDoctor: CliDoctorSource;
	/** Where the extension's one log is written. */
	readonly output: vscode.OutputChannel;
}

const EXTENSION_ID = 'greysquirr3l.entirely';

/**
 * Registers every command the manifest contributes.
 *
 * The manifest and this list must agree: the smoke test asserts that every
 * contributed command is registered, so a command added to `package.json`
 * without a handler here fails the suite.
 */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDependencies): void {
	// The filter box is created on demand and disposed when it is hidden;
	// this makes sure one that is still open goes with the extension.
	let filterBox: vscode.InputBox | undefined;
	context.subscriptions.push({ dispose: () => filterBox?.dispose() });

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.searchCheckpoints', () => {
			filterBox?.dispose();
			filterBox = searchCheckpoints(deps.checkpointFilter);
		}),

		vscode.commands.registerCommand('entirely.clearCheckpointSearch', () => {
			clearCheckpointSearch(deps.checkpointFilter);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.searchWork', async (query?: unknown) => {
			await searchWork(deps.search, query);
		}),

		vscode.commands.registerCommand('entirely.clearSearch', () => {
			deps.search.clear();
		}),

		vscode.commands.registerCommand('entirely.openSearchResult', async (target: SearchTarget) => {
			await openSearchResult(
				{
					roots: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
					findSession: async id => {
						const listing = await deps.lifecycle.sessions();
						const session = listing.sessions.find(candidate => candidate.id === id);
						return session ? { kind: 'session', session } : undefined;
					},
					showSession: async node => {
						await vscode.commands.executeCommand('entirely.showSessions');
						await vscode.commands.executeCommand('entirely.selectSession', node);
					},
					explainCheckpoint: async id => {
						await vscode.commands.executeCommand('entirely.explainCheckpoint', id);
					},
				},
				target,
			);
		}),

		vscode.commands.registerCommand('entirely.refresh', async () => {
			await deps.statusController.refresh();
			await deps.sessions.refresh();
			await deps.checkpoints.refresh();
			await deps.trailsProvider.refresh();
			await deps.authenticationProvider.refresh();
		}),

		// The view container is registered by VS Code under
		// `workbench.view.extension.<id>`. The plain `workbench.view.<id>`
		// form is not a command, and asking for it fails with
		// "command not found".
		vscode.commands.registerCommand('entirely.showSessions', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.entirely');
			await vscode.commands.executeCommand('entirely.sessions.focus');
		}),

		// The status bar item's own command. It routes on the current state
		// rather than doing one thing, so it is hidden from the palette and
		// reached by clicking the item.
		vscode.commands.registerCommand('entirely.statusBar', async () => {
			await deps.statusController.handleClick();
		}),

		vscode.commands.registerCommand('entirely.setUp', async () => {
			await deps.statusController.offerToSetUp();
		}),

		vscode.commands.registerCommand('entirely.selectSession', async (element: SessionItemNode) => {
			await selectSession(
				{
					sessions: deps.sessions,
					sessionDetail: deps.sessionDetail,
					detail: deps.sessionDetailSource,
					usage: deps.tokenUsage,
				},
				element,
			);
		}),

		// The transcript opens in a read-only editor. It is reached from the
		// detail view and from a session's context menu.
		vscode.commands.registerCommand('entirely.openTranscript', async (target?: string | SessionItemNode) => {
			const id = typeof target === 'string' ? target : target?.session.id;
			await openTranscript(
				{
					sessionDetail: deps.sessionDetail,
					detail: deps.sessionDetailSource,
					documents: deps.transcripts,
				},
				id,
			);
		}),

		// Each lifecycle command changes what the CLI is tracking, so each is
		// reached only by the user choosing it, from the palette or a
		// session's context menu. None is ever run for them.
		// An import writes checkpoints for the user's whole history, so it is
		// only ever run by the user choosing it, after the preview.
		// Installing or removing an integration writes the repository's hook
		// configuration, so it is only ever run by the user choosing it.
		vscode.commands.registerCommand('entirely.manageAgents', async () => {
			await manageAgents(deps.agentIntegrations);
		}),

		vscode.commands.registerCommand('entirely.importHistory', async () => {
			await importHistory(deps.historyImport);
		}),

		vscode.commands.registerCommand('entirely.stopSession', async (target?: SessionItemNode) => {
			await stopSession(deps.lifecycle, target?.session);
		}),

		vscode.commands.registerCommand('entirely.attachSession', async (target?: SessionItemNode) => {
			await attachSession(deps.lifecycle, target?.session);
		}),

		vscode.commands.registerCommand('entirely.adoptSession', async (target?: SessionItemNode) => {
			await adoptSession(deps.lifecycle, target?.session);
		}),

		vscode.commands.registerCommand('entirely.resumeSession', async (target?: SessionItemNode) => {
			await resumeStoppedSession(deps.lifecycle, target?.session);
		}),

		vscode.commands.registerCommand('entirely.showOwnSession', async () => {
			await setOwnSessionFilter(deps.sessions, true);
		}),

		vscode.commands.registerCommand('entirely.showAllSessions', async () => {
			await setOwnSessionFilter(deps.sessions, false);
		}),

		vscode.commands.registerCommand('entirely.openCheckpointFile', async (element: CheckpointFileNode) => {
			await openCheckpointFile(element, deps.git, deps.workspaceFolder());
		}),

		vscode.commands.registerCommand('entirely.repairTerminalPath', async () => {
			await repairTerminalPath({ runner: deps.runner });
		}),

		// Where the checkpoints of this workspace are going, and whether
		// Entire can reach them. It is a command because the answer is
		// about this workspace, and it changes when the workspace does.
		vscode.commands.registerCommand('entirely.checkpointDestination', async () => {
			await checkpointDestination({
				runner: deps.runner,
				workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				output: deps.output,
			});
		}),

		vscode.commands.registerCommand('entirely.whyThisLine', async (line?: unknown) => {
			await whyThisLine(
				{
					why: deps.why,
					checkpointDetail: deps.checkpointDetail,
				},
				line,
			);
		}),

		vscode.commands.registerCommand('entirely.blameFile', async () => {
			await blameFile({
				blame: deps.blame,
				decorations: deps.blameDecorations,
				maxDecoratedLines: () => readExtensionSettings().blameMaxDecoratedLines,
			});
		}),

		vscode.commands.registerCommand('entirely.clearBlame', () => {
			clearBlame(deps.blameDecorations);
		}),

		// The review actions on a trail. Each one is a command rather
		// than part of a tree, because each one asks the reviewer to
		// choose what they are acting on and then confirms what they
		// are about to do.
		vscode.commands.registerCommand('entirely.trailApprove', async () => {
			await approveChange({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		vscode.commands.registerCommand('entirely.trailComment', async () => {
			await commentOnChange({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		vscode.commands.registerCommand('entirely.trailMerge', async () => {
			await mergeChange({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		vscode.commands.registerCommand('entirely.trailCheckout', async () => {
			await checkoutChange({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		vscode.commands.registerCommand('entirely.trailLink', async () => {
			await linkBranch({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		vscode.commands.registerCommand('entirely.trailUnlink', async () => {
			await unlinkBranch({
				trails: deps.trails,
				actingHandle: () => deps.accounts.current.acting?.handle,
			});
		}),

		// The drill-down from a line that a checkpoint owns. It is reached
		// from the panel, so it is not in the palette.
		vscode.commands.registerCommand('entirely.explainCheckpoint', async (id: string) => {
			await explainCheckpoint(
				{
					why: deps.why,
					checkpointDetail: deps.checkpointDetail,
				},
				id,
			);
		}),

		// Signing in and signing out are offered from the command palette
		// and from the Account view, and both are about the whole
		// extension rather than about the workspace.
		vscode.commands.registerCommand('entirely.signIn', async () => {
			await signIn({
				authentication: deps.authentication,
				accounts: deps.accounts,
				workspaceRoot: () => deps.workspaceFolder()?.fsPath,
				output: deps.output,
			});
			await deps.authenticationProvider.refresh();
		}),

		vscode.commands.registerCommand('entirely.signOut', async () => {
			await signOut({
				authentication: deps.authentication,
				accounts: deps.accounts,
				workspaceRoot: () => deps.workspaceFolder()?.fsPath,
				output: deps.output,
			});
			await deps.authenticationProvider.refresh();
		}),

		vscode.commands.registerCommand('entirely.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
		}),

		// The report a user pastes into an issue when something is not
		// working. It is a command rather than a view because it is
		// something to copy, not something to look at.
		vscode.commands.registerCommand('entirely.doctor', async () => {
			await doctor({
				runner: deps.runner,
				accounts: deps.accounts,
				recorder: deps.recorder,
				cliDoctor: deps.cliDoctor,
				workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				output: deps.output,
			});
		}),

		// What `entire doctor` printed on the last report, in full. The
		// report keeps only the findings, so the rest is asked for here.
		vscode.commands.registerCommand('entirely.showCliDoctorOutput', async () => {
			await showCliDoctorOutput({ cliDoctor: deps.cliDoctor, output: deps.output });
		}),

		// The full output of the last CLI invocation. It is behind an
		// explicit command because it is the user's own content.
		vscode.commands.registerCommand('entirely.dumpCliOutput', async () => {
			await dumpCliOutput({
				recorder: deps.recorder,
				output: deps.output,
			});
		}),
	);
}
