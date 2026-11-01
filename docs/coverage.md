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

**Observed against the real CLI.** On 2026-11-01 the CLI 0.12.2 was run in
a throwaway repository: a copy of this checkout's refs, its session state and
its settings, with the checkpoint remote pointed at a local bare repository so
that nothing could reach the forge, and with a read-only `origin` so that the
commands which read a project could be run. Every command the extension
builds was run in the form the extension builds it, and its output was fed to
the extension's own decoder. A row that says "observed" had its command run
and its output decoded. The rows that cannot say so are the ones that would
change something outside the throwaway repository: the trail commands write
to a real project on Entire, `org grant remove` takes a grant away from a
real organization, `login` and `logout` change the account, `runner setup`
writes the agent's own configuration files, and `disable --uninstall` removes
the agent integration from the machine rather than from the repository. Those
are listed in section 3 as the cost of not having run them.

**Marks.**

| Mark | Meaning |
| --- | --- |
| Supported | The extension calls it, a user can reach it from the editor, and a test in this repository covers it. The evidence column names the command id or source file and the test. |
| Excluded | A decision: the extension deliberately does not do it. The notes say why. |
| Gap | Not done, and no decision to leave it out. Listed in section 3. |

**Totals.** Rows: 142 (supported 127, excluded 15, gap 0).

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
| `entire checkpoint delete` | `src/lib/entire/checkpointDeletion.ts` | Delete Checkpoint |
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
| `entire repo clone` | `src/lib/entire/controlPlaneBreadth.ts` | Clone a repository from Entire |
| `entire repo mirror add` | `src/lib/entire/controlPlaneBreadth.ts` | Place a repository on a cluster |
| `entire repo mirror detach` | `src/lib/entire/controlPlaneBreadth.ts` | Turn a mirror into a repository of Entire own |
| `entire repo mirror remove` | `src/lib/entire/controlPlaneBreadth.ts` | Take a repository off a cluster |
| `entire repo mirror resync` | `src/lib/entire/controlPlaneBreadth.ts` | Fetch a mirror's changes again |
| `entire repo protection add` | `src/lib/entire/controlPlaneBreadth.ts` | Protect a branch from direct pushes |
| `entire repo protection list` | `src/lib/entire/controlPlaneBreadth.ts` | The branch protection rules of a repository |
| `entire repo protection remove` | `src/lib/entire/controlPlaneBreadth.ts` | Remove a branch protection rule |
| `entire repo remote add` | `src/lib/entire/controlPlaneBreadth.ts` | Point a git remote at Entire |
| `entire repo visibility get` | `src/lib/entire/controlPlaneBreadth.ts` | Whether a repository is public or private |
| `entire org list` | `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire org create` | `src/lib/entire/controlPlaneBreadth.ts` | Create Organisation |
| `entire org get` | `src/lib/entire/controlPlaneBreadth.ts` | One organisation, as the CLI reports it |
| `entire org invite list` | `src/lib/entire/controlPlaneBreadth.ts` | The invitations of an organisation |
| `entire org invite revoke` | `src/lib/entire/controlPlaneBreadth.ts` | Revoke an invitation |
| `entire org invite send` | `src/lib/entire/controlPlaneBreadth.ts` | Invite somebody to an organisation |
| `entire org delete` | `src/lib/entire/controlPlaneFlags.ts` | Delete Organisation |
| `entire org grant list` | `src/lib/entire/controlPlaneFlags.ts` | Who holds access to an organisation |
| `entire org grant add` | `src/lib/entire/controlPlaneFlags.ts` | Grant Access |
| `entire org grant remove` | `src/lib/entire/controlPlaneFlags.ts` | Revoke Access |
| `entire project list` | `src/lib/entire/controlPlaneFlags.ts` | The control plane tree |
| `entire project create` | `src/lib/entire/controlPlaneBreadth.ts` | Create Project |
| `entire project get` | `src/lib/entire/controlPlaneBreadth.ts` | One project, as the CLI reports it |
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
| `entire plugin info` | `src/lib/entire/pluginManagement.ts` | Plugin Info |
| `entire plugin search` | `src/lib/entire/pluginManagement.ts` | Search Plugin Index |
| `entire plugin index update` | `src/lib/entire/pluginManagement.ts` | Update Plugin Index |
| `entire plugin upgrade` | `src/lib/entire/pluginManagement.ts` | Upgrade Plugin, Upgrade All Plugins |
| `entire plugin remove` | `src/lib/entire/pluginManagement.ts` | Remove Plugin |
| `entire plugin doctor` | `src/lib/entire/pluginManagement.ts` | Check Plugins, and a line of the doctor report |
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
| `entire disable` | Supported | `entirely.disableCapture`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Observed against the real CLI 0.12.2: the help describes `--local`, `--project`, `--uninstall` and `--force`, and every picker finds them. `disable --local` was run in a throwaway repository: it printed `Entire is now disabled (.entire/settings.local.json).` and the next `status --json` reported the repository as not set up. |
| `entire disable --uninstall` | Supported | `entirely.uninstallEntire`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Removes Entire completely. The CLI offers no preview, and the modal says so, lists what the help says is removed, names the hook files found in the workspace and needs the folder name typed. The skip-confirmation flag, read from the help, is passed only after that. A fresh read of status, the `.entire` directory and the hook files decides done, unconfirmed or failed, and a partial failure lists what remains. Observed against the real CLI 0.12.2: the help describes `--uninstall` and the flag that skips the confirmation, and the picker finds both. The command itself was not run: it removes the agent integration from the machine, not only from the repository, and a throwaway repository does not make that safe. See section 3. |
| `entire configure` | Supported | `entirely.configureEntire`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Writes only the settings the person ticked, to the settings file they chose, in one call. The result is read back from the settings files: telemetry, absolute hook path, checkpoint remote and checkpoint backend are verified by name, the rest are reported as written and not readable back, and a missing or overridden value is unconfirmed. User-level settings are not written (no flag documents them). Observed against the real CLI 0.12.2: the help describes every flag the extension writes and the picker finds them. `configure --telemetry=false --local` was run in a throwaway repository: it printed `✓ Settings updated (.entire/settings.local.json)`, exited 0, and the setting was in the file afterwards. |
| `entire clean` | Supported | `entirely.cleanSessionData`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | Observed against the real CLI 0.12.2: the help describes `--all`, `--dry-run`, `--force` and `--session`, and every picker finds them. `clean --dry-run` was run in a throwaway repository and printed what it would clean, and how many of those still hold agent work that has not been committed. |
| `entire clean --dry-run` | Supported | `entirely.cleanSessionData`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | The preview. It deletes nothing and asks nothing; its text opens in a read-only document and stays out of the output channel. A CLI whose help lacks the preview flag gets the typed-confirmation path and the plain statement that there is no preview. Observed against the real CLI 0.12.2: the help describes `--dry-run` and the picker finds it. `clean --dry-run` was run in a throwaway repository and printed what it would clean, and how many of those still hold agent work that has not been committed. |
| `entire runner setup` | Supported | `entirely.setUpRunners`, `src/services/captureControl.ts`, `src/test/captureControl.test.ts` | The help documents non-interactive forms, so it is not interactive-only. The defaults-only form calls no summary provider; printing the tailoring prompt creates missing default files; a preview and a tailoring send repository signals to the configured agent and can change files under the user's home directory. The command was not run against the real CLI, because it writes the agent's own configuration files and a throwaway repository does not make that safe. See section 3. |
| `entire status` | Supported | `src/services/statusController.ts`, `src/test/statusBar.test.ts`, `src/test/cli.test.ts` | The status bar and the doctor report. Observed against the real CLI 0.12.2: `status --json` was run in a throwaway repository, enabled and disabled, and decoded by `decodeWorkspaceStatus`. The enabled form carries `enabled`, `agents`, `active_sessions`, `agent_help` and `checkpoint_sync_remote`; the disabled form leaves the last two out, and the decoder reads it as `not-set-up`. |
| `entire version` | Supported | `src/services/cli/locator.ts`, `src/test/cli.test.ts`, `src/test/cliVersion.test.ts` | Observed against the real CLI 0.12.2: `version` prints `Entire CLI 0.12.2` and then the Go version and the OS/arch. `parseCliVersion` reads the first line; the rest is the CLI's own build information. |
| `entire doctor` | Supported | `entirely.showCliDoctorOutput`, `src/services/cliDoctor.ts`, `src/test/cliDoctor.test.ts` | The bare report, read-only. Observed against the real CLI 0.12.2: the report opens with a `✓ Metadata branches: OK` line, then `Git hooks: NOT INSTALLED` with the lines that explain it, then one block per stuck session, and it exits 0. The fix prompts need a terminal. |
| `entire doctor bundle` | Supported | `entirely.writeDiagnosticBundle`, `entirely.writeRawDiagnosticBundle`, `src/services/doctorDepth.ts`, `src/test/doctorBundle.test.ts` | Written only to a path the person chose and checked (absolute, `.zip`, existing folder, no link, not inside `.git` or `.entire`), after a notice of what the archive holds, written by the CLI to a hidden temporary `.zip` beside it, read back through one open handle, and moved into place (rename when replacing was confirmed, an exclusive link otherwise); the temporary file is removed on every failure. Observed against the real CLI 0.12.2: `doctor bundle --out <path>` writes the archive to the path given, a hidden `.entirely-<random>.zip` name included, and prints `Bundle written (redacted): <path>`. The archive holds `logs/entire.log`, `settings/settings.json`, `settings/settings.local.json`, `git-status.txt`, `git-log.txt`, `git-remote.txt`, `entire-refs.txt` and `version.txt`. Not exposed: opening the archive in the editor. |
| `entire doctor logs` | Supported | `entirely.showCliLog`, `src/services/doctorDepth.ts`, `src/test/doctorDepth.test.ts` | The last lines open in a read-only document with Copy; a long log is cut to `entirely.doctorOutputMaxKilobytes` and can be saved whole. Observed against the real CLI 0.12.2: `doctor logs --tail <n>` prints the last lines of the CLI's own log, and the help describes `--tail` and `--follow`, which the picker finds. `--follow` not exposed (it never ends; run it in a terminal), and `--tail 0` is never sent. |
| `entire doctor migrate-checkpoints` | Supported | `entirely.migrateCheckpoints`, `src/services/checkpointMigration.ts`, `src/test/migrateCheckpoints.test.ts` | The dry run opens first; the migration is confirmed naming the repository and the acting login, runs once with no flag, and is checked by counting `refs/entire/checkpoints/` before and after (a real git repository in a temporary folder). Observed against the real CLI 0.12.2: the help describes `--dry-run`, and the picker finds it. With nothing to migrate the CLI says `The git-refs store is already the primary checkpoint store — nothing to migrate.` |
| `entire doctor trace` | Supported | `entirely.showHookTraces`, `src/services/doctorDepth.ts`, `src/test/doctorDepth.test.ts` | The latest trace, the last N, a summary or the slow ones, with an optional hook filter; each option is offered only when the CLI's help describes it. Observed against the real CLI 0.12.2: `doctor trace --help` describes `--last`, `--hook`, `--slow` and `--summary`, and the picker finds all four. The output is the CLI's own: a hook, its duration and its time, then the steps it took and how long each took. `--json` not exposed. |
| `entire import` | Supported | `entirely.importHistory`, `src/services/historyImport.ts`, `src/test/historyImport.test.ts` | A preview first, then the import. The CLI marks it experimental. One agent at a time, with the agent read from the CLI's help. |
| `entire agent-help` | Supported | `src/services/cli/runner.ts`, `src/test/cli.test.ts` | How the extension reads every command's flags at runtime. Observed against the real CLI 0.12.2: every command the extension reads flags from was asked for its help, and every picker found the flags it wanted. One command is hidden from `agent-help` — `tokens profile` answers `unknown command "tokens"` — and the extension reads that one from the command's own `--help` instead. |
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
| `entire session list` | Supported | `entirely.showSessions`, `src/services/sessionSource.ts`, `src/test/sessionDetail.test.ts`, `src/test/historyImport.test.ts` | Observed against the real CLI 0.12.2: `session list --json` was run in a throwaway repository with a copy of this checkout's session state, and decoded by `decodeSessionList`. Each entry carries the session id, the agent, the model, the status, the branch, the worktree path, the times, the turn and checkpoint counts and the last prompt. |
| `entire session current` | Supported | `entirely.showOwnSession`, `src/services/sessionSource.ts`, `src/test/sessionDetail.test.ts` | Observed against the real CLI 0.12.2: `session current --json` was run in a throwaway repository and decoded by `decodeCurrentSession`. |
| `entire session info` | Supported | `entirely.selectSession`, `entirely.openTranscript`, `src/services/sessionDetail.ts`, `src/test/sessionDetail.test.ts` | Detail and transcript. |
| `entire session tokens` | Supported | `entirely.selectSession`, `src/services/tokenUsage.ts`, `src/test/tokenUsage.test.ts` | |
| `entire session stop` | Supported | `entirely.stopSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session attach` | Supported | `entirely.attachSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session adopt` | Supported | `entirely.adoptSession`, `src/services/sessionLifecycle.ts`, `src/test/sessionLifecycle.test.ts` | |
| `entire session resume` | Supported | `entirely.resumeSession`, `src/services/sessionResume.ts`, `src/test/sessionLifecycle.test.ts` | Runs in an editor terminal; the CLI needs one. The test asserts the arguments and the terminal launch with a stub launcher; the CLI is not run. |

