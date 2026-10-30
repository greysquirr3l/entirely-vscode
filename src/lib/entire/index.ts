export type {
	ActiveSession,
	ModelId,
	Session,
	Timestamp,
	WorkspaceStatus,
} from './types';
export type { DecodeIssue, DecodeIssueKind, DecodeResult } from './decode';
export { unwrap } from './decode';
export { canBeSetUp, decodeWorkspaceStatus, isTracked } from './status';
export { decodeCurrentSession, decodeSession, decodeSessionList } from './session';
export { decodeSessionInfo, isSessionId } from './sessionInfo';
export type { SessionInfo } from './sessionInfo';
export { NOT_RECOGNISED, NOT_REPORTED, decodeTokenReport, describeTokenReport } from './tokenUsage';
export type { TokenReport, TokenUsage, UsageLine, UsageView } from './tokenUsage';
export { NO_OWN_SESSION, ownSessionOnly } from './sessionFilter';
export type { OwnSessionResult } from './sessionFilter';
export { countToolCalls, parseTranscript } from './transcript';
export type { ToolCallCount, Transcript, TranscriptItem, TranscriptRole } from './transcript';
export { MAX_DOCUMENT_CHARACTERS, MAX_MESSAGE_CHARACTERS, MAX_RAW_CHARACTERS, renderTranscript } from './transcriptView';
export type { TranscriptSource } from './transcriptView';
export { escapeMarkdown, humanizeStatus, oneLine, pluralise, truncatePrompt } from './text';
export type { SessionListing, SessionQuery, SessionSource } from './source';
export {
	checkpointRef,
	decodeCheckpoint,
	decodeCheckpointDetail,
	decodeCheckpointList,
	isCheckpointId,
} from './checkpoint';
export {
	endsWithLineSuffix,
	fileArguments,
	fileOperand,
	splitLineSuffix,
} from './operand';
export type {
	Checkpoint,
	CheckpointDetail,
	CheckpointSession,
} from './types';
export { decodeWhyAnswer, isAttributed } from './why';
export { blameArguments, decodeBlameAnswer, lineAnswerFrom } from './blame';
export type { BlameAnswer } from './blame';
export { planBlameMarks } from './blameMarks';
export type { BlameMark, BlamePlan } from './blameMarks';
export { lineState, UNATTRIBUTED_LABEL, UNSYNCED_LABEL } from './lineState';
export type { LineState } from './lineState';
export { answerNamesFile, workspaceRelative } from './workspacePath';
export { parseRequestedLine } from './requestedLine';
export {
	decodeEntireSettings,
	resolveEntireSettings,
	summariseSettings,
} from './settings';
export type {
	CheckpointProvider,
	CheckpointRemote,
	EntireSettings,
	StrategyOptionValue,
} from './settings';
export {
	canSeeRepo,
	decodeRepoIdentity,
	decodeVisibleRepos,
	describeCheckpointProblem,
	describeDestination,
	parseForgeRef,
	resolveCheckpointDestination,
} from './destination';
export type {
	CheckpointDestination,
	CheckpointDestinationSource,
	Forge,
	ForgeRef,
	RepoIdentity,
	VisibleRepo,
} from './destination';
export {
	DEFAULT_MINIMUM_CLI_VERSION,
	compareCliVersions,
	describeUnexpectedPayload,
	describeUnsupportedCli,
	isAtLeast,
	parseCliVersion,
} from './cliVersion';
export type { CliVersion } from './cliVersion';
export type {
	LineAttribution,
	WhyAnswer,
	WhyCandidate,
	WhyLine,
	WhySummary,
} from './why';
export {
	decodeAccountContexts,
	describeAccountContext,
	describeUnknownContext,
	isInvisibleToLogin,
	isUnknownContextError,
	selectAccountContext,
} from './accountContext';
export type {
	AccountContext,
	AccountContextSelection,
} from './accountContext';
export {
	decodeAuthStatus,
	describeIdentity,
	describeJurisdiction,
	isSignedIn,
} from './authentication';
export type { AuthStatus } from './authentication';
export {
	describeRemote,
	describeSignInLocation,
	isHeadlessEnvironment,
	locateBrowser,
} from './environment';
export type { BrowserLocation, WindowHost } from './environment';
export { findVerificationUrl, isEntireUrl } from './verificationUrl';
export {
	MAX_QUERY_CHARACTERS,
	SEARCH_RESULT_LIMIT,
	decodeSearchResults,
	describeSearchOutcome,
	normaliseQuery,
	outcomeOf,
	planSearchFlags,
	readFlagTable,
	searchArguments,
} from './search';
export type { HelpFlag, SearchFlagPlan, SearchOutcome, SearchResults } from './search';
export {
	activeOnBranch,
	adoptArguments,
	asksForAgreement,
	attachArguments,
	cleanCliText,
	failureDetail,
	isBranchName,
	isCommitRef,
	isLive,
	isStoppable,
	isWorktreePath,
	nameSession,
	planAdoptFlags,
	planAttachFlags,
	planResumeFlags,
	planStopFlags,
	resumable,
	resumeArguments,
	stopArguments,
} from './sessionLifecycle';
export type {
	AdoptFlags,
	AttachFlags,
	LifecycleAction,
	LifecycleOutcome,
	LifecyclePlan,
	ResumeFlags,
	StopFlags,
} from './sessionLifecycle';
export { describeResume, describeUnsavedRefusal } from './sessionResume';
export type { ResumeResult } from './sessionResume';
export {
	IMPORTED_LABEL,
	isImportedCheckpoint,
	isImportedSession,
	markImported,
} from './importedHistory';
export {
	MAX_IMPORT_SESSIONS,
	describeImportResult,
	importArguments,
	isImportAgent,
	parseSessionIds,
	planImportFlags,
	readImportAgents,
	readImportCounts,
	readImportPreview,
} from './importHistory';
export type { ImportCounts, ImportOutcome, ImportPlan, ImportPreview, ImportScope } from './importHistory';
export { HOOK_EVENTS, resolveHookName } from './hookEvents';
export type { CliHookName, EditorHookEvent, HookEventRoute } from './hookEvents';
export {
	agentAddArguments,
	agentRemoveArguments,
	isAgentName,
	parseAgentList,
	planAgentAddFlags,
	readWrittenFiles,
} from './agents';
export type { AgentAddFlags, AgentEntry } from './agents';
export { DEFAULT_EDITOR_HOOK_AGENT, classifyAgent, describeBridging, findHookVerbs } from './agentHooks';
export type { HookBridging } from './agentHooks';
export {
	MAX_DOCTOR_FINDINGS,
	describeCliDoctor,
	parseDoctorOutput,
	readDoctorOutput,
} from './cliDoctor';
export type { CliDoctorReading, DoctorCheck } from './cliDoctor';
export {
	codeSearchArguments,
	planWorkSearch,
	readCurrentRepo,
	workSearchArguments,
} from './workSearchFlags';
export type { RepositoryReach, WorkSearchPlan, WorkSearchPlanResult } from './workSearchFlags';
export {
	decodeFileHits,
	decodeWorkHits,
	describeEmptyOutcome,
	describeScope,
	outcomeOfReport,
	scopeLine,
	summariseReport,
} from './workSearchResults';
export type {
	FileHit,
	FileHitPage,
	SearchScope,
	WorkHit,
	WorkHitKind,
	WorkHitPage,
	WorkSearchOutcome,
	WorkSearchReport,
} from './workSearchResults';
export { isSameRepository, resolveInRoot } from './searchTargets';
export {
	decodeAccessGrants,
	decodeControlClusters,
	decodeControlRepositories,
	decodeOrganisations,
	decodeProjects,
	grantHandle,
	grantIsFor,
	isApiPath,
	isControlOperand,
	isGrantee,
	isRepositoryName,
	nameGrant,
	repositoryPath,
} from './controlPlane';
export type {
	AccessGrant,
	ControlCluster,
	ControlRepository,
	Organisation,
	Project,
	ProjectRef,
} from './controlPlane';
export {
	API_METHODS,
	API_WANTS,
	DELETE_WANTS,
	GRANT_WANTS,
	LIST_WANTS,
	REPO_CREATE_WANTS,
	REPO_EDIT_WANTS,
	REPO_LIST_WANTS,
	apiArguments,
	createRepositoryArguments,
	deleteArguments,
	describeFlag,
	editVisibilityArguments,
	grantAddArguments,
	grantListArguments,
	grantRemoveArguments,
	isReadMethod,
	listArguments,
	pickFlags,
	readChoices,
	repoListArguments,
} from './controlPlaneFlags';
export type { FlagPick, FlagWant, GrantScope } from './controlPlaneFlags';
export {
	apiConfirmation,
	confirmationFor,
	describeActingLogin,
	describeControlAction,
	describeControlOutcome,
	scopeWord,
	shownTarget,
} from './controlPlaneActions';
export type { ControlAction, ControlConfirmation, ControlOutcome } from './controlPlaneActions';
export {
	ACTIVITY_WANTS,
	DISPATCH_WANTS,
	RECAP_WANTS,
	STATIC_OUTPUT_ENV,
	activityArguments,
	describeHelpFailure,
	isJurisdictionSlug,
	isTimeWindow,
	readCommandFlags,
	readDefaultValue,
	recapArguments,
	recapPeriods,
	staticEnvironment,
	withSignInHint,
} from './activityFlags';
export type { ActivityListing, CommandFlags, DispatchFlags, RecapFlags, RecapPeriod } from './activityFlags';
export { countEntries, parseActivity, stripTerminalCodes } from './activityOutput';
export type {
	ActivityEntry,
	ActivityGroup,
	ActivityOverview,
	ActivityReading,
	ActivityRepository,
	ActivityStat,
} from './activityOutput';
export { confirmDispatch, describeDispatchFailure, dispatchArguments, invalidDispatchRequest } from './dispatchActions';
export type { DispatchMode, DispatchOutcome, DispatchRequest } from './dispatchActions';
export {
	MAX_PLUGIN_ARGUMENTS,
	PLUGIN_INSTALL_WANTS,
	confirmPluginInstall,
	confirmPluginRun,
	describeMissingPlugin,
	installCommandLine,
	invalidPluginArguments,
	isPluginName,
	isMissingPlugin,
	isUnknownCommand,
	parseInstalledPlugins,
	pickInstallFlags,
	pluginArguments,
	pluginInstallArguments,
	readBuiltinCommands,
	readPluginFlags,
	readSubcommands,
	splitWords,
} from './plugins';
export type { InstalledPlugin } from './plugins';
export { MCP_PROVIDER_ID, MCP_SERVER_LABEL, describeMcpUnavailable, describesMcpServer, mcpClientConfig } from './mcp';
export type { McpLaunch } from './mcp';
export {
	DEFAULT_SUGGESTED_PLUGINS,
	MAX_SUGGESTED_PLUGINS,
	describeCliUnavailable,
	describeMcpConfig,
	describeMcpEditor,
	describePluginState,
	integrationTargetOf,
	isInstallable,
	judgeCli,
	missingPlugins,
	readSuggestedPlugins,
} from './integrations';
export type {
	CliAvailability,
	DiscoveredCli,
	FolderIntegrations,
	IntegrationReading,
	McpConfigFile,
	McpConfigState,
	McpConfigTarget,
	McpEditorState,
	McpServersKey,
	PluginRow,
	PluginState,
	IntegrationTarget,
} from './integrations';
export {
	EDITOR_CONFIG,
	MAX_CONFIG_BYTES,
	PROJECT_SERVER_NAME,
	ROOT_CONFIG,
	chooseConfigTarget,
	confirmProjectMcp,
	detectIndent,
	hasEntireEntry,
	manualSnippet,
	mergeEntireServer,
	parseConfig,
	projectMcpArguments,
	serverEntry,
	targetFor,
} from './mcpProjectConfig';
export type { MergeResult, ParsedConfig } from './mcpProjectConfig';
export { describeMcpScope, mcpEnableScope } from './mcpSetting';
export type { McpSettingScope, McpSettingValues } from './mcpSetting';
export {
	decodeTrail,
	decodeTrailApproval,
	decodeTrailApprovals,
	decodeTrailChange,
	decodeTrailComment,
	decodeTrailComments,
	decodeTrailDetail,
	decodeTrailFinding,
	decodeTrailFindings,
	decodeTrailList,
	decodeTrailMergePlan,
	decodeTrailProject,
	formatTrailSelector,
} from './trail';
export type {
	Trail,
	TrailApproval,
	TrailChange,
	TrailComment,
	TrailFinding,
	TrailGate,
	TrailList,
	TrailMergePlan,
	TrailProject,
	TrailSelector,
	TrailStatus,
} from './trail';
export {
	cliReason,
	describeTrailFailure,
	isProjectInvisible,
} from './cliFailure';
export {
	describeGrantCommand,
	describeInvisibleProject,
	describeUnseenProject,
	describeVisibilityChoices,
	parseProjectReference,
} from './projectVisibility';
export type {
	ProjectKind,
	ProjectReference,
	ProjectVisibility,
	VisibilityChoice,
} from './projectVisibility';
export {
	attributeApproval,
	attributeComment,
	describeChange,
	describeCheckoutRefusal,
	describeMergeBlockers,
	describeMergePlan,
	describeSelector,
	isAttributedTo,
	refuseCheckoutForUnsavedWork,
	refusesCommentFromAgentSession,
} from './trailReview';
export type {
	ApprovalAttribution,
	CheckoutRefusal,
	UnsavedFile,
} from './trailReview';
export {
	changePicks,
	describePick,
	describePickDetail,
	picksForTrail,
	trailPicks,
} from './trailPick';
export type { TrailPick } from './trailPick';
export { describeGate, pendingApprovals, readTrailGate, scopeToProject } from './trailGate';
export type { GatedChange, GatedTrail, TrailListing } from './trailGate';
export { sessionRows } from './sessionDetailRows';
export type { DetailRow, SessionSnapshot, ToolCallState, UsageState } from './sessionDetailRows';
export {
	buildActivitySessionDetail,
	buildChangeDetail,
	buildCommitDetail,
	buildRepositoryDetail,
	buildSessionDetail,
	buildTrailDetail,
	describeGone,
	describeViewerNote,
	detailTitle,
	formatClock,
	initialDetail,
	isFresh,
	isGoneFailure,
	isSelection,
	isSelectionSource,
	lifetimeSeconds,
	selectionKey,
	unavailableRow,
	viewOfKey,
	withRow,
} from './selection';
export type { DetailModel, Selection, SelectionSource, ShownTrail, ViewerState } from './selection';
export { renderDetailDocument } from './detailDocument';
export { asChangePick, asTrailPick, pickFromTarget, touchedKeys } from './trailTarget';
