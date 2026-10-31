---
title: Commands
description: Every command the extension contributes, where it appears, and whether it changes anything on Entire.
sidebar:
  order: 1
---

Entirely contributes 63 commands. All of them share the category `Entirely`, so the Command Palette shows each as **Entirely: &lt;title&gt;**. The table below was generated from `contributes.commands` and `contributes.menus` in `package.json`, then each description was checked against `src/`.

Reading the tables:

- **Where** lists the places beyond the palette. `view title` is the toolbar of a view, `inline` is the icon on a tree row, `context` is a right-click menu, `editor` is the editor's context menu or title bar.
- **Changes** says whether the command changes anything on Entire, in the repository or in your settings. *Read* means it only reads. *Confirms* means a modal prompt names what will change and nothing runs until you agree. *Asks for input, no confirmation* means you pick or type something and the command then runs without a further prompt. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/) for what the extension keeps out of its logs.
- **Hidden** commands are registered with `commandPalette: false`. They exist for menus, tree rows and links, and never show in the palette.

Several commands that have a menu entry are also in the palette, for example **Entirely: Create Repository**. The ones that are not are marked *hidden*.

## Setup, status and diagnostics

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Refresh | `entirely.refresh` | palette | Read | Re-reads the CLI for workspace, session and checkpoint state. |
| Entirely: Open Settings | `entirely.openSettings` | palette | Read | Opens the Settings editor filtered to Entirely. |
| Entirely: Entirely Status | `entirely.statusBar` | status bar click; hidden | Depends on state | The status bar's click action. See [Status bar](/entirely/reference/status-bar/). |
| Entirely: Set Up Entire | `entirely.setUp` | palette | Asks for input, no confirmation | Shows a message with a **Set Up** button (not a modal), then a picker of the agents from `entire agent list`, then runs `entire enable` for that agent with no further prompt. Installs hooks so agent sessions are recorded. |
| Entirely: Set Up Agent Integrations | `entirely.manageAgents` | palette | Confirms | Lists the agents the CLI supports, marks the installed ones, and installs or removes one. The prompt says the CLI will write the agent's hook configuration into the repository. See [Agent integrations](/entirely/guides/agent-integrations/). |
| Entirely: Add the Entire CLI to the Terminal PATH | `entirely.repairTerminalPath` | palette | Confirms | Writes `terminal.integrated.env.<platform>` so the integrated terminal can run `entire`. You pick the settings scope first. Running it again removes the entry. |
| Entirely: Check Where Checkpoints Are Uploaded | `entirely.checkpointDestination` | palette | Read | Reports the repository checkpoints go to and whether the CLI can reach it. |
| Entirely: Doctor: Copy a Diagnostic Report | `entirely.doctor` | palette | Read | Writes a report of CLI version, repository state, effective settings and last error to the output channel, then offers **Copy to Clipboard**. |
| Entirely: Doctor: Show the CLI's Full Diagnostic Output | `entirely.showCliDoctorOutput` | palette | Read | Shows the bare `entire doctor` output. Never run with a fix flag. |
| Entirely: Doctor: Show the Last Entire CLI Output | `entirely.dumpCliOutput` | palette | Read | Dumps the recorded output of the last CLI call. This is the explicit way to see a payload that the output channel keeps out by default. |
| Entirely: Doctor: Show the CLI Log | `entirely.showCliLog` | palette | Read | Opens the newest lines of the CLI's operational log (`entirely.doctorLogLines`) in a read-only document with **Copy**. Never `--follow`, never zero lines. Output over `entirely.doctorOutputMaxKilobytes` opens cut, with **Save the whole output**. |
| Entirely: Doctor: Show Hook Traces | `entirely.showHookTraces` | palette | Read | Asks for the latest trace, the last N, a summary or the slow ones, and an optional hook name, then opens the traces in a read-only document. Only options the CLI's help describes are offered. |
| Entirely: Doctor: Write a Diagnostic Bundle | `entirely.writeDiagnosticBundle` | palette | Writes a file you choose | Says what the archive holds, asks for a `.zip` path, confirms before replacing a file, runs `entire doctor bundle` with secret redaction on, reads the CLI's temporary file back and moves it into place only if it is a zip archive (nothing at your path changes on a failure or cancel), then offers **Reveal in File Explorer** and **Copy Path**. Never opens the archive. |
| Entirely: Doctor: Write an Unredacted Diagnostic Bundle | `entirely.writeRawDiagnosticBundle` | palette | Writes a file you choose | The same, without secret redaction, behind a separate modal that says the archive will hold raw logs, settings and git output. Refused when the CLI's help does not describe the raw flag. |
| Entirely: Doctor: Migrate Checkpoints to Git Refs | `entirely.migrateCheckpoints` | palette | Confirms | Opens the dry run of `entire doctor migrate-checkpoints` first. **Migrate…** then asks in a modal naming the repository, the acting login and the local refs, runs once with no remote (nothing is pushed), and counts `refs/entire/checkpoints/` before and after. |