### Checkpoints and provenance

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire checkpoint list` | Supported | `src/services/checkpointSource.ts`, `src/test/historyImport.test.ts` | Observed against the real CLI 0.12.2: `checkpoint list --json` was run in a throwaway repository whose checkpoint remote was a local bare repository, and decoded by `decodeCheckpointList`. Each entry carries the checkpoint id, the message, the agent, the date, the session ids and the session count. The list holds the checkpoints of the current branch, so a deleted checkpoint is gone from it, which is what the deletion's read-back relies on. |
| `entire checkpoint explain` | Supported | `entirely.explainCheckpoint`, `src/services/checkpointSource.ts`, `src/test/security.test.ts` | Observed against the real CLI 0.12.2: `checkpoint explain --json -- <id>` was run in a throwaway repository and decoded by `decodeCheckpointDetail`. |
| `entire checkpoint tokens` | Supported | `src/services/tokenUsage.ts`, `src/test/tokenUsage.test.ts` | |
| `entire checkpoint search` | Supported | `entirely.searchCheckpoints`, `src/services/checkpointSearch.ts`, `src/test/checkpointSearch.test.ts` | Observed against the real CLI 0.12.2: the help describes `--json` and `--compact`, and the picker picks both. The compact form is what the decoder reads: each result carries the id, the type, the repository, the branch, the author, the date and the title. Without `--compact` the CLI answers with a different shape, which the extension never asks for. |
| `entire checkpoint delete` | Supported | `entirely.deleteCheckpoint`, `src/lib/entire/checkpointDeletion.ts`, `src/services/checkpointDeletion.ts`, `src/commands/checkpointDeletion.ts`, `src/test/checkpointDeletion.test.ts` | Deleting one checkpoint. The scope is chosen first, the CLI's own `--dry-run` is shown in the modal before anything is asked for, and a deletion that reaches a remote is not confirmed until the full id has been typed. The flags are read from `entire agent-help checkpoint delete` at runtime, and a CLI whose help does not describe them is reported as needing an update. Observed against the real CLI 0.12.2, in a throwaway repository whose checkpoint remote was a local bare repository: the help text, the dry-run's plan, the deletion's outcome, the refusal without `--force`, and the messages for a checkpoint that is not there and for a prefix of an id. The plan is shown as the CLI prints it, cut where it runs long. |
| `entire search` | Supported | `entirely.searchWork`, `src/services/workSearch.ts`, `src/test/workSearch.test.ts` | Observed against the real CLI 0.12.2: the help describes `--json`, `--compact`, `--code`, `--limit` and `--all-repos`. The listing is run as `search --json --compact` and the file search as `search --json --code`, and the CLI refuses the two together: `--compact cannot be used with --code`. Both outputs were decoded by `decodeWorkHits` and `decodeFileHits`. |
| `entire why` | Supported | `entirely.whyThisLine`, `src/services/whyService.ts`, `src/test/why.test.ts` | Observed against the real CLI 0.12.2: the help takes the file and the line as one argument or as `--line`, and the extension uses `--line`; `why --json --line 42 -- <file>` was run in a throwaway repository and decoded by `decodeWhyAnswer`, which reads the commit the line came from. |
| `entire blame` | Supported | `entirely.blameFile`, `src/services/blameService.ts`, `src/test/blame.test.ts` | Tested with a stub runner that records the arguments; the CLI is not run. |
| `entire review` | Supported | `entirely.reviewRun`, `src/services/review.ts`, `src/test/review.test.ts`, `src/test/reviewRun.test.ts` | Not run against the real CLI: a review spawns real agents against a project and costs real model calls, and the throwaway repository has no project to review. The help was read and the flags the extension offers were found in it. |
| `entire review --configure` | Excluded | | An interactive wizard that chooses agents, models and where a verdict goes. `entirely.reviewSetup` opens it in a terminal after asking, for the person to complete; the extension writes no profile. |
| `entire review --edit` | Excluded | | An interactive picker that changes a saved profile. It needs a terminal and the person's choices. |
| `entire review --set-*` | Excluded | | Flags that write a profile non-interactively (agents, judge, output, task, models, slots, config). The extension never passes one; a test asserts none appears in any argument list. |
| `entire review --trust-target` | Excluded | | Approves loading the hooks and MCP servers of code the person did not write. Only the person, in a terminal, may decide it. The extension shows the CLI's refusal as written and never adds the flag. |
| `entire review --agents` | Excluded | | Lists the reviewer agents and may start agent programs to do it, so it was not run and is not offered. Available in a terminal. |
| `entire review --models` | Excluded | | Lists the models each agent advertises and may start agent programs to do it, so it was not run and is not offered. Available in a terminal. |
| `entire experts` | Supported | `entirely.expertsForPath`, `src/services/experts.ts`, `src/test/experts.test.ts` | Not run against the real CLI: the experts run against a real project and cost real model calls. The help was read, and the flag that returns the reply as JSON was found in it. |
| `entire experts --tui` | Excluded | | An interactive viewer that needs a terminal. The extension always asks for JSON. |
| `entire tokens` | Supported | `entirely.tokenProfile`, `src/services/tokenProfile.ts`, `src/test/tokenProfile.test.ts` | The group has the single subcommand `profile` and prints only help, so it is reached through `tokens profile`. |
| `entire tokens profile` | Supported | `entirely.tokenProfile`, `src/services/tokenProfile.ts`, `src/test/tokenProfile.test.ts` | Observed against the real CLI 0.12.2: the command is hidden from `agent-help` and is read from its own `--help`, which describes `--all`, `--limit` and `--json`. The profile was run in a throwaway repository and decoded by `decodeTokenProfile`. |

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
| `entire org create` | Supported | `entirely.createOrganisation`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Create Organisation |
| `entire org get` | Supported | `entirely.showOrganisation`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | One organisation, as the CLI reports it |
| `entire org delete` | Supported | `entirely.deleteOrganisation`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org invite list` | Supported | `entirely.listInvitations`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | The invitations of an organisation |
| `entire org invite revoke` | Supported | `entirely.revokeInvitation`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Revoke an invitation |
| `entire org invite send` | Supported | `entirely.inviteToOrganisation`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Invite somebody to an organisation |
| `entire org grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire org grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Not run against the real CLI: it takes a grant away from a real organization, and there is no throwaway organization to take it from. See section 3. |
| `entire project list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project create` | Supported | `entirely.createProject`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Create Project |
| `entire project get` | Supported | `entirely.showProject`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | One project, as the CLI reports it |
| `entire project delete` | Supported | `entirely.deleteProject`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire project grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo view` | Supported | `entirely.checkpointDestination`, `src/services/checkpointDestination.ts`, `src/test/checkpointDestination.test.ts` | Observed against the real CLI 0.12.2: `repo view --json` was run against a read-only origin and decoded by `decodeRepoIdentity`. It names the repository by its forge path, says whether it is private, and lists the clusters it is placed on. |
| `entire repo create` | Supported | `entirely.createRepository`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo edit` | Supported | `entirely.setRepositoryVisibility`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Visibility only. |
| `entire repo delete` | Supported | `entirely.deleteRepository`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo clone` | Supported | `entirely.cloneRepository`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Clone a repository from Entire |
| `entire repo grant list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo grant add` | Supported | `entirely.grantAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo grant remove` | Supported | `entirely.revokeAccess`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | |
| `entire repo mirror list` | Supported | `entirely.checkpointDestination`, `src/services/checkpointDestination.ts`, `src/test/checkpointDestination.test.ts` | Observed against the real CLI 0.12.2: `repo mirror list --forge <forge> --name <name> --json` was run and decoded by `decodeVisibleRepos`. |
| `entire repo mirror add` | Supported | `entirely.addMirror`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Place a repository on a cluster |
| `entire repo mirror detach` | Supported | `entirely.detachMirror`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Turn a mirror into a repository of Entire own |
| `entire repo mirror remove` | Supported | `entirely.removeMirror`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Take a repository off a cluster |
| `entire repo mirror resync` | Supported | `entirely.resyncMirror`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Fetch a mirror changes again |
| `entire repo protection add` | Supported | `entirely.addProtectionRule`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Protect a branch from direct pushes |
| `entire repo protection list` | Supported | `entirely.listProtectionRules`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | The branch protection rules of a repository |
| `entire repo protection remove` | Supported | `entirely.removeProtectionRule`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Remove a branch protection rule |
| `entire repo remote add` | Supported | `entirely.addRemote`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Point a git remote at Entire |
| `entire repo visibility get` | Supported | `entirely.showRepositoryVisibility`, `src/services/controlPlane.ts`, `src/test/controlPlaneBreadth.test.ts` | Whether a repository is public or private |
| `entire cluster list` | Supported | `entirely.openControlPlane`, `src/services/controlPlane.ts`, `src/test/controlPlane.test.ts` | Observed against the real CLI 0.12.2: the command prints a table of region, cluster and host. |
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
| `entire trail create` | Supported | `entirely.trailCreate`, `src/test/trailAuthoring.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first; publishes the branch. Reported only when a fresh list holds one new trail with the title. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail update` | Supported | `entirely.trailUpdate`, `src/test/trailAuthoring.test.ts`, `src/test/support/trailDepthCli.ts` | Closing or replacing the assignee list asks first. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail watch` | Supported | `entirely.trailWatch`, `src/test/trailWatch.test.ts`, `src/test/cliStream.test.ts` | One owned process per change, stopped by the user or on deactivation, never polled. Not run against the real CLI: it watches a real project on Entire, and a throwaway repository has no project to watch. See section 3. |
| `entire trail resume` | Excluded | | Entire's documentation says a non-interactive run shows the same context and prints the resume commands, so interactivity is only the default, not the reason. The reason is that `entire session resume` already covers the editor use case: `entirely.resumeSession` (`src/services/sessionResume.ts`) resumes a branch's session in an editor terminal. |
| `entire trail comment delete` | Supported | `entirely.trailDeleteMessage`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first, with the strictest wording. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail comment edit` | Supported | `entirely.trailEditMessage`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Only the acting login's messages are offered. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail comment reply` | Supported | `entirely.trailReplyToDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Read back under the acting handle. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail comment resolve` | Supported | `entirely.trailResolveDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail comment show` | Supported | `entirely.trailShowDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | The shape of the answer was not observed on the real CLI, so it is read tolerantly. Not run against the real CLI: it reads a real project on Entire, and a throwaway repository has no project to read. See section 3. |
| `entire trail comment unresolve` | Supported | `entirely.trailReopenDiscussion`, `src/test/trailDiscussions.test.ts`, `src/test/support/trailDepthCli.ts` | Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail finding apply` | Supported | `entirely.trailApplyFinding`, `src/test/trailApplyFinding.test.ts`, `src/test/support/trailDepthCli.ts` | Refused with unsaved work; the check runs first and the person confirms. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail finding dismiss` | Supported | `entirely.trailDismissFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Asks first for a high-severity finding. Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail finding reopen` | Supported | `entirely.trailReopenFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail finding resolve` | Supported | `entirely.trailResolveFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |
| `entire trail finding show` | Supported | `entirely.trailShowFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | The CLI has no JSON form for this one, so its text is shown as printed. Not run against the real CLI: it reads a real project on Entire, and a throwaway repository has no project to read. See section 3. |
| `entire trail finding update` | Supported | `entirely.trailUpdateFinding`, `src/test/trailFindings.test.ts`, `src/test/support/trailDepthCli.ts` | Not run against the real CLI: it writes to a real project on Entire, and a throwaway repository has no project to write to. See section 3. |

