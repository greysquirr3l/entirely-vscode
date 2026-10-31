# Entirely coverage against the Entire documentation

What Entire documents, against what this extension does with it.

**Derived against.** Entire CLI 0.12.2 (`entire version`), on 2026-10-30.

**Documentation source.** Entire's own LLM documentation, pulled from
`https://docs.entire.com/llms.txt` and `https://docs.entire.com/llms-full.txt`
on 2026-10-28 and pulled again on 2026-10-30. The two pulls list the same 40
`cli-reference` pages and the same headings; the only text that changed is a
pair of banner notes. The command inventory was also taken from the installed
CLI (`entire help -t`), which lists every visible command. The documentation
adds the commands the CLI hides or ships as plugins (`why`, `blame`, `import`,
`review`, `tokens`, `experts`, `runner`, `mcp`, `completion`, `graph`,
`investigate`, `brain`).

**How the extension's side was established.** By reading `src/`, not the
README. Every CLI invocation the extension can make is in section 1.

**Marks.**

| Mark | Meaning |
| --- | --- |
| Supported | The extension calls it, a user can reach it from the editor, and a test in this repository covers it. The evidence column names the command id or source file and the test. |
| Excluded | A decision: the extension deliberately does not do it. The notes say why. |
| Gap | Not done, and no decision to leave it out. Listed in section 3. |

**Totals.** Rows: 142 (supported 103, excluded 14, gap 25).

The totals line is read by `src/test/coverage.test.ts`, which fails when it
disagrees with the table.

---

## 1. The extension's CLI surface

Every `entire` invocation the extension can make. A test scans `src/` and
fails when a call to a command the matrix knows has no row here, and when a
row names a command its callers never build.