The log, trace, bundle and migration commands were tested only against a fake CLI; see [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/).

## Account

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Sign In to Entire | `entirely.signIn` | Account view title (when signed out) | Account | Runs `entire login`. You choose a browser or a device code; the device-code choice is offered only when the CLI supports it. |
| Entirely: Sign Out of Entire | `entirely.signOut` | Account view title (when signed in) | Confirms | Runs `entire logout`. The prompt warns that every saved login is signed out. |

See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).

## Sessions

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Show Sessions | `entirely.showSessions` | palette | Read | Reveals the Sessions view. |
| Entirely: Show Session Details | `entirely.selectSession` | hidden | Read | Selects a session, as clicking its row does: the Session view and the detail panel show it. Kept so keybindings and other commands can call it. |
| Entirely: Show Details in the Detail Panel | `entirely.selectItem` | row click; hidden | Read | Opens the selected session, trail, change or Activity row in the detail panel. Takes a selection and its view; anything else becomes a line in the panel. |
| Entirely: Refresh the Detail Panel | `entirely.retryDetail` | panel Refresh and Retry links; editor title bar while the panel is active; palette while something is selected | Read | Reads the selected item again, skipping the cache for it alone. |
| Entirely: Open the Detail Panel as Text | `entirely.openDetailInEditor` | panel link; editor title bar while the panel is active; palette while something is selected | Read | Opens the detail shown as a read-only `entirely-generated` document. |
| Entirely: Copy Commit Hash | `entirely.copyCommitHash` | panel link on an Activity commit; hidden | Read | Copies the short hash of the commit the panel shows. Takes the panel's row id and ignores anything that is not the item on show. |
| Entirely: Open Session Transcript | `entirely.openTranscript` | Sessions inline icon (session and imported-session rows) | Read | Opens the transcript in a read-only editor. Transcript text is never written to the output channel. |
| Entirely: Show Only This Workspace's Session | `entirely.showOwnSession` | Sessions view title (when showing all) | Read | Filters the tree to the session of this workspace (`entire session current`). |
| Entirely: Show All Sessions | `entirely.showAllSessions` | Sessions view title (when filtered) | Read | Removes the filter. |
| Entirely: Resume Session | `entirely.resumeSession` | Sessions context menu, group `2_lifecycle` | Confirms | Resumes a branch's session in an editor terminal and watches the session list for it to become active. |
| Entirely: Attach Session to a Commit | `entirely.attachSession` | Sessions context menu | Confirms | Links a session to a commit with `entire session attach`. Attaching to a pushed commit uploads the transcript. |
| Entirely: Adopt Session from Another Worktree | `entirely.adoptSession` | Sessions context menu | Confirms | Adopts a session from another worktree with `entire session adopt`. |
| Entirely: Stop Session | `entirely.stopSession` | Sessions context menu, group `3_destructive` | Confirms | Ends a live session with `entire session stop`. |
| Entirely: Import Past Agent History as Read-Only Checkpoints | `entirely.importHistory` | palette | Confirms | Previews, then imports one agent's past sessions with `entire import`. The CLI marks the command experimental. See [History import](/entirely/guides/history-import/). |

See [Sessions and checkpoints](/entirely/guides/sessions-and-checkpoints/).

## Checkpoints, blame and search

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Open Checkpoint Diff | `entirely.openCheckpointFile` | checkpoint file rows; hidden | Read | Opens a checkpoint's file in the native diff editor. |
| Entirely: Explain Checkpoint | `entirely.explainCheckpoint` | checkpoint rows; hidden | Read | Runs `entire checkpoint explain` for one checkpoint and shows it. |
| Entirely: Search Checkpoints | `entirely.searchCheckpoints` | Checkpoints view title | Read | Filters the checkpoint tree with `entire checkpoint search`. The query is redacted from the logged command line. |
| Entirely: Clear Checkpoint Search | `entirely.clearCheckpointSearch` | Checkpoints view title (while a filter is active) | Read | Removes the filter. |
| Entirely: Search Past Work and Code | `entirely.searchWork` | Search view title | Read | Runs `entire search` (work) or `--code`, in the scope set by `entirely.searchScope`. |
| Entirely: Clear Search Results | `entirely.clearSearch` | Search view title (while results show) | Read | Clears the Search view. |
| Entirely: Open Search Result | `entirely.openSearchResult` | Search result rows; hidden | Read | Opens the result. |
| Entirely: Why Does This Line Exist? | `entirely.whyThisLine` | Editor context menu | Read | Asks `entire why` which agent edit introduced the line under the cursor. |
| Entirely: Blame This File | `entirely.blameFile` | Editor context menu (saved files only) | Read | Runs `entire blame` and marks each line as attributed, recorded but not synced, or not attributed. Offers to save an unsaved file first. |
| Entirely: Clear Blame | `entirely.clearBlame` | palette | Read | Removes the blame decorations. |

