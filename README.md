# Entirely

<img src="images/hero.png" alt="Entirely" width="128">

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/greysquirr3l/entirely-vscode/badge)](https://scorecard.dev/viewer/?uri=github.com/greysquirr3l/entirely-vscode)

Entirely is an unofficial, community extension. It is not affiliated with or
endorsed by Entire.

A Visual Studio Code extension for [Entire](https://entire.com), the Git
forge built for agent-human collaboration. It is tested with Entire CLI 0.12.2.

Entire records what coding agents did as **sessions**, freezes them into
**checkpoints**, and publishes that history so a team can see what every
agent did and why. The CLI does the work. Entirely is the editor-side
surface for it.

```
Entirely (this extension)
   └── entire CLI  (the source of truth — never re-implemented here)
         └── git refs, session state, the Entire API
```

## What it does

| Surface | What it shows |
|---|---|
| **Status bar** | Whether the workspace is tracked by Entire, and whether an agent session is live right now: `$(entire-logo) Entire` followed by a codicon for the state |
| **Sessions view** | Every session Entire tracks for the repository, across all worktrees, not just the open folder. It can also appear in the Explorer |
| **Session detail** | The selected session in full, ended ones included: agent, model, tokens, files touched and tool calls, with the transcript opening in a read-only editor |
| **Detail panel** | Whatever you select in Sessions, Trails or Activity, by click or by keyboard, opens in one panel beside your code without taking focus: a session in full, a trail or a change with its gate, a commit, an activity session line or a repository. It is reused by every selection, caches what it loaded, and opens the same detail as a read-only document |
| **Session actions** | Stop, attach, adopt and resume a session from the palette or its context menu, each only when you ask |
| **Checkpoint history** | Recorded checkpoints, opening straight into the native diff editor |
| **Why this line** | Which agent edit introduced the line under the cursor, and why |
| **File blame** | `entire blame` for the active file: every line marked as attributed, recorded but not synced, or not attributed to any recorded change |
| **Trails view** | The trails of the project this repository belongs to. A trail's changes are read when you expand it, and a badge counts the changes that await an approval among the open trails it has read |
| **Trail review** | Approve, comment on, merge, check out, link and unlink the work on an Entire trail — each action confirmed, and each merge naming what it merges |
| **Account view** | Who the CLI is signed in as, and which jurisdiction the account belongs to, with sign-in and sign-out |
| **Activity view** | Recent sessions and commits across your repositories on Entire, a recap, and a generated dispatch you can copy |
| **Search view** | Past agent work, commits and code, searched by the CLI in this repository or in all of them (`entirely.searchScope`) |
| **Control Plane view** | Projects, repositories, organisations and clusters you can see, and who has access, with confirmed changes |
| **Integrations view** | Whether each suggested Entire plugin and the Entire MCP server is available in each workspace folder, with click-to-install and click-to-add |
| **MCP server** | Offers `entire mcp` to the editor's agent, and can add it to a project's `.mcp.json` |
| **Capture control** | Turns capture off, removes Entire, edits the repository's Entire settings, cleans session data and sets up trail runners — each previewed where the CLI offers a preview, confirmed in a modal that names the folder and the login, run once and checked by a fresh read. Tested only against a fake CLI (see below) |
| **Agent integrations** | Lists the agents the CLI supports, and installs or removes one after you confirm what it will touch; more than one can be installed |
| **Hook bridge** | Reports the editor's own agent activity to the compatible `copilot-cli` integration; other integrations record their own activity |
| **Terminal PATH repair** | Puts the Entire CLI on the integrated terminal's PATH, through the editor's own settings — no shell profile, no shell command |
| **BYOK models** | Works with whatever model Copilot Chat is using (hosted, BYOK or local) without the extension knowing the model exists |
| **Doctor** | A copyable diagnostic report: CLI version, repository state, effective settings, last error. Also reads the CLI's log and hook traces, writes a diagnostic bundle to a file you choose, and migrates checkpoints to git refs (see below) |

If the CLI is missing, the extension degrades to a clear message with a link
to the install instructions rather than failing obscurely.

## Views

Entirely adds an **Entirely for Entire** container to the activity bar, with
Entire's symbol as its icon. Four views are open by default and five start
collapsed. Commands that show a collapsed view expand it.

| View | Default | Holds |
|---|---|---|
| Sessions | Open | The sessions Entire tracks for the repository |
| Session | Open | The selected session in full |
| Checkpoints | Open | Recorded checkpoints, with search |
| Trails | Open | Trails of the project, and their changes once a trail is expanded |
| Activity | Collapsed | Recent sessions and commits, recap, dispatch |
| Search | Collapsed | Results of a search of past work and code |
| Integrations | Collapsed | Plugins and the MCP server, per folder |
| Control Plane | Collapsed | Projects, repositories, organisations, clusters |
| Account | Collapsed | The login the CLI is using |
| Entirely Sessions (Explorer) | Hidden | The sessions tree, in the Explorer, when `entirely.showSessionsInExplorer` is on |

The status bar item reads `$(entire-logo) Entire` plus a state codicon:
`$(pulse)` for a running session, `$(warning)` for a checkpoint problem or an
unreadable CLI, `$(circle-slash)` when the workspace is not set up,
`$(circle-outline)` for a folder that is not a repository, `$(eye-closed)` when
the login cannot see the workspace, and `$(error)` for a login the CLI does not
have. A workspace that does not use Entire shows nothing.

**Model-agnostic.** No model name, provider or context-window size is
hardcoded. The model is an opaque string, recorded as the transcript reports
it, so a BYOK or local model works the same as a hosted one.

## Status

**Version 0.2.0.** Before 1.0, minor versions may change things. The command
list and the setting names are the surface a user actually touches, so they
are the most likely thing to change.

What the extension covers of the Entire CLI, what it leaves out on purpose,
and what is still a gap is tracked command by command in
[docs/coverage.md](docs/coverage.md). The changes in each version are in the
[changelog](CHANGELOG.md).

## Screenshots

The sessions Entire tracks for the repository, with the details of the
selected one beside them:

![The Entirely view, showing the sessions Entire tracks and the details of the selected session](images/sessions.png)

Every CLI invocation the extension made, in the `Entire` output channel:

![The Entire output channel, showing each CLI invocation and what it returned](images/output.png)

## The detail panel

Click a row in Sessions, Trails or Activity, or move to it with the arrow keys
(Enter does the same), and its detail opens in a panel in the editor area, beside
the file you are working in. The sidebar lists stay the list; the panel is the
detail. It is one panel: the first selection opens it, every later selection
replaces what it shows and renames its tab, and closing it and selecting again
opens it again. It never takes keyboard focus from the row you chose.

Each selection reads the item once. A click that also changes the selection, or
the same row chosen twice, does not read twice, and a slow read for an earlier
row never replaces a later one. The panel's own links are **Refresh**, which
skips the cache for the selected item, and **Open as text**, which opens the
same detail as a read-only document (also in the editor title bar while the
panel is active).

What each kind shows, and what it cannot:

| Selected | Shown | Not shown |
|---|---|---|
| Session (any group, any state) | The rows below, from `session info`, `session tokens` and the transcript | Nothing is added |
| Trail change | The change (title, `repository/number`, branch, status, gate, approval count, blockers) and, from one `entire trail show`, the parent trail's type, priority, page, whether it has a description, and the other changes | Base branch and head commit, approver handles, comment and finding counts, linked items: each needs a read of its own or is not in the data |
| Project trail | Its fields, whether it has a description, and its changes (with their gates once the trail has been expanded) | The same as above |
| Activity commit | The short hash, title, repository and the CLI's own detail text, whole, and **Copy hash** | A checkpoint id: the CLI's line has none, so there is no open-checkpoint link |
| Activity session line | The text as the CLI printed it | A link to the session: the line carries no session id, and the extension does not guess one |
| Activity repository | Its name and count, the scope line and the overview figures | A link to the Control Plane: the name carries no forge |

A trail description is not in the panel. The panel says one exists, and **Open
as text** writes it to the document; it is never written to the `Entire` output
channel.

On a change, Approve, Comment, Merge, Check out, Link branch and Unlink branch
are links to the same commands the palette has, with their own confirmations.
They act on the change shown instead of asking which one. Approve, which the
palette confirms by your picking the change, asks "Approve *change* as *login*?"
in a modal when it comes from the panel or a row. Each command checks
that it was given the item the panel shows before it acts.

The panel is a web page with no script: text and links, a strict
Content-Security-Policy, every word from the CLI escaped, and colours taken from
your theme, so light, dark and high-contrast themes all work. The links are
real links with visible text and a focus outline, so Tab and Enter work. The panel,
its reveal behaviour and the click handling were tested only against stand-ins for
the editor; check them by hand in a real window.

Selecting costs at most one CLI call, and only a read: a session uses its three
usual reads, a trail or change one `trail show`, and an Activity row none (it is
drawn from the text Activity already read). The change's gate comes from the
Trails view, so the merge check is not run again. A repeat selection inside
`entirely.selectionCacheSeconds` (default 30; `0` reads every time) shows the
cached content at once with an "as of" time. After that time the old content is
still shown while it is read again, and a failed re-read leaves it in place with
a "Could not refresh" line. Ended sessions and Activity rows cannot change, so
they are kept ten times as long. A failed read is a message in the panel with a
Retry link, never a popup. A trail or change that was merged or deleted says
so. With no CLI, or one without `trail show`, a trail or change keeps its
listing fields with a line that says why the rest is missing, and sessions and
Activity still load. Nothing here polls.

The editor keeps its own highlight on the last row chosen in each view, and an
extension cannot clear it. Entirely marks the row the panel shows with a blue
dot and label colour, and clears that mark in the other two views.

## Trails and their changes

`entire trail list` does not carry a trail's changes, so the Trails view lists
the trails first and shows "changes not loaded" beside each. Expanding a trail
(or selecting it) reads `entire trail show` once and the change rows appear, each
with its merge gate. A merged change says so, and a change whose branch is gone
shows "no branch". What was read is kept for `entirely.selectionCacheSeconds`, so
expanding it again reads nothing.

The badge on the view counts the changes awaiting an approval among the trails
that have been read. When you refresh the view, or after an action, Entirely
reads up to `entirely.trailBadgeLimit` (default 10) open trails, three at a time,
for that count; the tooltip says how many of the open trails it covers. The
background refresh never reads them, so the badge is the count as of your last
refresh, and a trail you expand adds to it.

## Session detail and transcripts

Select a session and the Session view and the detail panel fill in from `entire session info`:
when it ended, its last checkpoint, the files it touched and how many times
each tool was called. A session that has ended is inspected the
same way as a live one.

Token usage comes from `entire session tokens` rather than from the counts in
`session info`, and an opened checkpoint shows a **Tokens** row from `entire
checkpoint tokens`. The extension shows what the CLI reports and nothing
else: it adds nothing up and estimates nothing. When the CLI reports no usage,
or leaves one count out, the row says **Not reported** instead of showing 0.
Usage in a shape the extension cannot read says **Not recognised**, and a
failed CLI call says **Not available**.
Model names appear exactly as the CLI sends them.

The transcript is not in the tree. **Transcript** in the Session view, or the
button on a session, opens it in a read-only editor beside its attribution
and a tool call summary. It is read from `entire session info --transcript`,
which streams the agent's own format; Claude Code, Cursor, Codex and Copilot
CLI transcripts are understood, and any other format is shown as raw text.
The editor holds the first 4 million characters, and the extension reads at
most 16 MB from the CLI, saying so when it cuts a transcript short.
`entirely.transcriptTimeout` sets how long to wait for the CLI.

The transcript is your own conversation with the agent, so it is never
written to the `Entire` output channel, not even at the debug level.

The filter button in the Sessions view narrows the tree to the session that
belongs to this workspace, using `entire session current`. A session the CLI
reports as belonging to another worktree is not offered.

## Stopping, attaching, adopting and resuming sessions

Right-click a session in the Sessions view, or use the palette (**Entirely: Stop
Session**, **Attach Session to a Commit**, **Adopt Session from Another Worktree**,
**Resume Session**). Nothing here runs unless you choose it, and none of it runs on
the refresh timer. Each command's flags are read from `entire agent-help session
<command>`; if the help is unreadable or lacks a flag, the action fails and says why.

- **Stop** asks first, naming the session (id, agent and branch), then runs
  `entire session stop`. Stopping ends capture and writes no checkpoint, so commit
  first if work is pending.
- **Attach** lets you pick the session (or type an id the view does not list) and
  the commit (default `HEAD`). The CLI first describes what it would do, including
  whether it would rewrite unpushed commits. That description is the confirmation
  you are shown, and only if you agree does the extension rerun it for real. The
  message that follows is the CLI's own account of what it linked.
- **Adopt** takes an active session from another worktree after you confirm it,
  then refreshes the tree and says whether the session is listed for this workspace.
- **Resume** runs `entire session resume <branch>` in an integrated terminal, because
  the CLI asks whether to start the agent. The extension cannot see your answer, so
  it does not assume the work started: it watches the session list for up to
  `entirely.resumeWatchTimeout` seconds and reports that the session is active
  again, or that none appeared (with the terminal's exit code if it had ended).
  Resume asks you to confirm the branch it will check out, and refuses while any
  file in the workspace has unsaved changes (it names them). A second Resume on a
  branch already being watched starts nothing, and closing the window stops the watch.

`entirely.lifecycleActionTimeout` sets how long stop, attach and adopt may take.

## Agent integrations

**Entirely: Set Up Agent Integrations** shows the agents `entire agent list` prints, with
a tick on the ones installed in this repository. Pick one to install it (or, for an
installed one, remove or reinstall it). The confirmation says Entire will write that
agent's hook configuration into the repository and may update `.entire/`; declining
changes nothing. After the CLI finishes, the extension shows the files it lists to
commit and reads `agent list` again, so what you are told is installed is what the
CLI reports. Reinstall is offered only if `entire agent-help agent add` describes a
reinstall flag. The command runs only when you choose it.

Installing an agent and bridging it are different things. Every integration the CLI
ships runs its own hooks through its own program, and those hooks report that agent's
activity to Entire. The editor's events currently use the `copilot-cli` payload format,
so only that integration can receive them; a different `entirely.editorHookAgent` value
is reported in the output channel and is not forwarded. Every other installed agent is
listed as "not bridged" and is never sent anything, because a hook verb with the same
name as an editor event does not mean the agent reads the editor's payload: the CLI exits
0 and records nothing. The agent names come from the CLI. `entirely.agentLookupCacheSeconds`
sets how long the agent list and hook-file scan are reused (default 30 seconds); install
and removal refresh them immediately. `agent add` has no preview, so the install
confirmation says it cannot list the files in advance and Entirely shows the CLI's own
list afterwards.
`entirely.lifecycleActionTimeout` sets how long an install or removal may take.

## Stopping, configuring and cleaning capture

Five commands change what Entire does in the open repository. None of them runs on its
own, none retries, and each one asks first with a modal that names the folder, the
file or data it touches, the login it will run as, and that the change is to this
checkout on this machine only. Every flag is read from the CLI's own help when the
command runs, so a flag the help does not describe is never passed and the action says
what is missing. If the CLI is missing, or lacks the command, the message says so and
nothing runs.

**These flows were tested only against a fake CLI.** `entire disable`, `configure`,
`clean` and `runner setup` were not run against the real CLI: only their help was read.
Their real output and exit codes are unobserved.

- **Disable Capture** (`entire disable`). You pick the settings file: this checkout only
  (`.entire/settings.local.json`) or the shared one (`.entire/settings.json`, usually
  committed). Hooks then exit silently; nothing is removed. Live sessions are named in
  the question. A fresh `status --json` decides the result: if Entire still reports as
  enabled, the result is "unconfirmed", not "done". The result offers **Set Up Again**,
  which is the status bar's own set-up flow.
- **Remove Entire from This Repository** (`disable --uninstall`). The CLI has no preview
  for this, and the question says so. It lists what the CLI's help says is removed, names
  the hook files found in the workspace, and you must type the folder's name. Only then
  is the CLI's skip-confirmation flag passed. A fresh read of status, the `.entire`
  directory and the hook files decides the result, and a partial failure lists what is
  left.
- **Clean Session Data** (`entire clean`, from the palette or **Clean Session Data** on a
  session). You pick the scope: this HEAD, all session data, or one session. The CLI's
  own dry run runs first and opens in a read-only editor; the question follows, with
  one line of the preview. The skip-confirmation flag also overrides the CLI's own
  live-session guard, so it is passed only after you confirm here: live sessions in scope
  are named and the button reads **Delete anyway**. Cleaning everything, or cleaning with
  a CLI that has no preview, also needs the folder name typed. The result is checked
  against a fresh session list.
- **Configure Entire Settings** (`entire configure`). You see the current value and file of
  each setting, tick the ones to change, give values (backend choices and remote providers
  come from the help), and pick the file. Only those settings and the file are passed.
  Telemetry, absolute hook path, checkpoint remote and checkpoint backend are read back
  from the settings files and verified; the others are reported as written, with the
  editor unable to read them back. A value missing or overridden by a higher settings
  file makes the result unconfirmed. User-level settings are not written.
- **Set Up Trail Runners** (`entire runner setup`). **Create default runners** and **Show the
  tailoring prompt** call no summary provider (the second creates missing default files
  first). **Preview tailoring** and **Tailor runners to this repository** send signals
  about the repository (docs and structure, merged pull requests and issues, checkpoint
  hotspots, past trail findings) to the summary provider Entire is configured with, so
  each is its own question. You can choose the data sources, one runner, and an agent
  for that run only. The files under `.entire/runners` are listed before and after. The
  debug-directory flag is never passed.

Every flow ends by refreshing the status bar, the Account view and the Sessions view from
a fresh read. The CLI's output stays out of the output channel; the preview, the
tailoring diff and the prompt open in read-only documents held in memory.
`entirely.captureControlTimeout` and `entirely.runnerSetupTimeout` set how long the
commands wait.

## Importing past agent history

**Entirely: Import Past Agent History as Read-Only Checkpoints** brings an agent's
existing local transcripts (the CLI reads the past month) into Entire. It runs only
when you choose it. The agents come from `entire import --help`, and the flags from
`entire import <agent> --help`, because the CLI's `agent-help` does not list
experimental commands. The CLI's import is itself experimental, so its behaviour and
output may change between CLI versions, and the confirmation says so.

1. Pick the agent, then all sessions or the session ids you type.
2. The extension runs the CLI's dry run (`--dry-run`) and shows its report, such as
   `Would import 3 turn(s) from 1 session(s) (2 already imported).` That text is the
   confirmation. If the CLI offers no preview flag, the extension will not import.
   Declining changes nothing.
3. The import runs with a progress notification you can cancel. Cancelling stops
   the CLI; turns already written stay, and running the import again skips them.
   `entirely.importTimeout` sets how long it may take.

Imported checkpoints and sessions are marked read-only (lock icon, "Imported ·
read-only") and are not offered Stop, Attach, Adopt or Resume. The CLI marks imported
sessions in `session list --json` (`kind: "imported"`, `read_only: true`); the
checkpoint list carries no marker, so the tree joins it to the session list.

## Blaming a file

**Entirely: Blame This File** runs `entire blame` on the active file when you ask,
never on a timer or while you type. Each line gets a coloured bar and a short note:
purple for a recorded change (agent or commit), orange for a recorded change whose
checkpoint has not synced to this machine yet, and grey for a line with no recorded
change at all, which reads "Not attributed to any recorded change". The whole-file
answer opens in the same panel as **Why Does This Line Exist?**, drawn by the same
code, and the hover on a line links to that command, so the answer for a line is the
same either way.

The CLI blames the saved file, so a file with unsaved changes asks to be saved
first. Marks are removed when you edit the file (the line numbers would no longer
match) or run **Entirely: Clear Blame**. Files longer than
`entirely.blameMaxDecoratedLines` (default 5000) are blamed and shown in the panel
but not marked in the editor. `entire blame` is a labs command and the CLI may change
its output.

## Searching checkpoints

The search button in the Checkpoints view opens a box. As you type, the extension
runs `entire checkpoint search` and the tree narrows to the checkpoints it found.
The matching is the CLI's, never a local filter over the list, and the CLI needs
a login and a published repository. The extension reads the command's flags from
`entire agent-help checkpoint search` instead of keeping its own list.

The view says one of three things. It lists the matches. It says **No checkpoint
matched**, which means the search ran and found none. Or it says **The search
failed** and gives the reason, such as the CLI missing, too old to have the
command, or not signed in; a failed search never claims there were no matches.
The search returns commits and sessions too, and only checkpoints are listed; the
message counts the others. The clear button restores the full list.

`entirely.searchDebounce` sets how long to wait after you stop typing. Your query
stays in the editor: it is not written to the `Entire` output channel, and the
results are kept out of it too.

## The control plane

The **Control Plane** view lists the projects, repositories, organisations and
clusters the acting login can see, and who has access to each. Open it with
**Entirely: Open Control Plane**. The first line says which login the view is
shown as. Nothing polls: a level is read when you open it and again on refresh.

From the view you can create a repository, change its visibility, give someone a
role, take their access away, and delete a repository, a project or an
organisation. Every one of these changes Entire for everyone, so each asks first
in a dialog that names what it affects and the login it acts as. Nothing runs
until you agree, the change runs as exactly that login, and afterwards the
extension reads the listing again: a change is reported as done only when the
CLI now lists it that way. A repository that has mirrors on other clusters is
refused first, and you are asked again before the mirrors are deleted too.

**Entirely: Call the Entire API** runs one `entire api` call: a path, a method
and, if the CLI offers one, a backend. A read runs as typed; any other method is
confirmed first. The response opens in a document and is not written to the
`Entire` output channel. The call runs once and is never retried, and no view or
background task can reach it.

Flags and the values they take (roles, visibility, backends) are read from
`entire agent-help` for each command, never from a list in the extension. A CLI
that lacks a command, or does not describe a flag the extension needs, is
reported and nothing is run. `entirely.controlPlaneTimeout` (default 60 seconds)
bounds each call.

## Plugins, the MCP server and the Integrations view

The **Integrations** view shows one row for every plugin in `entirely.suggestedPlugins`
(default `graph`, `investigate` and `brain`), every other plugin `entire plugin list`
holds, and the Entire MCP server. A plugin is *installed* when the CLI lists it,
*available on PATH* when the CLI answers for it without listing it, and *not
installed* only when the CLI says so; any other failure is shown as unknown, with
the reason. With more than one workspace folder the rows are grouped by folder.

Status is read per folder, with the CLI run from that folder, so a per-folder
`PATH` or `ENTIRE_PLUGIN_DIR` (direnv, for example) and a workspace setting for
`entirely.mcpServerEnabled` show up in that folder's rows. The view is read when
it opens, on its refresh button, after an install or change, and when the
workspace folders or those settings change. It never polls.

- **Install** on a missing plugin runs the same install as **Entirely: Install
  Plugin**: a dialog names what is downloaded and the login it runs as.
- **Turn On** on an MCP server that is off asks before it changes a setting, and the
  question names which one: the folder's or the workspace's own value when that is
  what keeps the server off, otherwise your user setting.
- **Add** on the MCP server's project row adds an `entire` entry to the project's
  `.mcp.json` after a dialog that names the file. The file is created if it is
  missing. Every other entry and key is kept as it is, in the same order and
  indentation. The entry is `command: "entire"` with the CLI's own `mcp`
  arguments: no path to your CLI and no login name, because the file is usually
  committed. `.vscode/mcp.json` is used only when it already exists and
  `.mcp.json` does not. A file with comments or other non-JSON content is never
  rewritten; you are shown what to add instead. A project that already lists
  the Entire server, under any name, is shown as configured and left alone.

Separately, the extension registers `entire mcp` as an MCP server for the
editor's own agent (`entirely.mcpServerEnabled`, on by default). The editor
starts and stops the process. **Entirely: Start MCP Server** starts it, and
**Entirely: Copy MCP Server Configuration** copies the entry for other tools.
That provider writes no configuration file. Only **Add** in the Integrations
view writes `.mcp.json`.

Two questions are asked once, and both can be on screen together: the first time missing plugins are found, one
notification lists them and offers to install the ones you pick (once per
machine, recorded when it is shown); and the first time a project's MCP
configuration lacks the server, one notification offers to add it (once per
project). Set `entirely.offerIntegrationInstall` to `false` to never be asked.
Neither question appears when the CLI is missing or too old; the view then says
so and links to the install instructions.

## The terminal PATH

The Entire CLI installs to `~/.local/bin`, which the integrated terminal
does not inherit. The extension itself is unaffected — it runs the CLI by
absolute path — but a terminal you open in the editor cannot run `entire`.

Entirely offers to fix that: **Entirely: Add the Entire CLI to the Terminal
PATH**. The repair is the editor's own terminal environment, so the only
thing that changes is a setting the editor already owns. No shell profile is
read or written, and no shell command is run.

You choose the scope, and each one says what it costs before you pick it:

| Scope | What it touches |
|---|---|
| This workspace folder | That folder's own settings file |
| This workspace | The workspace settings file — which may be committed |
| Your user settings | Every window you open; nothing in a repository changes |

The value written is `${env:PATH}` with the CLI's directory on the end. The
inherited PATH is a *reference*, not a copy, so the terminal takes the live
PATH rather than a snapshot of it taken when the setting was written.

Running the command again takes the directory off again.

## Privacy

- Transcripts, prompt bodies, checkpoint payloads, search queries and API
  responses are never written to the `Entire` output channel, not even with
  debug on. The channel records byte counts instead, and operands that carry
  such content are redacted in the logged command line.
- The content of the last CLI call is available only through **Entirely:
  Doctor: Show the Last Entire CLI Output**.
- The extension reads no credentials. Tokens stay in the CLI's own store.
- Anything that changes Entire or your repository is confirmed first, and says
  what it will touch.
- The extension opens only Entire addresses in your browser.

## When something is not working

Everything the extension does goes to one output channel, named **Entire**.
Every call to the CLI is written there with the exact command line, the
directory it ran in, and the exit code — enough to reproduce a problem by
hand.

```
[info] entire: /usr/local/bin/entire status --json
[info]   cwd: /work/entirely
[info]   exit: 0 (ok, 14ms); stdout 1.2 kB, stderr 0 B, stdin 0 B
```

Prompt bodies and checkpoint payloads are **not** written there. The channel
says how many bytes there were, and the content itself is behind
**Entirely: Doctor: Show the Last Entire CLI Output**, for the times when
you really do want to read it.

**Entirely: Doctor: Copy a Diagnostic Report** answers "why is this not
working?". It reports the CLI's path, version and location; whether the
workspace is a git repository and whether Entire is enabled for it; the
settings in effect; and the last error the CLI gave. The report is one
block of text and one action to copy it, because it is usually on its way
into an issue.

The report also carries the CLI's own verdict on the capture pipeline, from
`entire doctor`, under "Capture pipeline". A healthy pipeline is reported as
healthy; each problem the CLI finds is listed as a finding with its reason and
fix. A failing or timed-out `entire doctor`, and a CLI too old to have the
command, are reported as such rather than left blank. The extension runs the
command without flags, so it only reports and never repairs (`entire doctor
--force` is yours to run). Only each finding's headline and its reason and fix
lines reach the report; the full text is behind **Entirely: Doctor: Show the
CLI's Full Diagnostic Output**. `entirely.cliDoctorTimeout` sets how long the
report waits for it.

Turn the volume up with `entirely.debug`, or with `entirely.logLevel` for
finer control. There is still only one channel.

### The CLI's log, hook traces, bundle and checkpoint migration

Four more `entire doctor` subcommands are reachable from the Command Palette.
None of them writes what it reads to the output channel; the channel records
the command line and the size.

- **Entirely: Doctor: Show the CLI Log** opens the newest lines of the CLI's
  operational log (`entirely.doctorLogLines`, default 200) in a read-only
  document with a Copy action. Following the log live (`entire doctor logs
  --follow`) is left to the terminal.
- **Entirely: Doctor: Show Hook Traces** asks for the latest trace, the last N,
  a summary or only the slow ones, and an optional hook name. Only options the
  CLI's help describes are offered.
- A log, trace or migration report longer than `entirely.doctorOutputMaxKilobytes`
  (default 512) opens cut, with a banner that says how much was left out, and
  **Save the whole output** writes all of it to a file you choose.
- **Entirely: Doctor: Write a Diagnostic Bundle** first says what the archive
  holds (the CLI's logs, your Entire settings and a git snapshot; secrets are
  redacted by pattern, prompts and file paths are not), then asks for a `.zip`
  path. The path must be absolute, in an existing folder, not a link, and not
  inside `.git` or `.entire`; replacing a file is confirmed by name. The file is
  read back to check it is a zip archive, and offered with Reveal and Copy Path.
  The CLI first writes to a hidden temporary `.zip` beside your file; only a
  finished, checked archive is moved into place (a rename when you agreed to
  replace a file, a link that refuses to overwrite otherwise), and the temporary
  file is removed on every failure or cancel, so a failed run never changes your
  file. The path is checked again just before the write. The archive is never
  opened in the editor. **Entirely: Doctor: Write an Unredacted
  Diagnostic Bundle** is a separate command behind its own strict confirmation.
  The real CLI's acceptance of a hidden `.entirely-<random>.zip` name for its output path has not been observed. If it refuses or ignores that name, the command reports a failure or "unconfirmed", removes the temporary file, and places nothing at the chosen path.
- **Entirely: Doctor: Migrate Checkpoints to Git Refs** opens the CLI's dry run
  first. Only then does it offer the migration, which names the repository and
  the login it will run as, runs once, never pushes, and is checked by counting
  the `refs/entire/checkpoints/` refs before and after.

These flows were tested only against a fake CLI, and only the help of the four
subcommands was read from the real one. The real CLI's output formats for them
were not observed, and `doctor bundle` and `doctor migrate-checkpoints` have not
been run against it.

## Two Entire accounts

If you have more than one Entire login, the status bar tooltip says which one
the extension is acting as, the Account view says the same thing, and the
doctor report counts the saved logins.

`entirely.cliContext` pins one of them for the extension. The name is the one
`entire auth contexts` prints — `us.auth.entire.io`, or
`handle@us.auth.entire.io` for a second identity on a host that already has
one. Leave it empty and the extension follows the login the CLI is using on
its own.

The pin changes what the extension does. The CLI keeps the login it would have
used in your terminal, and a workspace the pinned login cannot see is said to
be invisible to that login rather than to be untracked.

A project is per-login too, not just a repository. A trail belongs to the
project, so a login that cannot see the project cannot review its trails:
the extension says so and names the setting to change, rather than showing
an empty list that looks like there is no work.

Who can see a project is the CLI's business, and it differs by where the
project came from. A project you made in Entire is shared with the people
you grant it to, and each of them sees it under their own login — so a
reviewer approves under their own name, and the trail records who did what.
A project that mirrors a GitHub owner is not granted like that: its
membership follows GitHub, so a collaborator on the repository can see the
repository without being able to see the project that holds its trails.
That is a GitHub-shaped rule, and the extension reports it as the login it
is rather than as an empty list.

## Signing in and out

The Account view reads `entire auth status --json` and shows the handle the
CLI is signed in as and the jurisdiction of the account — the country whose
law the account falls under, which is not always the country you are in. When
nobody is signed in, the view says so and offers to sign in; when the CLI
could not be asked, it says it does not know, rather than claiming that nobody
is signed in.

**Sign In to Entire** runs the CLI's login. On a desktop window it offers
the browser flow or a device code. In a remote window (Remote-SSH, a
container, WSL, Codespaces or a browser-based editor) the CLI cannot open your
browser, so Entirely uses a code, says so, and opens the code page in your own
browser. The code you have to type is shown in a panel while the command
waits, because the command does not finish until you approve it.

**Sign Out of Entire** says what it is about to do before it does it: every
login saved on this machine is signed out, not only the one in use, and every
CLI session on the login server ends too. The CLI will not narrow that, and
the extension does not pretend otherwise.

The extension never reads the credential store — the keychain, the secret
service, or the file-backed fallback — and never asks the CLI for a
credential. What it shows you is where the credentials are kept, not the
credentials themselves.

## Settings

Every setting is under `entirely.` and is in the Settings editor. Times are in
seconds unless noted. `cliPath` and `cliContext` can be set in user or
remote-machine settings, never workspace settings.

| Setting | Default | What it does |
|---|---|---|
| `cliPath` | empty | Absolute path to `entire`. Empty means `PATH`, then the documented install locations |
| `cliContext` | empty | The saved login to act as. Empty follows the CLI's own login |
| `minimumCliVersion` | `0.12.2` | The oldest CLI whose output is read in full |
| `refreshInterval` | `30` | How often to re-read workspace and session state. `0` means only when a command runs |
| `showSessionsInExplorer` | `false` | Also show the sessions tree in the Explorer |
| `logLevel` | `info` | `error`, `warn`, `info`, `debug` or `trace` |
| `debug` | `false` | Say more in the output channel, same as the `debug` log level |
| `editorHookAgent` | `copilot-cli` | The integration the editor's own agent events are forwarded to |
| `agentLookupCacheSeconds` | `30` | How long the agent list and hook-file scan are reused |
| `suggestedPlugins` | `graph`, `investigate`, `brain` | Plugins the Integrations view shows |
| `mcpServerEnabled` | `true` | Offer `entire mcp` to the editor as an MCP server |
| `offerIntegrationInstall` | `true` | Offer once to install missing plugins, and once per project to add the MCP server to `.mcp.json` |
| `searchScope` | `repository` | `repository` or `all-repositories` for the Search view |
| `searchDebounce` | `400` | Milliseconds to wait after you stop typing in checkpoint search |
| `blameMaxDecoratedLines` | `5000` | Longest file marked in the editor by Blame |
| `transcriptTimeout` | `60` | Opening a transcript |
| `trailActionTimeout` | `60` | A trail review action, and each `trail show` the Trails view and the detail panel make |
| `selectionCacheSeconds` | `30` | How long the detail panel and the Trails view keep what they loaded. `0` reads every time; ended sessions and Activity rows keep ten times as long |
| `trailBadgeLimit` | `10` | How many open trails are read, on a refresh you ask for, to count the changes awaiting approval. `0` shows no count |
| `lifecycleActionTimeout` | `60` | Stop, attach, adopt, and agent install and removal |
| `resumeWatchTimeout` | `60` | How long Resume watches for the session to become active |
| `importTimeout` | `300` | Importing past agent history |
| `cliDoctorTimeout` | `30` | The CLI's own doctor check in the report |
| `controlPlaneTimeout` | `60` | Each Control Plane and API call |
| `activityTimeout` | `30` | Activity and recap |
| `dispatchTimeout` | `180` | Generating a dispatch |
| `pluginTimeout` | `120` | Running or installing a plugin |
| `doctorLogLines` | `200` | Lines of the CLI log shown (10 to 5000, never all) |
| `doctorTraceCount` | `5` | Hook traces asked for by default (1 to 200) |
| `doctorOutputMaxKilobytes` | `512` | Size past which a log, trace or report opens cut (16 to 4096) |
| `doctorReadTimeout` | `30` | The log, traces and the migration dry run |
| `doctorBundleTimeout` | `120` | Writing a diagnostic bundle |
| `migrateCheckpointsTimeout` | `300` | The checkpoint migration |

## Requirements

* The [Entire CLI](https://docs.entire.com/installation). `entire version`
  must run. Without it the extension shows how to install it and does nothing
  else. It is tested with CLI 0.12.2 (`entirely.minimumCliVersion`); an older
  CLI works, and the doctor report says what will be missing.
* VS Code 1.140 or newer (`engines.vscode` is `^1.140.0`).

The extension runs in the workspace host, so in a remote window the CLI must
be installed on the remote machine.

## Install

Until it is on the Visual Studio Marketplace or Open VSX, install a `.vsix`
from a [GitHub release](https://github.com/greysquirr3l/entirely-vscode/releases)
with **Extensions: Install from VSIX**. Then open a folder that uses Entire.
If the CLI is not on `PATH`, set `entirely.cliPath`.

## Maintaining

Opening a pull request here has two rules that are not obvious, and both
cost a day the first time they were met:

1. **Open the pull request as the author of the commits.** The `main`
   ruleset asks for an approval from an account that is neither the pull
   request's author nor the commit's author when the two differ, and a
   pull request's author cannot approve their own pull request.
2. **Expect the Entire gate to end `neutral`,** which GitHub treats as
   passing. `failure` blocks the merge.

The reasoning, the timeline and everything else that was learned the hard
way is in
[docs/post-mortem-entire-gates.md](docs/post-mortem-entire-gates.md).

## Development

```sh
npm install
npm run compile     # type check, lint, bundle
npm test            # extension-host tests
npm run watch       # rebuild on change
```

### Tests

The extension-host tests live in `src/test/` and run inside a real VS Code
extension host. The runner is [`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli),
configured by `.vscode-test.mjs`:

```sh
npm run compile-tests   # compile the tests to out/
npm test                # run them in a headless extension host
```

Install the
[VS Code Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
to run the same suite from inside the editor. It reads the same
`.vscode-test.mjs`, discovers the compiled test files under `out/test/`, and
runs them in a debuggable Extension Development Host — so failures land in the
Testing view with source-mapped stack traces instead of in a terminal.

The runner executes the compiled JavaScript, not the TypeScript sources, so
compile the tests first — `npm run compile-tests`, or keep `npm run watch-tests`
running in the background.

No extra configuration is needed: `sourceMap` is on in `tsconfig.json` and
`.vscodeignore` excludes `**/*.map`, so stack traces point back at the
original TypeScript. On a remote without a display, set
`extension-test-runner.wrapper` to `xvfb-run`.

### The CLI contract

The extension does not re-implement the CLI: it asks the CLI how a command
is invoked and decodes the JSON the CLI prints. Both are contracts, and a
contract that changes without the extension noticing shows up later as a
mysterious failure in someone's editor rather than as a failed build.

`npm run check:cli` checks the installed CLI against the commands and flags
the extension uses:

```sh
npm run check:cli   # needs the Entire CLI on PATH
```

It needs no account and no network — `entire agent-help` describes a command
from the binary itself. The same check runs in CI, against a pinned CLI
version, so a change in the CLI is a deliberate bump rather than a surprise
for the people using the extension.

### Releasing

A release is a tag. Push a tag such as `v0.2.0` and the `Release` workflow builds the
package, checks what is in it, publishes it to the Visual Studio Marketplace
and to Open VSX, and then makes a GitHub release with the `.vsix` attached.
A tag whose version does not match `package.json` stops the build rather
than publishing the wrong version.

Two repository secrets are needed:

| Secret | What it is |
|---|---|
| `VSCE_PAT` | A personal access token for the Marketplace publisher |
| `OVSX_PAT` | A personal access token for the Open VSX namespace |

The workflow can also be run by hand from the Actions tab. Leave the version
empty to build the version in the manifest, and leave **Publish** off to
build and check the package without publishing it — a dry run.

The `marketplace` and `openvsx` jobs use GitHub environments, so either
one can be made to wait for a review before it publishes.

## Licence

MIT

## Trademarks

Entire and the Entire symbol are trademarks of Entire Inc. Entirely uses the
symbol unmodified, only to identify the integration. Entirely is not affiliated
with or endorsed by Entire. See [assets/brand/README.md](assets/brand/README.md)
and [docs/icon-font.md](docs/icon-font.md).

## Issues

Found something broken, or want to see something built? The repository and
issue tracker live at
[greysquirr3l/entirely-vscode](https://github.com/greysquirr3l/entirely-vscode).
To report a security problem, see [SECURITY.md](SECURITY.md).