| CLI invocation | Called from | What it is for |
| --- | --- | --- |
| `entire status` | `src/services/statusController.ts`, `src/extension.ts`, `src/commands/doctor.ts`, `src/commands/checkpointDestination.ts` | Whether the workspace is tracked |
| `entire version` | `src/services/cli/locator.ts` | Finding the CLI and checking its version |
| `entire agent-help` | `src/services/cli/runner.ts` | Reading a command's flags at runtime |
| `entire enable` | `src/services/setup.ts` | Set Up Entire |
| `entire doctor` | `src/services/cliDoctor.ts` | The CLI's own capture-pipeline report |
| `entire doctor logs` | `src/lib/entire/doctorFlags.ts`, `src/services/doctorDepth.ts` | The last lines of the CLI's operational log |
| `entire doctor trace` | `src/lib/entire/doctorFlags.ts`, `src/services/doctorDepth.ts` | Hook timing traces |
| `entire doctor bundle` | `src/lib/entire/doctorFlags.ts`, `src/services/doctorDepth.ts` | A diagnostic bundle written to a path the person chose |
| `entire doctor migrate-checkpoints` | `src/lib/entire/doctorFlags.ts`, `src/services/checkpointMigration.ts` | A dry run, then the migration to per-checkpoint git refs |
| `entire disable` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | Disable Capture |
| `entire disable --uninstall` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | Remove Entire from This Repository |
| `entire configure` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | Configure Entire Settings |
| `entire clean` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | Clean Session Data |
| `entire clean --dry-run` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | The preview shown before a clean |
| `entire runner setup` | `src/lib/entire/captureFlags.ts`, `src/services/captureControl.ts` | Set Up Trail Runners |
| `entire hooks` | `src/services/hookBridge.ts` | Reporting editor-side agent activity |
| `entire agent list` | `src/services/agentIntegrations.ts` | Installed agent integrations |
| `entire agent add` | `src/lib/entire/agents.ts` | Installing an agent integration |
| `entire agent remove` | `src/lib/entire/agents.ts` | Removing an agent integration |
| `entire trail list` | `src/services/trailService.ts` | The Trails view |
| `entire trail show` | `src/services/trailService.ts` | One trail and its changes |
| `entire trail approvals` | `src/services/trailService.ts` | Who approved a change |
| `entire trail approve` | `src/services/trailService.ts` | Approving a change |
| `entire trail comment add` | `src/services/trailService.ts` | Commenting on a change |
| `entire trail comment list` | `src/services/trailService.ts` | Reading a change's comments |
| `entire trail finding add` | `src/services/trailService.ts` | Posting a finding from an agent session |
| `entire trail finding list` | `src/services/trailService.ts` | Reading a change's findings |
| `entire trail merge` | `src/services/trailService.ts` | A dry run, then the merge |
| `entire trail checkout` | `src/services/trailService.ts` | Checking out a change's branch |
| `entire trail link` | `src/services/trailService.ts` | Linking a branch to a trail |
| `entire trail unlink` | `src/services/trailService.ts` | Unlinking a branch from a trail |
| `entire trail create` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailAuthoring.ts` | Creating a trail, after a question |
| `entire trail update` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailAuthoring.ts` | Changing a trail's fields and assignees |
| `entire trail watch` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailWatch.ts` | One owned process per watched change |
| `entire trail comment show` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDepthReads.ts` | One discussion and its messages |
| `entire trail comment reply` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDiscussions.ts` | Replying to a discussion |
| `entire trail comment edit` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDiscussions.ts` | Editing one's own message |
| `entire trail comment delete` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDiscussions.ts` | Deleting a message, after a question |
| `entire trail comment resolve` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDiscussions.ts` | Resolving a discussion |
| `entire trail comment unresolve` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailDiscussions.ts` | Reopening a discussion |
| `entire trail finding show` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | The CLI's text for a finding |
| `entire trail finding apply` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | Checking, then applying a finding's suggestion |
| `entire trail finding dismiss` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | Dismissing a finding |
| `entire trail finding reopen` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | Reopening a finding |
| `entire trail finding resolve` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | Resolving a finding |
| `entire trail finding update` | `src/lib/entire/trailDepthFlags.ts`, `src/services/trailFindings.ts` | Changing a finding's body, severity or confidence |
| `entire session list` | `src/services/sessionSource.ts`, `src/services/checkpointSource.ts` | The session tree |
| `entire session current` | `src/services/sessionSource.ts` | The workspace's own session |
| `entire session info` | `src/services/sessionDetail.ts` | Session detail and transcript |
| `entire session tokens` | `src/services/tokenUsage.ts` | Session token usage |
| `entire session stop` | `src/lib/entire/sessionLifecycle.ts` | Ending a session |
| `entire session attach` | `src/lib/entire/sessionLifecycle.ts` | Linking a session to a commit |
| `entire session adopt` | `src/lib/entire/sessionLifecycle.ts` | Adopting a session from another worktree |
| `entire session resume` | `src/lib/entire/sessionLifecycle.ts` | Resuming a branch's session in a terminal |
| `entire checkpoint list` | `src/services/checkpointSource.ts` | The checkpoint tree |
| `entire checkpoint explain` | `src/services/checkpointSource.ts` | Explain Checkpoint |
| `entire checkpoint tokens` | `src/services/tokenUsage.ts` | Checkpoint token usage |
| `entire checkpoint search` | `src/lib/entire/search.ts` | Filtering the checkpoint tree |
| `entire search` | `src/lib/entire/workSearchFlags.ts` | Searching past work and code |
| `entire why` | `src/services/whyService.ts` | Why Does This Line Exist |
| `entire blame` | `src/lib/entire/blame.ts` | Blame the active file |
| `entire tokens` | `src/lib/entire/tokenProfile.ts` | The group that holds `tokens profile`; it has no behaviour of its own |
| `entire tokens profile` | `src/lib/entire/tokenProfile.ts`, `src/services/tokenProfile.ts` | Show Token Profile over committed checkpoint history |
| `entire experts` | `src/lib/entire/experts.ts`, `src/services/experts.ts` | Who has touched a path, a question or the staged files |
| `entire review` | `src/lib/entire/review.ts`, `src/services/review.ts` | Review profiles, what a review would run, saved findings, and the confirmed run in a terminal |
| `entire import` | `src/lib/entire/importHistory.ts` | Importing past agent history |
| `entire login` | `src/services/authentication.ts` | Signing in |
| `entire logout` | `src/services/authentication.ts` | Signing out |
| `entire auth status` | `src/services/authentication.ts` | Whether a login is valid |
| `entire auth contexts` | `src/services/accountContext.ts` | The saved logins |
| `entire repo view` | `src/services/checkpointDestination.ts`, `src/services/trailService.ts` | Where checkpoints go |
| `entire repo list` | `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire repo create` | `src/lib/entire/controlPlaneFlags.ts` | Create Repository |
| `entire repo edit` | `src/lib/entire/controlPlaneFlags.ts` | Set Repository Visibility |
| `entire repo delete` | `src/lib/entire/controlPlaneFlags.ts` | Delete Repository |
| `entire repo grant list` | `src/lib/entire/controlPlaneFlags.ts` | Who holds access to a repository |
| `entire repo grant add` | `src/lib/entire/controlPlaneFlags.ts` | Grant Access |
| `entire repo grant remove` | `src/lib/entire/controlPlaneFlags.ts` | Revoke Access |
| `entire repo mirror list` | `src/services/checkpointDestination.ts` | Whether the CLI can reach the checkpoint repository |
| `entire org list` | `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire org delete` | `src/lib/entire/controlPlaneFlags.ts` | Delete Organisation |
| `entire org grant list` | `src/lib/entire/controlPlaneFlags.ts` | Who holds access to an organisation |
| `entire org grant add` | `src/lib/entire/controlPlaneFlags.ts` | Grant Access |
| `entire org grant remove` | `src/lib/entire/controlPlaneFlags.ts` | Revoke Access |
| `entire project list` | `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire project delete` | `src/lib/entire/controlPlaneFlags.ts` | Delete Project |
| `entire project grant list` | `src/lib/entire/controlPlaneFlags.ts` | Who holds access to a project |
| `entire project grant add` | `src/lib/entire/controlPlaneFlags.ts` | Grant Access |
| `entire project grant remove` | `src/lib/entire/controlPlaneFlags.ts` | Revoke Access |
| `entire cluster list` | `src/services/controlPlane.ts`, `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire api` | `src/lib/entire/controlPlaneFlags.ts` | The one controlled API call |
| `entire activity` | `src/lib/entire/activityFlags.ts` | The activity view |
| `entire recap` | `src/lib/entire/activityFlags.ts` | Show Recap |
| `entire dispatch` | `src/lib/entire/dispatchActions.ts` | Generate Dispatch |
| `entire plugin list` | `src/services/plugins.ts` | Installed plugins |
| `entire plugin install` | `src/lib/entire/plugins.ts` | Install Plugin |
| `entire mcp` | `src/services/mcpServer.ts` | The MCP server offered to the editor's agent |
| `entire graph` | `src/lib/entire/integrations.ts` | A documented plugin, suggested by default and run by name |
| `entire investigate` | `src/lib/entire/integrations.ts` | A documented plugin, suggested by default and run by name |
| `entire brain` | `src/lib/entire/integrations.ts` | A documented plugin, suggested by default and run by name |

Plugin commands are run by name through `entirely.runPluginCommand`
(`pluginArguments` in `src/lib/entire/plugins.ts`). The name comes from the
user, so any installed plugin can run; the CLI's built-in names are refused.
The three rows below are the plugins the documentation names.

---

## 2. The matrix

### Setup and lifecycle

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire enable` | Supported | `entirely.setUp`, `src/services/setup.ts`, `src/test/onboarding.test.ts`, `src/test/hookBridgeE2e.test.ts` | Non-interactive only: the agent is picked from `entire agent list`, passed with `--no-init-repo`. The CLI's interactive flow needs a terminal. Tested in part: `onboarding.test.ts` covers argument building (`enableArguments`) against a stub runner, and `hookBridgeE2e.test.ts` runs `entire enable --agent copilot-cli --no-init-repo` through the runner against the installed CLI (it skips when the CLI is absent). No test runs `enableEntire` itself. |
| `entire disable` | Supported | `entirely.disableCapture`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Turns Entire off and removes nothing. The person picks the settings file (this checkout or the shared one), then a modal names the folder, the file, the live sessions, the acting login and that the change is local to this checkout. The CLI runs once as that login, and a fresh `status --json` decides between done and unconfirmed; a status that still reports Entire as enabled is unconfirmed, never done. Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire disable --uninstall` | Supported | `entirely.uninstallEntire`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Removes Entire completely. The CLI offers no preview, and the modal says so, lists what the help says is removed, names the hook files found in the workspace and needs the folder name typed. The skip-confirmation flag, read from the help, is passed only after that. A fresh read of status, the `.entire` directory and the hook files decides done, unconfirmed or failed, and a partial failure lists what remains. Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire configure` | Supported | `entirely.configureEntire`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Writes only the settings the person ticked, to the settings file they chose, in one call. The result is read back from the settings files: telemetry, absolute hook path, checkpoint remote and checkpoint backend are verified by name, the rest are reported as written and not readable back, and a missing or overridden value is unconfirmed. User-level settings are not written (no flag documents them). Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire clean` | Supported | `entirely.cleanSessionData`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | The CLI's own dry run is shown first and the clean is confirmed afterwards, naming the folder, scope, live sessions and login. The skip-confirmation flag also overrides the CLI's live-session guard, so it is passed only after the modal, which has a Delete anyway button when a live session is in scope. Verified against a fresh session list. Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire clean --dry-run` | Supported | `entirely.cleanSessionData`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | The preview. It deletes nothing and asks nothing; its text opens in a read-only document and stays out of the output channel. A CLI whose help lacks the preview flag gets the typed-confirmation path and the plain statement that there is no preview. Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire runner setup` | Supported | `entirely.setUpRunners`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | The help documents non-interactive forms, so it is not interactive-only. The defaults-only form calls no summary provider; printing the tailoring prompt creates missing default files; a preview and a tailoring send repository signals to the configured summary provider, so each is a separate modal. The runner files under `.entire/runners` are listed before and after. The debug-directory flag is never passed, and `runner` is not in `agent-help`, so its flags come from `runner setup --help`. Tested only against a fake `entire` (`src/test/support/captureCli.ts`) built from the 0.12.2 help text; the command itself was never run against the real CLI, so its real output and exit codes are unobserved. |
| `entire status` | Supported | `src/services/statusController.ts`, `src/test/statusBar.test.ts`, `src/test/cli.test.ts` | The status bar and the doctor report. `statusBar.test.ts` (suite "Entire status controller and the acting login") runs `StatusController` against a fake CLI that answers `status`; `cli.test.ts` runs the runner against a fake CLI for the same call. |
| `entire version` | Supported | `src/services/cli/locator.ts`, `src/test/cli.test.ts`, `src/test/cliVersion.test.ts` | `cli.test.ts` runs the locator against fake CLIs that answer `version`; `cliVersion.test.ts` covers parsing and comparison only. |
| `entire doctor` | Supported | `entirely.showCliDoctorOutput`, `src/services/cliDoctor.ts`, `src/test/cliDoctor.test.ts` | The bare report, read-only. The fix prompts need a terminal. |
| `entire doctor bundle` | Supported | `entirely.writeDiagnosticBundle`, `entirely.writeRawDiagnosticBundle`, `src/services/doctorDepth.ts`, `src/test/doctorBundle.test.ts` | Written only to a path the person chose and checked (absolute, `.zip`, existing folder, no link, not inside `.git` or `.entire`), after a notice of what the archive holds, written by the CLI to a hidden temporary `.zip` beside it, read back through one open handle, and moved into place (rename when replacing was confirmed, an exclusive link otherwise); the temporary file is removed on every failure. The real CLI's acceptance of a hidden `.entirely-<random>.zip` name for its output path has not been observed. If it refuses or ignores that name, the command reports a failure or "unconfirmed", removes the temporary file, and places nothing at the chosen path. Secret redaction stays on; the unredacted bundle is a separate command with its own modal. Tested against a fake CLI only; the real CLI's output formats were not observed, and the real subcommand was not run. Not exposed: opening the archive in the editor. |
| `entire doctor logs` | Supported | `entirely.showCliLog`, `src/services/doctorDepth.ts`, `src/test/doctorDepth.test.ts` | The last lines open in a read-only document with Copy; a long log is cut to `entirely.doctorOutputMaxKilobytes` and can be saved whole. Tested against a fake CLI only; the real CLI's output formats were not observed, and the real subcommand was not run. `--follow` not exposed (it never ends; run it in a terminal), and `--tail 0` is never sent. |
| `entire doctor migrate-checkpoints` | Supported | `entirely.migrateCheckpoints`, `src/services/checkpointMigration.ts`, `src/test/migrateCheckpoints.test.ts` | The dry run opens first; the migration is confirmed naming the repository and the acting login, runs once with no flag, and is checked by counting `refs/entire/checkpoints/` before and after (a real git repository in a temporary folder). Tested against a fake CLI only; the real CLI's output formats were not observed, and the real subcommand was not run. `--remote` not exposed, so the extension never pushes. |
| `entire doctor trace` | Supported | `entirely.showHookTraces`, `src/services/doctorDepth.ts`, `src/test/doctorDepth.test.ts` | The latest trace, the last N, a summary or the slow ones, with an optional hook filter; each option is offered only when the CLI's help describes it. Tested against a fake CLI only; the real CLI's output formats were not observed, and the real subcommand was not run. `--json` not exposed. |
| `entire import` | Supported | `entirely.importHistory`, `src/services/historyImport.ts`, `src/test/historyImport.test.ts` | A preview first, then the import. The CLI marks it experimental. One agent at a time, with the agent read from the CLI's help. |
| `entire agent-help` | Supported | `src/services/cli/runner.ts`, `src/test/cli.test.ts` | How the extension reads every command's flags at runtime. The test runs `runner.usage` against a fake CLI that answers `agent-help`. |
| `entire hooks` | Supported | `src/services/hookBridge.ts`, `src/test/hookBridge.test.ts` | `entire hooks <agent> <verb>`; the CLI marks it internal. The bridge reports editor events for one configured agent. Tested with a stub runner that records the arguments; the CLI is not run. |
| `entire labs` | Excluded | | Prints the list of experimental commands. Each of those commands has its own row, so the index adds nothing to the editor. |

### Agent integrations

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire agent list` | Supported | `entirely.manageAgents`, `src/services/agentIntegrations.ts`, `src/test/agentIntegrations.test.ts` | |
| `entire agent add` | Supported | `entirely.manageAgents`, `src/lib/entire/agents.ts`, `src/test/agentIntegrations.test.ts` | |
| `entire agent remove` | Supported | `entirely.manageAgents`, `src/lib/entire/agents.ts`, `src/test/agentIntegrations.test.ts` | |

