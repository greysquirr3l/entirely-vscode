# Change Log

All notable changes to the "greysquirr3l.entirely" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- **Every agent integration the CLI ships.** **Entirely: Set Up Agent Integrations**
  lists the agents `entire agent list` prints, marks the installed ones, and installs
  or removes one with `entire agent add` / `remove`. Nothing runs until you agree to a
  message that says Entire will write the agent's hook configuration into the repository
  (and may update `.entire/`); afterwards it shows the files the CLI lists to commit and
  checks the new state against a fresh `agent list`, so a refusal, or an exit 0 that
  installed nothing, is reported as a failure. More than one agent can be installed at
  once. Reinstall appears only when `agent add --help` describes a reinstall flag. The
  setup button on a workspace that is not set up now asks which agent, instead of always
  choosing Copilot CLI.
- **The hook bridge forwards editor events to one agent, and says so.** Installing an
  agent and bridging it are separate: every integration runs its own hooks, so the bridge
  sends the editor's own events only to the integration whose payload layout matches the
  editor's, named by the new `entirely.editorHookAgent` setting (default `copilot-cli`,
  the agent the bridge always addressed). Other installed agents are listed as "not
  bridged" and are never sent an `entire hooks` call, so a hook that exits 0 and records
  nothing cannot be counted as captured. The Copilot stand-down for hook files the editor
  loads itself is unchanged. The install confirmation states that `agent add` cannot
  preview the files it writes, and the agent lookup is remembered between editor events.
  `entire agent list` output with an unrecognised or trailing line is still read.

- **Import past agent history.** **Entirely: Import Past Agent History as Read-Only
  Checkpoints** lists the agents `entire import --help` offers, lets you import all
  of an agent's past month or only sessions you name, and runs the CLI's own dry run
  first. The dry run's report (turns, sessions, how many were already imported) is
  what you confirm; declining runs nothing. The import itself runs with a
  cancellable progress notification and the new `entirely.importTimeout` setting,
  and the result shown is the CLI's own account, not an assumed success. Imported
  checkpoints and sessions show a lock icon and "Imported · read-only" in their
  trees; they get their own context (`entirely.importedCheckpoint`,
  `entirely.importedSession`) so Stop, Attach, Adopt and Resume are not offered on
  them. A session with no worktree (an imported one) no longer breaks the Sessions
  and Checkpoints views.
- **Session lifecycle actions.** Stop, attach, adopt and resume a session from the
  palette or a session's context menu. Stop names the session in a confirmation
  before anything runs. Attach shows what the CLI says it will change (including
  rewriting unpushed commits), links on agreement, and reports what the CLI
  linked. Adopt refreshes the Sessions view and says whether the session is listed
  for the workspace. Resume runs in a terminal, because the CLI asks whether to
  start the agent, and reports what it saw (session active again, or none seen,
  with the exit code) rather than assuming it started. Flags are read from the
  CLI's own help; a missing, old or refusing CLI is reported as a failure. New
  settings `entirely.lifecycleActionTimeout` and `entirely.resumeWatchTimeout`.
  Resume confirms the branch it will check out, refuses (naming the files) while
  the workspace has unsaved changes, ignores a second Resume on a branch already
  being watched, and stops watching when the window closes.
- **File blame.** **Entirely: Blame This File** (palette and editor context menu)
  runs `entire blame` once on the saved file and marks every line in the editor:
  a recorded change, a recorded change that has not synced yet, or no recorded
  change ("Not attributed to any recorded change"). The whole-file answer opens
  in the same panel as Why Does This Line Exist, through the same renderer, and
  hovering a marked line offers that command for the line. Marks are dropped when
  the text changes. An unsaved file asks to be saved first. New setting
  `entirely.blameMaxDecoratedLines`; **Entirely: Clear Blame** removes the marks.
- **Checkpoint search.** Search the Checkpoints view as you type. It runs
  `entire checkpoint search`, with the flags read from the CLI's own help, and
  lists the matches. "No checkpoint matched" and "The search failed" are
  different messages, and a missing or too-old CLI is a failure, not an empty
  result. The query is kept out of the output channel. New setting
  `entirely.searchDebounce`.
- **Token usage.** The Session view and each opened checkpoint show the token
  counts `entire session tokens` and `entire checkpoint tokens` report. A count
  the CLI leaves out reads "Not reported", never 0; usage it cannot read says
  "Not recognised" and a failed call "Not available"; and models are shown as the
  CLI wrote them.
- **Session detail.** Selecting a session reads `entire session info`, so the
  view shows when it ended, its last checkpoint, files touched and a
  count of each tool it called. Ended sessions work the same as live ones.
- **Transcripts.** Open a session's transcript in a read-only editor, with its
  attribution and tool calls. It never goes in the tree and never in the
  output channel. New setting: `entirely.transcriptTimeout`.
- **Workspace-only sessions.** A filter on the Sessions view that shows just
  the session `entire session current` reports for this workspace.

## [0.1.0] - 2026-10-27

The first release with a working editor surface. The extension talks to the
[Entire CLI](https://entire.com) and shows what it knows: which repository is
tracked, which agents are running, what each session did, and why a line of
code is the way it is.

### Added

- **Status bar.** Says whether the workspace is tracked by Entire, and whether
  an agent session is live right now. A workspace that does not use Entire
  shows nothing at all.
- **Sessions.** A tree of the sessions Entire tracks for the repository, across
  every worktree rather than just the open folder, with the details of the
  selected one beside it.
- **Checkpoints.** Every checkpoint the repository has, opening straight into
  the editor's own diff, with the files it touched and the change that
  produced each of them.
- **Why this line.** Asks Entire which agent edit introduced the line under
  the cursor, and why, without leaving the editor.
- **Hook bridge.** Reports the editor's own agent activity to Entire, so work
  done in the editor lands in the same session history as work done in a
  terminal. The model is never assumed: whatever Copilot Chat is using is
  recorded as it stands.
- **Terminal PATH repair.** The CLI installs to `~/.local/bin`, which the
  integrated terminal does not inherit. The repair writes the editor's own
  terminal environment setting — no shell profile is read or written, and no
  shell command is run.
- **Doctor.** A copyable diagnostic report: the CLI's path and version, the
  repository and enablement state, the settings in effect, and the last error
  the CLI gave.
- **One log.** Every CLI invocation is written to the `Entire` output channel
  with its command line, working directory and exit code. Prompt bodies and
  checkpoint payloads are not written there; the content is behind an
  explicit command.

### Settings

- `entirely.cliPath` — the path to the `entire` binary.
- `entirely.refreshInterval` — how often the extension re-reads the CLI.
- `entirely.showSessionsInExplorer` — also show the sessions tree in the
  Explorer.
- `entirely.logLevel` — how much the extension says.
- `entirely.debug` — say more, without opening a second channel.