See [Search](/entirely/guides/search/) and [Blame and why](/entirely/guides/blame-and-why/).

## Trails and review

Merge, check out, link and unlink confirm in a modal prompt that names what they change. The merge runs a dry run first and reports blockers before it asks. Approve runs right after you pick the change, and comment runs right after you type the text, so neither confirms. The timeout is `entirely.trailActionTimeout`.

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Approve a Change on a Trail | `entirely.trailApprove` | palette; detail panel link | Palette: asks for input, no confirmation. Panel or Trails row: modal naming the change and acting login | `entire trail approve`, run as soon as you pick the change in the palette, or confirm it from the panel or row. No message is sent. |
| Entirely: Comment on a Change on a Trail | `entirely.trailComment` | palette; detail panel link | Asks for input, no confirmation | Posts a comment (`trail comment add`) as soon as you enter the text. If the CLI refuses a comment from an agent session, the note is posted as a finding (`trail finding add`) instead and you are told. Comment bodies are redacted from the logged command line. |
| Entirely: Merge a Change on a Trail | `entirely.trailMerge` | palette; detail panel link | Confirms | `entire trail merge`, after a dry run that names what will be merged. |
| Entirely: Check Out a Change on a Trail | `entirely.trailCheckout` | palette; detail panel link | Confirms | `entire trail checkout`. Warns about unsaved files because the checkout moves the working tree. |
| Entirely: Link a Branch to a Trail | `entirely.trailLink` | palette; detail panel link | Confirms | `entire trail link`. |
| Entirely: Unlink a Branch from a Trail | `entirely.trailUnlink` | palette; detail panel link | Confirms | `entire trail unlink`. |

See [Trails and review](/entirely/guides/trails-and-review/).

## Activity, dispatch and recap

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Open Activity | `entirely.openActivity` | palette | Read | Reveals and loads the Activity view. |
| Entirely: Refresh Activity | `entirely.refreshActivity` | Activity view title | Read | Re-reads `entire activity`. |
| Entirely: Show Recent Sessions in Activity | `entirely.showActivitySessions` | Activity view title (when listing commits) | Read | Switches the listing to sessions. |
| Entirely: Show Recent Commits in Activity | `entirely.showActivityCommits` | Activity view title (when listing sessions) | Read | Switches the listing to commits. |
| Entirely: Generate Dispatch | `entirely.generateDispatch` | Activity view title | Confirms | Runs `entire dispatch` once, after a confirmation. It is never started again after a timeout. |
| Entirely: Copy Dispatch | `entirely.copyDispatch` | Editor title bar (generated `.md` dispatch documents) | Read | Copies the generated dispatch text. |
| Entirely: Show Recap | `entirely.showRecap` | palette | Read | Runs `entire recap` for a period you pick. |

See [Activity, dispatch and recap](/entirely/guides/activity-dispatch-recap/).

## Token profile, experts and review

See [Token profile, experts and review](/entirely/guides/tokens-experts-review/). Entirely never passes a trust or setup flag to `entire review`.

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Show Token Profile | `entirely.tokenProfile` | palette; Checkpoints view title | Read | Runs `entire tokens profile --json` for a scope you pick and opens it in a read-only document. Spends no tokens. |
| Entirely: Who Has Touched This Path? | `entirely.expertsForPath` | Explorer and editor context menus; palette; the blame panel link | Read (sends the path to Entire) | Runs `entire experts` for a file or folder. Entire's servers answer. |
| Entirely: Ask Entire Who Knows About a Topic | `entirely.expertsAsk` | palette | Read (sends the question to Entire) | Runs `entire experts` with your question after `--`. The question is not logged. |
| Entirely: Who Has Touched the Staged Files? | `entirely.expertsStaged` | palette | Read (sends the staged paths to Entire) | Runs `entire experts` with the CLI's staged flag. |
| Entirely: Show Raw Experts Reply | `entirely.showExpertsRawReply` | palette | Read | Opens the last experts reply as received, for when its shape was not recognised. Held in memory only. |
| Entirely: List Review Profiles | `entirely.reviewProfiles` | palette; Activity view title overflow | Read | Runs `entire review --list`. |
| Entirely: Show What a Review Would Run | `entirely.reviewShowConfig` | palette; Activity view title overflow | Read | Runs `entire review --show-config --json`. |
| Entirely: Show Saved Review Findings | `entirely.reviewFindings` | palette; Activity view title overflow | Read | Runs `entire review --findings`. |
| Entirely: Run Multi-Agent Review | `entirely.reviewRun` | palette; Activity view title overflow | Confirms | Asks for profile, branch and instructions, then a modal, then opens one terminal running the review as the confirmed login. Starts agents that spend your tokens. Never retried. |
| Entirely: Set Up Review in a Terminal | `entirely.reviewSetup` | palette; Activity view title overflow | Confirms | Opens `entire review --configure` in a terminal after asking. You complete the wizard. |