### Sessions

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire session list` | Supported | `entirely.showSessions`, `src/services/sessionSource.ts`, `src/test/sessionDetail.test.ts`, `src/test/historyImport.test.ts` | `sessionDetail.test.ts` runs `createSessionSource` against a fake CLI; `historyImport.test.ts` runs the `session list` read in `checkpointSource.ts`. `sessions.test.ts` covers grouping and rendering only, so it is not cited. |
| `entire session current` | Supported | `entirely.showOwnSession`, `src/services/sessionSource.ts`, `src/test/sessionDetail.test.ts` | Run through `createSessionSource` against a fake CLI (suite "Entire current-session filter"). |
| `entire session info` | Supported | `entirely.selectSession`, `entirely.openTranscript`, `src/services/sessionDetail.ts`, `src/test/sessionDetail.test.ts` | Detail and transcript. |
| `entire session tokens` | Supported | `entirely.selectSession`, `src/services/tokenUsage.ts`, `src/test/tokenUsage.test.ts` | |
| `entire session stop` | Supported | `entirely.stopSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session attach` | Supported | `entirely.attachSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session adopt` | Supported | `entirely.adoptSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session resume` | Supported | `entirely.resumeSession`, `src/services/sessionResume.ts`, `src/test/sessionLifecycle.test.ts` | Runs in an editor terminal; the CLI needs one. The test asserts the arguments and the terminal launch with a stub launcher; the CLI is not run. |

### Checkpoints and provenance

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire checkpoint list` | Supported | `src/services/checkpointSource.ts`, `src/test/historyImport.test.ts` | Run through `createCheckpointSource` against a fake CLI. `checkpoints.test.ts` does not run the call, so it is not cited. |
| `entire checkpoint explain` | Supported | `entirely.explainCheckpoint`, `src/services/checkpointSource.ts`, `src/test/security.test.ts` | Argument building only: `security.test.ts` calls `createCheckpointDetailSource` with a recording runner and asserts `checkpoint explain --json -- <id>`. No test runs it against a fake CLI. `checkpoints.test.ts` does not run it, so it is not cited. |
| `entire checkpoint tokens` | Supported | `src/services/tokenUsage.ts`, `src/test/tokenUsage.test.ts` | |
| `entire checkpoint search` | Supported | `entirely.searchCheckpoints`, `src/services/checkpointSearch.ts`, `src/test/checkpointSearch.test.ts` | |
| `entire checkpoint delete` | Gap | | Destructive, and would need the same confirmation care as the control-plane deletes. |
| `entire search` | Supported | `entirely.searchWork`, `src/services/workSearch.ts`, `src/test/workSearch.test.ts` | Work search and `--code` search. |
| `entire why` | Supported | `entirely.whyThisLine`, `src/services/whyService.ts`, `src/test/why.test.ts` | Tested with a stub runner that records the arguments; the CLI is not run. |
| `entire blame` | Supported | `entirely.blameFile`, `src/services/blameService.ts`, `src/test/blame.test.ts` | Tested with a stub runner that records the arguments; the CLI is not run. |
| `entire review` | Supported | `entirely.reviewRun`, `src/services/review.ts`, `src/test/review.test.ts`, `src/test/reviewRun.test.ts` | Three read-only views (`--list`, `--show-config --json`, `--findings`) run through `ReviewService` against a fake CLI with no confirmation. A run asks first, in a modal that names the profile, branch, acting login and cost, then opens one terminal as that login (`reviewRun.test.ts` uses a fake terminal; no review process was started, so what the real CLI does with a piped run is unobserved). Flags are read from `review --help` because `agent-help` does not know the command. Observed against the real CLI 0.12.2: `--list` with no profile, `--show-config --json` (the fixture is copied from it) and `--findings` with none saved. Not observed: `--list` with a configured profile, `--findings` with saved runs, and any run. The flags the extension does not drive are in the rows below. |
| `entire review --configure` | Excluded | | An interactive wizard that chooses agents, models and where a verdict goes. `entirely.reviewSetup` opens it in a terminal after asking, for the person to complete; the extension writes no profile. |
| `entire review --edit` | Excluded | | An interactive picker that changes a saved profile. It needs a terminal and the person's choices. |
| `entire review --set-*` | Excluded | | Flags that write a profile non-interactively (agents, judge, output, task, models, slots, config). The extension never passes one; a test asserts none appears in any argument list. |
| `entire review --trust-target` | Excluded | | Approves loading the hooks and MCP servers of code the person did not write. Only the person, in a terminal, may decide it. The extension shows the CLI's refusal as written and never adds the flag. |
| `entire review --agents` | Excluded | | Lists the reviewer agents and may start agent programs to do it, so it was not run and is not offered. Available in a terminal. |
| `entire review --models` | Excluded | | Lists the models each agent advertises and may start agent programs to do it, so it was not run and is not offered. Available in a terminal. |
| `entire experts` | Supported | `entirely.expertsForPath`, `src/services/experts.ts`, `src/test/experts.test.ts` | For a path, a typed question or the staged files, as a read-only document that names the repository, branch and acting login and says the question goes to Entire's servers. Tested against a fake CLI only: the real command sends the query to Entire, so it was never run, and neither the `--json` entry shape nor the error text for a repository that is not mirrored was observed. The decoder is tolerant and the raw reply opens through `entirely.showExpertsRawReply`. |
| `entire experts --tui` | Excluded | | An interactive viewer that needs a terminal. The extension always asks for JSON. |
| `entire tokens` | Supported | `entirely.tokenProfile`, `src/services/tokenProfile.ts`, `src/test/tokenProfile.test.ts` | The group has the single subcommand `profile` and prints only help, so it is reached through `tokens profile`. |
| `entire tokens profile` | Supported | `entirely.tokenProfile`, `src/services/tokenProfile.ts`, `src/test/tokenProfile.test.ts` | Reads committed checkpoint metadata only (no tokens spent, nothing written). The JSON was observed against the real CLI 0.12.2 and the fixture is copied from it; the service is run against a fake CLI. Counts the CLI leaves out read "Not reported", never zero, and the CLI's signals, recommendations and limitations are kept in its words. The exit code for an empty history was not observed. |

