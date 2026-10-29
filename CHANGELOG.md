# Change Log

All notable changes to the "greysquirr3l.entirely" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- **Session detail.** Selecting a session reads `entire session info`, so the
  view shows when it ended, its last checkpoint, tokens, files touched and a
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
