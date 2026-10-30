# Change Log

All notable changes to the Entirely extension are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **The CLI's log and hook traces, from the editor.** **Entirely: Doctor: Show the CLI
  Log** and **Show Hook Traces** open the output of `entire doctor logs` and
  `entire doctor trace` in a read-only document with a Copy action, never in the output
  channel. The log is always asked for with a line count (`entirely.doctorLogLines`),
  never `--follow` and never zero lines. The trace command offers the latest trace, the
  last N (`entirely.doctorTraceCount`), a summary or the slow ones, and an optional hook
  name, each only when the CLI's help describes the flag.
- **Long output is cut, and the whole of it can be saved.** A log, trace or migration
  report over `entirely.doctorOutputMaxKilobytes` opens with a banner that says how much
  was left out. **Save the whole output** writes all of it to a `.txt` or `.log` file you
  choose, through a temporary file, and asks before replacing one. The runner now says when
  the CLI printed more than the 16 MB it reads.
- **A diagnostic bundle to a file you choose.** **Entirely: Doctor: Write a Diagnostic
  Bundle** says what `entire doctor bundle` puts in the archive, asks for an absolute `.zip`
  path in an existing folder (not a link, not inside `.git` or `.entire`), confirms before
  replacing a file, runs the CLI with its secret redaction on, and offers Reveal and Copy Path.
  The CLI writes to a hidden temporary `.zip` in the same folder, the archive is read back
  (a regular, non-empty file with a zip signature, opened once without following links), and
  only then moved into place: renamed over the file when you agreed to replace it, linked
  (which refuses to overwrite) otherwise. The temporary file is removed on every failure or
  cancel, and the path is checked again just before the write. It never opens the archive.
  **Write an Unredacted Diagnostic Bundle** is a separate command with its own strict
  confirmation, offered only when the CLI's help describes the raw flag.
- **Migrate checkpoints to git refs.** **Entirely: Doctor: Migrate Checkpoints to Git
  Refs** opens the dry run of `entire doctor migrate-checkpoints` first, then asks to
  apply it in a modal that names the repository, the acting login and the local refs it
  creates. It runs once as that login, never retries, never names a remote so nothing is
  pushed, and checks the result by counting `refs/entire/checkpoints/` before and after (the
  count is taken again after you confirm). The dry run runs as the same login the question
  names.
- Six settings: `entirely.doctorLogLines`, `doctorTraceCount`, `doctorOutputMaxKilobytes`,
  `doctorReadTimeout`, `doctorBundleTimeout` and `migrateCheckpointsTimeout`.
- A CLI without one of these subcommands is named, with its version and an update link,
  and nothing is run.

These flows were tested only against a fake CLI. The real CLI's output formats for
`doctor logs`, `trace`, `bundle` and `migrate-checkpoints` were not observed, and the
bundle and migration were not run against it.

## [0.2.0] - 2026-10-30

### Changed

- **Entire's official symbol, unmodified.** The activity bar icon and the status bar glyph
  are Entire's own small-size symbol, as supplied in its brand kit, instead of a redraw.
  Every status bar state shows the logo followed by a codicon for the state: `$(pulse)`
  for a running session, `$(warning)` for a checkpoint problem or an unreadable CLI,
  `$(circle-slash)` when not set up, `$(circle-outline)` for a folder that is not a
  repository, `$(eye-closed)` when the login cannot see the workspace, and `$(error)` for
  a login the CLI does not have. The icon font now holds only `entire-logo`.
- **Entirely presents itself as an unofficial extension for Entire.** The activity bar
  title is now "Entirely for Entire", the marketplace description starts with
  "Unofficial extension for Entire", and the README says the extension is a community
  project, not affiliated with or endorsed by Entire.
- **Only Sessions, Session, Checkpoints and Trails open by default.** Activity, Search,
  Integrations, Control Plane and Account start collapsed, in that order. Commands that
  show one of them still expand it.

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
  sends the editor's own events only to the compatible `copilot-cli` payload format.
  A different `entirely.editorHookAgent` value is reported and never receives a Copilot
  payload. Other installed agents are listed as "not bridged" and are never sent an
  `entire hooks` call, so a hook that exits 0 and records nothing cannot be counted as
  captured. The Copilot stand-down for hook files the editor loads itself is unchanged.
  The install confirmation states that `agent add` cannot preview the files it writes.
  Agent lookups are cached for `entirely.agentLookupCacheSeconds` (30 seconds by default),
  with install and removal refreshing immediately.
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

- **Trails view.** Trails lists the trails of the project this repository belongs to,
  right after Checkpoints. Its badge counts the changes awaiting an approval.

- **Trail review.** Six commands that act on the work on an Entire trail:
  approve a change, comment on one, merge one, check one out, and link or unlink a
  branch to a trail. Each one asks the reviewer to choose what they are
  acting on, and each mutating action is confirmed first — a merge names
  the branch, the base and the commit it would move, and a checkout is
  refused outright while the editor holds unsaved changes.
- **An approval that says whose it is.** The CLI records the forge handle of
  whoever approved a change. The extension compares that handle with the
  login it is acting as, so an approval is attributed rather than merely
  counted.
- **A note that reaches the trail either way.** The CLI refuses a comment
  from an agent session and points at its finding command. The extension
  inherits that refusal when it runs inside an agent session, so it posts
  the finding instead and says which form the note took.

### Fixed

- **The Control Plane view works for GitHub mirror projects.** A project whose name looks
  like `gh:mirrors:<id>` showed "Could not read the repositories: invalid project name",
  because the Entire CLI cannot read a project by a name containing colons. The view now
  hands the CLI the project's id for listing repositories, reading and changing access, and
  deleting the project; the name is still what the tree and every confirmation show. When
  the CLI still rejects a project, the row names it and suggests refreshing.

- **Trail command output is no longer kept in the invocation record.** A trail's reviews,
  comments and findings are the team's own words. The output channel (even at the debug
  level) and the dump command now record only how many bytes a trail command returned.
- **An ignored plugin notification no longer delays the `.mcp.json` offer.** The two
  one-time offers are shown together instead of one after the other.
- **Install in the Integrations view runs in the folder you clicked.** In a multi-root
  workspace the install used the first folder's working directory, so a per-folder
  `PATH` or `ENTIRE_PLUGIN_DIR` was ignored.
- **Turn On changes the setting that is keeping the server off.** `entirely.mcpServerEnabled`
  can now be set per folder. When a folder or workspace value turns it off, that value is
  changed instead of your user setting, and the question names which setting it will change.
- **A suggested plugin that is also an Entire command is no longer "available on PATH".**
  Names such as `mcp` or `completion` show as unknown, with the reason.
- **The sign-in no longer says the machine has no display when Entirely runs on a remote
  host.** In a Remote-SSH, container, WSL, Codespaces or browser-based window the sign-in
  uses a code because the CLI cannot open your browser, says so, and opens the code page in
  your own browser. The note is also gone once the sign-in succeeds.
- A CLI failure now reports what the CLI said rather than only its exit
  code. A project that the acting login cannot see is named as such and
  names the setting to change, instead of showing an empty trail list.
- A finding posted from an agent session no longer asks for a title the CLI
  does not accept. The title is folded into the finding's body, so the
  finding is posted rather than refused for an unknown flag.

### Internal

- A CI check installs the Entire CLI at a pinned version and checks that it
  still answers the way the extension expects — the commands it calls and
  the flags it passes them. The extension reads the CLI rather than
  re-implementing it, so a change in the CLI is a change in the extension's
  contract, and it is better found by a build than by a user.

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