### Identity, login and accounts

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire login` | Supported | `entirely.signIn`, `src/services/authentication.ts`, `src/test/authentication.test.ts` | Including `--device` and `--server`. |
| `entire logout` | Supported | `entirely.signOut`, `src/services/authentication.ts`, `src/test/authentication.test.ts` | Warns that every saved login is signed out. |
| `entire auth login` | Supported | `entirely.signIn`, `src/services/authentication.ts`, `src/test/authentication.test.ts` | The documentation calls it equivalent to `entire login`; the extension runs the top-level form, so this row is an alias of the `entire login` row (the check reads that phrase and looks for `login`) and the test asserts the `login` invocation. |
| `entire auth logout` | Supported | `entirely.signOut`, `src/services/authentication.ts`, `src/test/authentication.test.ts` | Same: an alias of the `entire logout` row; the extension runs `entire logout`, and the test asserts that invocation. |
| `entire auth status` | Supported | `src/services/authentication.ts`, `src/test/authentication.test.ts` | |
| `entire auth contexts` | Supported | `src/services/accountContext.ts`, `src/test/accountContext.test.ts` | Read on refresh to name the acting login. |
| `entire auth switch` | Excluded | | It changes the CLI's active login for every tool on the machine. The extension pins a login for itself with `entirely.cliContext` instead and never changes the global one. |
| `entire auth token` | Excluded | | It prints a bearer credential. The extension never displays, logs or stores a token. |
| `--context` and `ENTIRE_CONTEXT` | Supported | `entirely.cliContext`, `src/services/cli/runner.ts`, `src/test/accountContext.test.ts` | Both are passed, because only the environment variable reaches plugin commands. |

### The control plane

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire org list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org create` | Gap | | |
| `entire org get` | Gap | | The tree shows what `list` returns. |
| `entire org delete` | Supported | `entirely.deleteOrganisation`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org invite list` | Gap | | |
| `entire org invite revoke` | Gap | | |
| `entire org invite send` | Gap | | |
| `entire org grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Run through `revokeAccess` against the fake CLI; the test asserts the single `org grant remove` call and the list re-check. |
| `entire project list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project create` | Gap | | |
| `entire project get` | Gap | | |
| `entire project delete` | Supported | `entirely.deleteProject`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo view` | Supported | `entirely.checkpointDestination`, `src/services/checkpointDestination.ts`, `src/test/checkpointDestination.test.ts` | Called to answer where checkpoints go. Run through the destination service against a fake CLI whose `repo` case answers `view`. |
| `entire repo create` | Supported | `entirely.createRepository`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo edit` | Supported | `entirely.setRepositoryVisibility`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Visibility only. |
| `entire repo delete` | Supported | `entirely.deleteRepository`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo clone` | Gap | | |
| `entire repo grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo mirror list` | Supported | `entirely.checkpointDestination`, `src/services/checkpointDestination.ts`, `src/test/checkpointDestination.test.ts` | Called only to ask whether the CLI can reach the checkpoint repository. Run through the destination service against a fake CLI whose `repo` case answers `mirror list`. |
| `entire repo mirror add` | Gap | | |
| `entire repo mirror detach` | Gap | | |
| `entire repo mirror remove` | Gap | | |
| `entire repo mirror resync` | Gap | | |
| `entire repo protection add` | Gap | | |
| `entire repo protection list` | Gap | | |
| `entire repo protection remove` | Gap | | |
| `entire repo remote add` | Gap | | |
| `entire repo visibility get` | Gap | | `repo view` already carries the visibility the tree shows. |
| `entire cluster list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Run through `ControlPlaneService.clusters()` against the fake CLI in `src/test/support/controlPlaneCli.ts`; the test asserts the call happened once. The decoder and help tests in the same file do not run it. |
| `entire api` | Supported | `entirely.runApiCall`, `src/services/controlApi.ts`, `src/test/controlPlane.test.ts` | One call at a time, behind a confirmation for anything but GET, no retry, path confined to `/api`. Nothing else uses `api`. |

