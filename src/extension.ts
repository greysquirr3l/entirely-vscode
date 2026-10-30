import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { decodeWorkspaceStatus, describeActingLogin, unwrap, type WorkspaceStatus } from './lib/entire';
import { AuthenticationProvider } from './providers/authenticationProvider';
import { AuthenticationPanel } from './providers/authenticationPanel';
import { CheckpointsProvider } from './providers/checkpointsProvider';
import { SessionDetailProvider } from './providers/sessionDetailProvider';
import { SessionsProvider } from './providers/sessionsProvider';
import { TRANSCRIPT_SCHEME, TranscriptContentProvider } from './providers/transcriptDocument';
import { SessionDetailService } from './services/sessionDetail';
import { TokenUsageService } from './services/tokenUsage';
import { CliInvocationRecorder, CliRunner } from './services/cli';
import { AccountContextService } from './services/accountContext';
import { AuthenticationService } from './services/authentication';
import { readExtensionSettings, effectiveLogLevel } from './services/configuration';
import {
	createCheckpointDetailSource,
	createCheckpointSource,
} from './services/checkpointSource';
import { SearchProvider } from './providers/searchProvider';
import { WorkSearchService } from './services/workSearch';
import { CheckpointFilter } from './services/checkpointFilter';
import { CheckpointSearchService } from './services/checkpointSearch';
import { CliInvocationLogger } from './services/cliLogging';
import { GitService } from './services/gitService';
import { HookBridge } from './services/hookBridge';
import { AgentIntegrationService } from './services/agentIntegrations';
import { EditorAgentUi } from './commands/agentIntegrationsUi';
import {
	INSTALL_COMMAND,
	INSTALL_DOCS,
	OnboardingPrompt,
	detectFault,
	type OnboardingAction,
	type WorkspaceFault,
} from './services/onboarding';
import { isGitRepository } from './services/repository';
import { enableEntire } from './services/setup';
import { createSessionSource } from './services/sessionSource';
import { createLogger } from './services/logger';
import { StatusBar } from './services/statusBar';
import { StatusController } from './services/statusController';
import { onTerminalPath } from './services/terminalPath';
import { BlameDecorations } from './providers/blameDecorations';
import { BlameService } from './services/blameService';
import { WhyService } from './services/whyService';
import { EditorLifecycleUi } from './commands/lifecycleUi';
import { CliDoctorService } from './services/cliDoctor';
import { SessionLifecycleService } from './services/sessionLifecycle';
import { launchInTerminal } from './services/resumeTerminal';
import { EditorImportUi } from './commands/importUi';
import { HistoryImportService } from './services/historyImport';
import { ControlPlaneProvider } from './providers/controlPlaneProvider';
import { ControlApiService } from './services/controlApi';
import { ControlPlaneService } from './services/controlPlane';
import { registerControlPlaneCommands } from './commands/controlPlaneCommands';
import { ActivityProvider } from './providers/activityProvider';
import { GENERATED_SCHEME, GeneratedDocuments } from './providers/generatedDocuments';
import { ActivityService } from './services/activity';
import { DispatchService } from './services/dispatch';
import { registerPluginCommands } from './commands/pluginCommands';
import { EntireMcpProvider, registerMcpProvider } from './services/mcpProvider';
import { McpServerService } from './services/mcpServer';
import { PluginService } from './services/plugins';
import { RecapService } from './services/recap';
import { registerActivityCommands } from './commands/activityCommands';
import { EditorGeneratedUi } from './commands/activityUi';
import { EditorControlPlaneUi } from './commands/controlPlaneUi';