### Data, plugins and MCP

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire activity` | Supported | `entirely.openActivity`, `src/services/activity.ts`, `src/test/activity.test.ts` | Observed against the real CLI 0.12.2: `activity --help` describes `--commits`, and the picker finds it. The output is a table of throughput, iteration, continuity and streak, a contribution chart, the repositories and the recent sessions, and `parseActivity` reads it. |
| `entire recap` | Supported | `entirely.showRecap`, `src/services/recap.ts`, `src/test/dispatch.test.ts`, `src/test/activity.test.ts` | Observed against the real CLI 0.12.2: `recap --help` describes `--static`, `--color`, `--day`, `--week`, `--month` and `--90`, and the picker finds all six. The recap itself is the CLI's text and is shown as it is. |
| `entire dispatch` | Supported | `entirely.generateDispatch`, `src/services/dispatch.ts`, `src/test/dispatch.test.ts` | Observed against the real CLI 0.12.2: `dispatch --help` describes `--local`, `--since` and `--jurisdiction`, and the picker finds all three. |
| `entire plugin list` | Supported | `entirely.runPluginCommand`, `src/services/plugins.ts`, `src/test/plugins.test.ts` | Observed against the real CLI 0.12.2: `plugin list` prints the managed plugin directory and then one line per plugin, and `parseManagedDirectory` reads the directory out of it. The help for `plugin install`, `plugin upgrade` and `plugin remove` was read and every flag the extension wants was found. |
| `entire plugin install` | Supported | `entirely.installPlugin`, `src/services/plugins.ts`, `src/test/plugins.test.ts` | |
| `entire plugin browse` | Excluded | | An interactive picker that needs a terminal; its own help points scripts at `search` and `install`. Search Plugin Index (`plugin search`) lists the same names and descriptions and installs through the existing confirmation. |
| `entire plugin doctor` | Supported | `entirely.checkPlugins`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | Read-only, no question. The exit status is the verdict and the CLI's text is shown, never judged. Observed against the real CLI 0.12.2: `All plugins healthy.` with exit 0 on three healthy plugins. Not observed: a failing check, its text and exit code (invented in the fake). |
| `entire plugin index update` | Supported | `entirely.updatePluginIndex`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | Asks first, naming the acting login, and says no plugin changes. The CLI reports nothing to read back, so the message says so. Not run against the real CLI: its output (and every failure exit) is invented in `src/test/support/pluginManagementCli.ts`, so the format is unobserved. |
| `entire plugin info` | Supported | `entirely.pluginInfo`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | Read-only. A plugin on the PATH gets the unmanaged note first. Not run against the real CLI: its output (and every failure exit) is invented in `src/test/support/pluginManagementCli.ts`, so the format is unobserved. |
| `entire plugin remove` | Supported | `entirely.removePlugin`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | Asks first, naming the directory and the login; runs once; verified only by a fresh `plugin list`. A refusal over dependents gets a second, separate question using the force flag picked from the help. A plugin outside the managed directory is never offered Remove. Not run against the real CLI: its output (and every failure exit) is invented in `src/test/support/pluginManagementCli.ts`, so the format is unobserved. |
| `entire plugin search` | Supported | `entirely.searchPluginIndex`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | The typed term is redacted from the invocation record. A pick can show Info or install through the existing install question. Text no row can be read from is shown as the CLI printed it. Not run against the real CLI: its output (and every failure exit) is invented in `src/test/support/pluginManagementCli.ts`, so the format is unobserved. |
| `entire plugin upgrade` | Supported | `entirely.upgradePlugin`, `src/services/pluginManagement.ts`, `src/test/pluginManagement.test.ts` | Asks first, naming the download, the checksum check, the directory and the login; the all flag is picked from the help. The result is read from a fresh `plugin list`; exit 0 without a changed version is reported as unchanged. `entirely.upgradeAllPlugins` is the all form. Not run against the real CLI: its output (and every failure exit) is invented in `src/test/support/pluginManagementCli.ts`, so the format is unobserved. |
| `entire graph` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | A plugin, run by name with its own arguments. The extension does not model the plugin's subcommands. The Integrations view shows whether it is installed in each folder and installs it from its row (`entirely.installIntegration`). The suggested names are the setting `entirely.suggestedPlugins`. |
| `entire investigate` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | Same: run by name as a plugin, and shown in the Integrations view. |
| `entire brain` | Supported | `entirely.runPluginCommand`, `src/lib/entire/integrations.ts`, `src/test/plugins.test.ts` | Same: run by name as a plugin, and shown in the Integrations view. |
| `entire mcp` | Supported | `entirely.startMcpServer`, `src/services/mcpServer.ts`, `src/test/plugins.test.ts` | Observed against the real CLI 0.12.2: `entire mcp` starts and prints nothing until it is spoken to, which is what the extension's probe expects. The command is hidden from `agent-help`, and the extension asks the CLI for the launch line instead of reading a help page. |

### Not editor concerns

| Command | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `entire help` | Excluded | | The command tree is read through `agent-help`, which always matches the installed CLI. A help screen has no place in the editor. |
| `entire completion` | Excluded | | Shell completion scripts. VS Code's terminal and the user's shell setup own them. |
| `entire global-flags` | Excluded | | The documentation page for the flags themselves. `--context` has its own row; `--help` and `--version` need no editor surface. |

---

## 3. Gaps, by what they cost the user

Nothing is left out. Every command the CLI has that the editor can act on is
in the matrix above, and the last of them, the control plane's breadth, is
now covered: organisations and projects can be read and created, invitations
can be listed, sent and revoked, and a repository's visibility, protection
and mirrors can be read, protected, mirrored, detached, resynced, cloned and
given a remote.

### What was not run, and what that costs

The commands that could not be run in a throwaway repository, because they
change something outside it:

| Command | Why it was not run | What it costs |
| --- | --- | --- |
| `trail create`, `trail update`, `trail watch`, the `trail comment` and `trail finding` verbs | They write to a real project on Entire, and a throwaway repository has no project to write to. | Their output and exit codes are unobserved. The extension reads them tolerantly and shows the CLI's own text, so an unexpected shape shows as text rather than as a crash. |
| `org grant remove` | It takes a grant away from a real organization, and there is no throwaway organization to take it from. | The extension's flow is covered by a fake CLI, and the real refusal wording is unobserved. |
| `runner setup` | It writes the agent's own configuration files under the user's home directory. | The argument building is covered; the files it leaves are not observed. |
| `disable --uninstall` | It removes the agent integration from the machine, not only from the repository. | The extension's flow is covered by a fake CLI; what is left behind is not observed. |
| `login`, `logout` | They change the account the machine acts as. | The extension's flow is covered by a fake CLI. |
| `review`, `experts` | They spawn real agents against a real project and cost real model calls. | The extension's flow is covered by a fake CLI; the reply shape is read tolerantly and the raw reply opens. |
| `org create`, `org invite send`, `org invite revoke`, `project create` | They write to a real organisation or project, and a throwaway repository has none. | The extension's flow is covered by a fake CLI, and every flag is read from the CLI's own help, so a CLI that renames one is followed. |
| `repo mirror add`, `repo mirror remove`, `repo mirror detach`, `repo mirror resync` | They place and tear down copies of a repository on a real cluster. | The extension's flow is covered by a fake CLI; the placements it waits for are read back from the CLI's own listing. |
| `repo protection add`, `repo protection remove` | They change the protection of a branch on a real repository. | The extension's flow is covered by a fake CLI, and the rule is read back from the CLI's own listing. |
| `repo clone`, `repo remote add` | They write into the checkout they are run from. | The extension's flow is covered by a fake CLI; the clone is checked on disk and the remote in the checkout's own git configuration. |

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