### Trails, review and investigation

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire trail list` | Supported | `src/services/trailListing.ts`, `src/test/trailSurface.test.ts` | The Trails view. |
| `entire trail show` | Supported | `src/services/trailService.ts`, `src/test/trailSurface.test.ts`, `src/test/support/trailCli.ts` | |
| `entire trail approvals` | Supported | `src/services/trailService.ts`, `src/test/trailSurface.test.ts`, `src/test/support/trailCli.ts` | |
| `entire trail approve` | Supported | `entirely.trailApprove`, `src/test/trailActions.test.ts` | |
| `entire trail checkout` | Supported | `entirely.trailCheckout`, `src/test/trailActions.test.ts`, `src/test/trailReviewFlow.test.ts` | |
| `entire trail comment add` | Supported | `entirely.trailComment`, `src/test/trailActions.test.ts` | |
| `entire trail comment list` | Supported | `src/services/trailService.ts`, `src/test/trailSurface.test.ts`, `src/test/support/trailCli.ts` | |
| `entire trail finding add` | Supported | `entirely.trailComment`, `src/test/trailActions.test.ts` | |
| `entire trail finding list` | Supported | `src/services/trailService.ts`, `src/test/trailSurface.test.ts`, `src/test/support/trailCli.ts` | |
| `entire trail link` | Supported | `entirely.trailLink`, `src/test/trailActions.test.ts`, `src/test/trailReviewFlow.test.ts` | |
| `entire trail unlink` | Supported | `entirely.trailUnlink`, `src/test/trailActions.test.ts`, `src/test/trailReviewFlow.test.ts` | |
| `entire trail merge` | Supported | `entirely.trailMerge`, `src/test/trailActions.test.ts`, `src/test/trailReviewFlow.test.ts` | A dry run first; the gate is read from it. |
| `entire trail create` | Supported | `entirely.trailCreate`, `src/test/trailAuthoring.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first; publishes the branch. Reported only when a fresh list holds one new trail with the title. Verified against a fake CLI only. |
| `entire trail update` | Supported | `entirely.trailUpdate`, `src/test/trailAuthoring.test.ts`, `src/test/support/trailDepthCli.ts` | Closing or replacing the assignee list asks first. Verified against a fake CLI only. |
| `entire trail watch` | Supported | `entirely.trailWatch`, `src/test/trailWatch.test.ts`, `src/test/cliStream.test.ts` | One owned process per change, stopped by the user or on deactivation, never polled. Verified against a fake CLI only. |
| `entire trail resume` | Excluded | | Entire's documentation says a non-interactive run shows the same context and prints the resume commands, so interactivity is only the default, not the reason. The reason is that `entire session resume` already covers the editor use case: `entirely.resumeSession` (`src/services/sessionResume.ts`) resumes a branch's session in an editor terminal. |
| `entire trail comment delete` | Supported | `entirely.trailDeleteMessage`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first, with the strictest wording. Verified against a fake CLI only. |
| `entire trail comment edit` | Supported | `entirely.trailEditMessage`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Only the acting login's messages are offered. Verified against a fake CLI only. |
| `entire trail comment reply` | Supported | `entirely.trailReplyToDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Read back under the acting handle. Verified against a fake CLI only. |
| `entire trail comment resolve` | Supported | `entirely.trailResolveDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Verified against a fake CLI only. |
| `entire trail comment show` | Supported | `entirely.trailShowDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | The shape of the answer was not observed on the real CLI, so it is read tolerantly. Verified against a fake CLI only. |
| `entire trail comment unresolve` | Supported | `entirely.trailReopenDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Verified against a fake CLI only. |
| `entire trail finding apply` | Supported | `entirely.trailApplyFinding`, `src/test/trailApplyFinding.test.ts`, `src/test/support/trailDepthCli.ts` | Refused with unsaved work; the check runs first and the person confirms. Verified against a fake CLI only. |
| `entire trail finding dismiss` | Supported | `entirely.trailDismissFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first for a high-severity finding. Verified against a fake CLI only. |
| `entire trail finding reopen` | Supported | `entirely.trailReopenFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Verified against a fake CLI only. |
| `entire trail finding resolve` | Supported | `entirely.trailResolveFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Verified against a fake CLI only. |
| `entire trail finding show` | Supported | `entirely.trailShowFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | The CLI has no JSON form for this one, so its text is shown as printed. Verified against a fake CLI only. |
| `entire trail finding update` | Supported | `entirely.trailUpdateFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Verified against a fake CLI only. |

### Data, plugins and MCP

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire activity` | Supported | `entirely.openActivity`, `src/services/activity.ts`, `src/test/activity.test.ts` | The static output, never the terminal interface. |
| `entire recap` | Supported | `entirely.showRecap`, `src/services/recap.ts`, `src/test/dispatch.test.ts`, `src/test/activity.test.ts` | `dispatch.test.ts` (suite "Entire recap") runs `RecapService` against a fake CLI and feeds `showRecap`; `activity.test.ts` covers flag and argument building only (`recapArguments`, `recapPeriods`, `readCommandFlags`). |
| `entire dispatch` | Supported | `entirely.generateDispatch`, `src/services/dispatch.ts`, `src/test/dispatch.test.ts` | |
| `entire plugin list` | Supported | `entirely.runPluginCommand`, `src/services/plugins.ts`, `src/test/plugins.test.ts` | |
| `entire plugin install` | Supported | `entirely.installPlugin`, `src/services/plugins.ts`, `src/test/plugins.test.ts` | |
| `entire plugin browse` | Gap | | |
| `entire plugin doctor` | Gap | | |
| `entire plugin index update` | Gap | | |
| `entire plugin info` | Gap | | |
| `entire plugin remove` | Gap | | |
| `entire plugin search` | Gap | | |
| `entire plugin upgrade` | Gap | | |
| `entire graph` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | A plugin, run by name with its own arguments. The extension does not model the plugin's subcommands. The Integrations view shows whether it is installed in each folder and installs it from its row (`entirely.installIntegration`). The suggested names are the setting `entirely.suggestedPlugins`. |
| `entire investigate` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | Same: run by name as a plugin, and shown in the Integrations view. |
| `entire brain` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | Same: run by name as a plugin, and shown in the Integrations view. |
| `entire mcp` | Supported | `entirely.startMcpServer`, `src/services/mcpServer.ts`, `src/test/plugins.test.ts` | Offered to the editor as an MCP server; the Integrations view shows it per folder and can add it to a project's `.mcp.json` (`entirely.addMcpToProject`, `src/test/integrations.test.ts`). The test probes a fake CLI and starts the launch line it returns, then speaks JSON-RPC to it; the real `entire mcp` is not run. |