/** The workspace folder the CLI is run in. */
function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The workspace folder the git repository is found in. */
function workspaceFolder(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Reads the workspace's tracking state, when the CLI can be asked. */
async function readWorkspaceStatus(
	runner: CliRunner,
	folder: string,
): Promise<WorkspaceStatus | undefined> {
	const result = await runner.runJson(
		['status', '--json'],
		value => unwrap(decodeWorkspaceStatus(value)),
		{ cwd: folder },
	);

	return result.ok ? result.value : undefined;
}

/**
 * Entry point. Everything created here is pushed onto `context.subscriptions`
 * so the extension host can tear it down cleanly.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// One channel for everything the extension says: what it asked the CLI
	// to do, what came back, and what went wrong.
	const output = vscode.window.createOutputChannel('Entire');
	context.subscriptions.push(output);

	const runner = new CliRunner();

	// The path the user gave for the CLI is applied before anything is
	// read, so the very first look uses the binary they chose.
	runner.setConfiguredPath(readExtensionSettings().cliPath);

	// The login the extension acts as is worked out before anything is
	// read, so that every command after it is asked as the right account.
	const accounts = new AccountContextService(runner);

	const log = createLogger(output, () => effectiveLogLevel(readExtensionSettings()));

	// Every CLI invocation is reported to the channel, and remembered, so
	// that the doctor can say what went wrong even when the failure was
	// swallowed by the tree that could not be filled.
	const recorder = new CliInvocationRecorder();
	runner.setSink(new CliInvocationLogger(log, recorder));

	const status = new StatusBar();
	context.subscriptions.push(status);

	// The agents the CLI lists as installed are the ones editor events are
	// addressed to, and the ones the setup command installs and removes.
	const agentIntegrations = new AgentIntegrationService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().lifecycleActionTimeout,
		cacheTtlMs: () => readExtensionSettings().agentLookupCacheSeconds * 1000,
		editorAgent: () => readExtensionSettings().editorHookAgent,
	});

	const hooks = new HookBridge({
		runner,
		agents: agentIntegrations,
		workspaceRoot,
		// The CLI's flag does not reach the processes it spawns, so the
		// hook is told which login to act as through the environment.
		context: () => accounts.context,
		log: line => log.debug(`hook ${line}`),
		warn: line => log.warn(`hook ${line}`),
	});

	const statusController = new StatusController({
		statusBar: status,
		runner,
		output,
		hooks,
		accounts,
	});
	context.subscriptions.push(statusController);

	const sessions = new SessionsProvider(createSessionSource(runner, workspaceRoot), () =>
		readExtensionSettings().refreshInterval,
	);
	context.subscriptions.push(sessions);

	const sessionDetail = new SessionDetailProvider();
	context.subscriptions.push(sessionDetail);

	// Transcripts open as read-only documents, never as tree nodes.
	const transcripts = new TranscriptContentProvider();
	context.subscriptions.push(
		transcripts,
		vscode.workspace.registerTextDocumentContentProvider(TRANSCRIPT_SCHEME, transcripts),
	);
	const sessionDetailSource = new SessionDetailService({
		runner,
		workspaceRoot,
		transcriptTimeoutSeconds: () => readExtensionSettings().transcriptTimeout,
	});

	const tokenUsage = new TokenUsageService({ runner, workspaceRoot });

	const checkpoints = new CheckpointsProvider(
		createCheckpointSource(runner, workspaceRoot),
		createCheckpointDetailSource(runner, workspaceRoot),
		() => readExtensionSettings().refreshInterval,
		tokenUsage,
	);
	context.subscriptions.push(checkpoints);

	// The filter's text lives in the filter and nowhere else. Each answer
	// narrows the checkpoint tree.
	const checkpointSearch = new CheckpointSearchService({ runner, workspaceRoot });
	const checkpointFilter = new CheckpointFilter(
		checkpointSearch,
		() => readExtensionSettings().searchDebounce,
	);
	context.subscriptions.push(
		checkpointFilter,
		checkpointFilter.onDidChange(state => {
			checkpoints.applyFilter(state);
			void vscode.commands.executeCommand(
				'setContext',
				'entirely.checkpointFilterActive',
				state.kind !== 'idle',
			);
		}),
	);

	const checkpointsView = vscode.window.createTreeView('entirely.checkpoints', {
		treeDataProvider: checkpoints,
	});
	context.subscriptions.push(checkpointsView);

	// Search over sessions, commits, checkpoints and files. The scope is a
	// setting, read at each search, and the acting login is named in the results.
	const search = new SearchProvider(
		new WorkSearchService({
			runner,
			workspaceRoot,
			reach: () => (readExtensionSettings().searchScope === 'all-repositories' ? 'all' : 'current'),
			login: () => accounts.context,
		}),
	);
	context.subscriptions.push(search);
	const searchView = vscode.window.createTreeView('entirely.search', { treeDataProvider: search });
	context.subscriptions.push(
		searchView,
		search.onDidChangeTreeData(() => {
			searchView.message = search.viewMessage;
			void vscode.commands.executeCommand('setContext', 'entirely.searchActive', !search.isIdle);
		}),
	);

	const sessionsView = vscode.window.createTreeView('entirely.sessions', {
		treeDataProvider: sessions,
	});
	context.subscriptions.push(sessionsView);

	const detailView = vscode.window.createTreeView('entirely.sessionDetail', {
		treeDataProvider: sessionDetail,
	});
	context.subscriptions.push(detailView);

	// The same session tree, shown in the Explorer as well, for the users
	// who want to see it next to the source control views.
	const explorerSessionsView = vscode.window.createTreeView('entirely.explorerSessions', {
		treeDataProvider: sessions,
	});
	context.subscriptions.push(explorerSessionsView);

	// Who the CLI is signed in as. The view says the identity and the
	// jurisdiction, and offers the sign-in and the sign-out.
	const authentication = new AuthenticationService(runner);
	const authenticationProvider = new AuthenticationProvider(
		() => authentication.refresh(workspaceRoot()),
		() => readExtensionSettings().refreshInterval,
	);
	context.subscriptions.push(authenticationProvider);

	const authenticationView = vscode.window.createTreeView('entirely.authentication', {
		treeDataProvider: authenticationProvider,
	});
	context.subscriptions.push(authenticationView);
	context.subscriptions.push(AuthenticationPanel);

	// The tree view shows a message in place of the sessions when there is
	// a reason the tree is empty.
	context.subscriptions.push(
		sessions.onDidChangeTreeData(() => {
			sessionsView.message = sessions.emptyReason;
			explorerSessionsView.message = sessions.emptyReason;
		}),
	);

	context.subscriptions.push(
		checkpoints.onDidChangeTreeData(() => {
			checkpointsView.message = checkpoints.viewMessage;
		}),
	);

	const git = await GitService.create();

	const onboarding = new OnboardingPrompt({
		state: context.globalState,
		folders: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
		detect: async (folder: string): Promise<WorkspaceFault> => {
			const discovery = await runner.discover();
			const status = await readWorkspaceStatus(runner, folder);
			return detectFault({
				cli: discovery,
				status,
				isRepository: isGitRepository(folder),
				onTerminalPath:
					discovery.state === 'available'
						? onTerminalPath(discovery.directory, process.platform)
						: true,
			});
		},
		run: async (action: OnboardingAction, folder: string): Promise<void> => {
			switch (action.kind) {
				case 'install':
					await vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOCS));
					await vscode.window.showInformationMessage(
						`Install the Entire CLI with: ${INSTALL_COMMAND}`,
					);
					return;

				case 'enable':
					await enableEntire(runner, folder);
					await statusController.refresh();
					return;

				case 'repair-path':
					await vscode.commands.executeCommand('entirely.repairTerminalPath');
					return;
			}
		},
	});
	context.subscriptions.push({ dispose: () => void onboarding });

	void onboarding.offer();

	const why = new WhyService({ runner, workspaceRoot });
	const blame = new BlameService({ runner, workspaceRoot });
	const blameDecorations = new BlameDecorations();
	context.subscriptions.push(blameDecorations);

	const sessionSource = createSessionSource(runner, workspaceRoot);
	const lifecycle = new SessionLifecycleService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().lifecycleActionTimeout,
	});

	// One resume per branch at a time, and every watch stops when the window closes.
	const resumeWatches = new AbortController();
	context.subscriptions.push({ dispose: () => resumeWatches.abort() });

	const historyImport = new HistoryImportService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().importTimeout,
	});

	const cliDoctor = new CliDoctorService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().cliDoctorTimeout,
	});

	// Projects, repositories, organisations and grants. Nothing here polls:
	// each level is read when it is opened, as the login the extension acts as.
	const controlPlane = new ControlPlaneService({
		runner,
		workspaceRoot,
		timeoutSeconds: () => readExtensionSettings().controlPlaneTimeout,
		context: () => accounts.context,
	});
	const controlPlaneProvider = new ControlPlaneProvider(controlPlane, () => {
		const acting = accounts.current.acting;
		return acting ? describeActingLogin(acting) : undefined;
	});
	context.subscriptions.push(
		controlPlaneProvider,
		vscode.window.createTreeView('entirely.controlPlane', { treeDataProvider: controlPlaneProvider }),
	);
	registerControlPlaneCommands(context, {
		source: controlPlane,
		api: new ControlApiService({
			runner,
			workspaceRoot,
			timeoutSeconds: () => readExtensionSettings().controlPlaneTimeout,
		}),
		// The login is read again just before a change is confirmed, so the
		// question names the login the command will run as.
		acting: async () => (await accounts.refresh(workspaceRoot())).acting,
		ui: new EditorControlPlaneUi(),
		refresh: () => {
			void accounts.refresh(workspaceRoot()).then(() => controlPlaneProvider.refresh());
		},
		running: { active: false },
	});

	// Recent sessions and commits across repositories, read from the CLI's
	// static output when the view opens and when asked, never on a timer.
	const activity = new ActivityProvider(
		new ActivityService({
			runner,
			workspaceRoot,
			timeoutSeconds: () => readExtensionSettings().activityTimeout,
		}),
		() => accounts.context,
	);
	const activityView = vscode.window.createTreeView('entirely.activity', { treeDataProvider: activity });
	const generated = new GeneratedDocuments();
	const generatedUi = new EditorGeneratedUi(generated);
	context.subscriptions.push(
		activity,
		activityView,
		activity.onDidChangeTreeData(() => {
			activityView.message = activity.viewMessage;
		}),
		generated,
		vscode.workspace.registerTextDocumentContentProvider(GENERATED_SCHEME, generated),
	);
	registerActivityCommands(context, {
		activity,
		documents: generated,
		dispatch: {
			source: new DispatchService({
				runner,
				workspaceRoot,
				timeoutSeconds: () => readExtensionSettings().dispatchTimeout,
			}),
			acting: async () => (await accounts.refresh(workspaceRoot())).acting,
			ui: generatedUi,
			running: { active: false },
		},
		recap: {
			source: new RecapService({
				runner,
				workspaceRoot,
				timeoutSeconds: () => readExtensionSettings().activityTimeout,
			}),
			ui: generatedUi,
		},
	});

	// Plugins run as the acting login, and the MCP server is offered to the
	// editor's own agent. The editor owns the server process.
	const mcpServer = new McpServerService({ runner, workspaceRoot });
	const mcpProvider = new EntireMcpProvider(mcpServer, () => readExtensionSettings().mcpServerEnabled);
	context.subscriptions.push(mcpProvider, registerMcpProvider(mcpProvider));
	registerPluginCommands(context, {
		plugins: {
			source: new PluginService({
				runner,
				workspaceRoot,
				timeoutSeconds: () => readExtensionSettings().pluginTimeout,
			}),
			acting: async () => (await accounts.refresh(workspaceRoot())).acting,
			running: { active: false },
		},
		documents: generated,
		mcp: { source: mcpServer, provider: mcpProvider, enabled: () => readExtensionSettings().mcpServerEnabled },
	});

	registerCommands(context, {
		search,
		cliDoctor,
		agentIntegrations: {
			agents: agentIntegrations,
			ui: new EditorAgentUi(),
			refresh: () => statusController.refresh(),
			running: { active: false },
		},
		historyImport: {
			importer: historyImport,
			ui: new EditorImportUi(),
			refresh: async () => {
				await Promise.all([sessions.refresh(), checkpoints.refresh()]);
			},
			running: { active: false },
		},
		lifecycle: {
			watching: new Set<string>(),
			signal: resumeWatches.signal,
			lifecycle,
			sessions: sessionSource,
			ui: new EditorLifecycleUi(git, workspaceFolder),
			refresh: () => sessions.refresh(),
			workspaceRoot,
			launch: launchInTerminal,
			resumeWatchMs: () => readExtensionSettings().resumeWatchTimeout * 1000,
		},
		sessions,
		sessionDetail,
		sessionDetailSource,
		tokenUsage,
		transcripts,
		checkpoints,
		checkpointFilter,
		authentication,
		authenticationProvider,
		statusController,
		git,
		workspaceFolder,
		why,
		blame,
		blameDecorations,
		runner,
		accounts,
		checkpointDetail: createCheckpointDetailSource(runner, workspaceRoot),
		recorder,
		output,
	});

	// A setting that changes takes effect at once, without a window reload.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('entirely.refreshInterval')) {
				sessions.reschedule();
				checkpoints.reschedule();
				authenticationProvider.reschedule();
			}

			if (event.affectsConfiguration('entirely.mcpServerEnabled') || event.affectsConfiguration('entirely.cliPath')) {
				mcpProvider.refresh();
			}

			if (event.affectsConfiguration('entirely.cliPath')) {
				runner.setConfiguredPath(readExtensionSettings().cliPath);
				checkpointSearch.reset();
				controlPlaneProvider.refresh();
				void activity.reloadIfRead();
				void statusController.refresh();
				void sessions.refresh();
				void checkpoints.refresh();
			}

			if (event.affectsConfiguration('entirely.cliContext')) {
				// The login changes what every command is asked, so the
				// trees are read again as the new login rather than left
				// showing the previous account's work.
				void statusController.refresh().then(() => {
					controlPlaneProvider.refresh();
					void activity.reloadIfRead();
					void sessions.refresh();
					void checkpoints.refresh();
				});
			}
		}),
	);

	// The status is read first, because it is what works out which login
	// the CLI is acting as, and the trees are read as that login.
	await statusController.refresh();
	void sessions.refresh();
	void checkpoints.refresh();
	void authenticationProvider.refresh();
}

export function deactivate(): void {}