## Control plane

The delete, visibility and access commands are hidden from the palette and live on tree rows. Every change confirms, runs once, and is read back afterwards. A change that times out is reported as done only if the CLI now lists it that way. Create and delete paths were tested against a fake CLI only; they are not verified against a live Entire account. See [Control plane](/entirely/guides/control-plane/).

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Open Control Plane | `entirely.openControlPlane` | palette | Read | Reveals and loads the Control Plane view. |
| Entirely: Refresh Control Plane | `entirely.refreshControlPlane` | Control Plane view title | Read | Re-lists organisations, projects, repositories and clusters. |
| Entirely: Create Repository | `entirely.createRepository` | Control Plane view title; project row context | Confirms | `entire repo create`. |
| Entirely: Change Repository Visibility | `entirely.setRepositoryVisibility` | repository row context; hidden | Confirms | `entire repo edit`, visibility only. |
| Entirely: Delete Repository | `entirely.deleteRepository` | repository row context; hidden | Confirms | `entire repo delete`. Deleting with mirrors waits for the mirrors to go. |
| Entirely: Delete Project | `entirely.deleteProject` | project row context; hidden | Confirms | `entire project delete`. |
| Entirely: Delete Organisation | `entirely.deleteOrganisation` | organisation row context; hidden | Confirms | `entire org delete`. |
| Entirely: Give Access | `entirely.grantAccess` | organisation, project, repository and access row context; hidden | Confirms | `grant add` on the row's scope. |
| Entirely: Remove Access | `entirely.revokeAccess` | grant row context; hidden | Confirms | `grant remove` on the row's scope. |
| Entirely: Call the Entire API | `entirely.runApiCall` | Control Plane view title | Confirms for non-GET | `entire api`: one call at a time, path confined to `/api`, no retry. A GET runs without a prompt. |

## Plugins, integrations and MCP

| Palette title | Id | Where | Changes | What it does |
| --- | --- | --- | --- | --- |
| Entirely: Run Plugin Command | `entirely.runPluginCommand` | palette | Confirms | Runs an installed plugin by name, as the login the extension acts as. The CLI's built-in command names are refused. Arguments are redacted from the log. |
| Entirely: Install Plugin | `entirely.installPlugin` | palette | Confirms | `entire plugin install`. |
| Entirely: Refresh Integrations | `entirely.refreshIntegrations` | Integrations view title | Read | Re-checks plugins and the MCP server per workspace folder. |
| Entirely: Install Plugin | `entirely.installIntegration` | Integrations inline icon (row with a missing plugin) | Confirms | Installs that row's plugin. It has the same title as the palette command above. |
| Entirely: Turn On MCP Server | `entirely.enableMcpIntegration` | Integrations inline icon (row where MCP is off) | Confirms | Sets `entirely.mcpServerEnabled` in the narrowest scope that takes effect: the folder, then the workspace, then your user settings. |
| Entirely: Add MCP Server to Project Configuration | `entirely.addMcpToProject` | Integrations inline icon (row where it can be added) | Confirms | Adds the Entire server to the project's `.mcp.json`. Never writes a credential or the CLI path. |
| Entirely: Start MCP Server | `entirely.startMcpServer` | palette | Confirms, only if the setting is off | Starts `entire mcp` for the editor's agent. The editor owns the process. If `entirely.mcpServerEnabled` is off, a modal says "The Entire MCP server is turned off." and, on **Turn On**, sets it in your user settings. |
| Entirely: Copy MCP Server Configuration | `entirely.copyMcpConfig` | palette | Read | Copies the server definition to the clipboard. |

See [Plugins](/entirely/guides/plugins/) and [Integrations and MCP](/entirely/guides/integrations-and-mcp/). Plugin install and the live MCP server are covered by tests against fake CLIs. They have not been verified against a live Entire account.