### Not editor concerns

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire help` | Excluded | | The command tree is read through `agent-help`, which always matches the installed CLI. A help screen has no place in the editor. |
| `entire completion` | Excluded | | Shell completion scripts. VS Code's terminal and the user's shell setup own them. |
| `entire global-flags` | Excluded | | The documentation page for the flags themselves. `--context` has its own row; `--help` and `--version` need no editor surface. |

---

## 3. Gaps, by what they cost the user

Nothing below is excluded. Each is a capability the CLI has and the editor does not.

1. **Checkpoint deletion.** `checkpoint delete`.
2. **Control plane breadth.** Create and read for organisations and projects (`org create`, `org get`, `project create`, `project get`), organisation invitations (`org invite list`, `revoke`, `send`), and the repository commands `clone`, `mirror add`, `mirror detach`, `mirror remove`, `mirror resync`, `protection add`, `protection list`, `protection remove`, `remote add`, `visibility get`.
3. **Plugin management.** `plugin browse`, `doctor`, `index update`, `info`, `remove`, `search`, `upgrade`. Only `list` and `install` are wired.

---

## 4. Keeping this document honest

This is a snapshot, and the checks below keep it from drifting.

- `src/test/coverage.test.ts` fails when a CLI call in `src/` names a command
  the matrix knows and section 1 has no row for it, when a section 1 row names
  a command that its callers never build, when the totals line disagrees with
  the table, when a supported row cites a file or command id that does not
  exist, and when an excluded row has no reason.
- It also fails when a supported row's cited test file does not mention the
  row's command words. A file mentions them if it has them in order as quoted
  strings (`'session', 'list'`) or as a phrase (`session list`), or, for a
  fake CLI written as nested shell cases, each word as a case label
  (`session)` ... `list)`). This catches a citation of a file that never
  names the command. It does not prove the test runs the call: a stub runner
  or an argument builder also passes. The Notes column says which, for every
  row where the test covers only part.
- When the installed CLI is present, it fails if `entire help -t` lists a
  command the matrix lacks. That check runs only where `entire` is installed
  and skips on a machine or CI runner without it.
- The scan of `src/` for CLI calls reads literal arrays such as
  `['session', 'list']`. It does not see calls built from variables or
  template strings (the control plane builds `[group, 'list']` and
  `${scope} grant add`); the reverse check, that each section 1 row's words
  appear quoted in its cited callers, is what covers those.
- After an Entire release, pull `llms.txt` and `llms-full.txt` again, diff
  the `cli-reference` pages against the matrix, and update the version and
  date at the top.

A gap is not a failure of this audit. It is a finding. Closing one means a
new task, a command in `package.json`, a service, a test, and a move of the
row from Gap to Supported.
