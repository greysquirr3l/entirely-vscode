# Entire CLI 0.12.2 — integration surface

Recovered by installing and exercising the CLI (v0.12.2, released 2026-10-26).
Everything below is observed behaviour, not vendor documentation.

## Install

`curl -fsSL https://entire.com/install.sh | bash`

* Release origins, in order: `https://install.entire.com` then GitHub
  (`github.com/entireio/cli`).
* Channel manifest: `https://install.entire.com/channels/<stable|nightly>.json`
  → `{ "channel", "tag", "version", "published_at" }`.
* Artifacts: `<base>/v<version>/entire_<os>_<arch>.tar.gz`, plus
  `entire_windows_<arch>.zip` and `checksums.txt`.
* macOS/Linux only. Windows uses `install.ps1` or Scoop.
* Installs to `~/.local/bin`; also ships `git-remote-entire` (a git remote
  helper for `entire://` URLs) and shell completions.

## Command surface

```
entire setup      agent clean configure disable doctor enable plugin status
entire sessions   activity checkpoint dispatch recap search session
entire trails     trail
entire account    auth login logout
entire control    api cluster org project repo
entire other      agent-help help labs version
```

### `entire status`

```
entire status [--detailed] [--json]
```

Not a Git repository:

```json
{"enabled": false, "agents": null, "active_sessions": null, "error": "not a git repository"}
```

Tracked repository:

```json
{
  "enabled": true,
  "agents": ["Copilot CLI"],
  "active_sessions": [
    {
      "agent": "Copilot CLI",
      "session_id": "abc-123",
      "worktree_path": "/work/sandbox",
      "branch": "master",
      "status": "active"
    }
  ],
  "agent_help": "entire agent-help"
}
```

Note the shapes differ between the two cases: `agents` and `active_sessions`
are **arrays** when the repository is tracked and **null** when it is not.
`error` appears only in the untracked case, and `agent_help` only in the
tracked one. A decoder must handle both, and must treat a non-null `error`
as a state rather than a failure — `"not a git repository"` is the normal
answer for a workspace that is not a repository.

`--detailed` prints the per-settings-file breakdown, which is the only way
to see *which* settings file supplied a value.

### `entire session`

| Subcommand | Purpose |
|---|---|
| `list` | All sessions across all worktrees |
| `info <id>` | Detailed information for one session |
| `tokens` | Token usage and optimisation recommendations |
| `stop` | Stop one or more active sessions |
| `current` | The active session for the current worktree |
| `attach` | Attach an existing agent session |
| `adopt` | Adopt an active session from another worktree |
| `resume` | Switch to a branch and resume its session |

`entire session list --json`:

```json
[
  {
    "session_id": "abc-123",
    "agent": "Copilot CLI",
    "status": "active",
    "branch": "master",
    "worktree_path": "/work/sandbox",
    "started_at": "2026-10-26T23:34:45.832442304Z",
    "last_active": "2026-10-26T23:34:50.249468583Z",
    "turns": 0,
    "pending_turns": 0,
    "checkpoints": 0,
    "last_prompt": "add a test"
  }
]
```

`entire session current --json` adds `"resolution": "worktree"`.

### `entire checkpoint`

`list`, `explain <id|sha>`, `tokens <id>`, `search "<query>"`, `delete <id>`.

### `entire agent`

```
entire agent list
entire agent add <name> [--force] [--search-skill] [--agent-help-skill entire agent-help]
entire agent remove <name>
```

Available agents: `antigravity`, `claude-code`, `codex`, `copilot-cli`,
`cursor`, `factoryai-droid`, `opencode`, `pi`.

## What `entire enable --agent copilot-cli` installs

Files created in the repo:

```
.entire/settings.json          project settings (committed)
.entire/.gitignore             tmp/ settings.local.json metadata/ logs/ redactors/local/
.github/hooks/entire.json      Copilot CLI hook config (committed)
.git/hooks/commit-msg
.git/hooks/post-commit
.git/hooks/post-rewrite
.git/hooks/pre-push
.git/hooks/prepare-commit-msg
```

`.entire/settings.json`:

```json
{
  "enabled": true,
  "checkpoints": { "primary": { "type": "git-refs" } }
}
```

Existing git hooks are preserved as `<hook>.pre-entire` and run *after*
Entire's hook.

## The Copilot CLI hook protocol

`.github/hooks/entire.json` is the Copilot CLI hooks config. It maps nine
Copilot CLI events to `entire hooks copilot-cli <event>`:

| Copilot CLI event | `entire hooks copilot-cli` subcommand |
|---|---|
| `SessionStart` | `session-start` |
| `UserPromptSubmitted` | `user-prompt-submitted` |
| `PreToolUse` | `pre-tool-use` |
| `PostToolUse` | `post-tool-use` |
| `SubagentStart` | `subagent-start` |
| `SubagentStop` | `subagent-stop` |
| `SessionEnd` | `session-end` |
| `AgentStop` | `agent-stop` |
| `ErrorOccurred` | `error-occurred` |

Each entry is:

```json
{
  "type": "command",
  "bash": "sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks copilot-cli session-start'",
  "comment": "Entire CLI"
}
```

The `command -v entire` guard means a missing CLI is a silent no-op, never a
broken agent. The extension must preserve that property.

`entire hooks` is documented as "internal and not for direct user use", but
it is the integration surface, and the payloads are JSON on stdin.

Observed input fields (JSON on stdin, all optional):

```json
{"session_id": "abc-123", "cwd": "/work/sandbox", "source": "vscode",
 "hook_event_name": "SessionStart", "model": "",
 "prompt": "add a test", "tool_name": "edit", "tool_input": {"file": "a.txt"}}
```

Output is empty; the hook is fire-and-forget and logs to `.entire/logs/`.

### The VS Code host

The CLI recognises two payload dialects and picks between them by sniffing
the raw JSON (`detectHookHost` in `cmd/entire/cli/agent/copilotcli/compat.go`):

| Signal | Host |
|---|---|
| `hookEventName` present as a string | `vscode` |
| `transcript_path` present as a string | `vscode` |
| `timestamp` present as a string | `vscode` |
| `transcriptPath` key present at all | `copilot-cli` |
| `timestamp` present as a number | `copilot-cli` |

This matters: the **VS Code dialect uses snake_case `transcript_path`** while
the Copilot CLI dialect uses camelCase `transcriptPath`. Sending the wrong
one is not an error — the payload is simply read as the other host and the
model never resolves.

Field names accepted on either dialect (`firstString` takes the first
present key):

| Field | Accepted as |
|---|---|
| session id | `sessionId`, `session_id` |
| transcript path | `transcriptPath`, `transcript_path` |
| prompt | `prompt` |
| working dir | `cwd` |
| hook event name | `hookEventName` |
| agent id | `agentId`, `agent_id` |
| agent type | `agentType`, `agent_type` |
| agent name | `agentName`, `agent_name` |
| agent description | `agentDescription`, `agent_description` |
| stop reason | `stopReason` |
| reason | `reason` |
| timestamp | `timestamp` |

### VS Code hook event names

On the VS Code dialect the CLI validates `hookEventName` against the
subcommand it was invoked with, and **skips the event silently** on a
mismatch. The allowed pairs:

| `hookEventName` | Allowed subcommand(s) |
|---|---|
| `SessionStart` | `session-start` |
| `UserPromptSubmit` | `user-prompt-submitted` |
| `Stop` | `agent-stop` **and** `session-end` |
| `PreToolUse` | `pre-tool-use` |
| `PostToolUse` | `post-tool-use` |
| `SubagentStart` | `subagent-start` |
| `SubagentStop` | `subagent-stop` |
| `PreCompact` | *(none — always skipped)* |

Note these are **not** the Copilot CLI names. The CLI uses
`UserPromptSubmitted`; VS Code uses `UserPromptSubmit`.

`Stop` is overloaded: VS Code emits one Stop event where the Copilot CLI
distinguishes end-of-turn from end-of-session. The CLI routes them by
`reason`/`stopReason` — a non-terminal Stop becomes `agent-stop`, a
terminal one becomes `session-end`. An extension that sends every Stop as
`agent-stop` will never close a session; one that sends every Stop as
`session-end` will close a session at the end of every turn.

### Where the model actually comes from

**The model is not read from the hook payload.** No field name in the
payload populates it — `model`, `modelName`, `modelId`, `modelID` and
`selectedModel` were each tested and all left `model` empty in the log.

The CLI reads it from the **transcript file** named by the payload's
transcript path, via `ExtractModelFromTranscript`:

1. Read and parse the transcript as JSONL.
2. Take the **last** `session.model_change` event, reading `data.newModel`.
3. If there is none, fall back to the **last** `tool.execution_complete`
   event, reading `data.model`.

Verified end to end against a real Copilot transcript:

```
$ entire hooks copilot-cli agent-stop  (transcript_path = a real events.jsonl)
  → "session_ref":"/…/session-state/rt-3/events.jsonl"
  → "model":"minimax/MiniMax-M3.1-Flash-Preview"
```

And verified model-agnostic across providers — the CLI stores whatever the
transcript says, with no allowlist and no normalisation:

| Transcript says | CLI records |
|---|---|
| `minimax/MiniMax-M3.1-Flash-Preview` | `minimax/MiniMax-M3.1-Flash-Preview` |
| `kimi-k2.7-code` | `kimi-k2.7-code` |
| `Qwen 3 Coder (Ollama)` | `Qwen 3 Coder (Ollama)` |

Only `agent-stop` populates the model. `session-start` records `"model":""`
even when the transcript path is supplied, because the model extraction
runs in `buildAgentStop` alone.

**Consequence for the extension:** to record the model, the extension must
send a `transcript_path` pointing at a readable Copilot transcript, and it
must send it on the `agent-stop` event. BYOK models work with no
extension-side special-casing — the extension must not filter, map or
validate the model string in any way.

## On-disk session data

```
.entire/logs/entire.log            JSONL
.entire/metadata/<session>/prompt.txt
.entire/tmp/pre-prompt-<session>.json
```

`.entire/tmp/pre-prompt-<session>.json`:

```json
{"session_id": "abc-123", "timestamp": "2026-10-26T23:34:50Z", "untracked_files": []}
```

`.entire/metadata/<session>/prompt.txt` holds the prompt, then a `---`
separator, then the prompt again (the pre/post form).

## The log is a structured event log

`entire.log` is JSONL. A real excerpt:

```json
{"time":"2026-10-26T23:34:45.636646304Z","level":"INFO","msg":"session-start","component":"lifecycle","agent":"copilot-cli","event":"SessionStart","session_id":"abc-123","session_ref":"","model":""}
{"time":"2026-10-26T23:34:45.778074012Z","level":"INFO","msg":"turn-start","component":"lifecycle","agent":"copilot-cli","event":"TurnStart","session_id":"abc-123","session_ref":"/home/x/.copilot/session-state/abc-123/events.jsonl","model":""}
{"time":"2026-10-26T23:34:45.837502387Z","level":"INFO","msg":"phase transition","component":"session","session_id":"abc-123","event":"TurnStart","from":"idle","to":"active"}
{"time":"2026-10-26T23:34:45.842550554Z","level":"INFO","msg":"initialized session","component":"hooks","agent":"copilot-cli","session_id":"abc-123"}
```

Fields: `time`, `level`, `msg`, `component` (`lifecycle`, `session`, `hooks`,
`redaction`), `agent`, `event`, `session_id`, `session_ref`, `model`, and
`from`/`to` for phase transitions.

## The agent home

`session_ref` points at the agent's own transcript store:
`~/.copilot/session-state/<session-id>/events.jsonl`. Entire reads it; it
never writes it. The session's `agent_home` is `~/.copilot`.


### `entire why`

```
entire why <file>[:line] [--line N] [--json]
```

Explains the commit, checkpoint, prompt and session behind a file or line.

Whole file (`entire why a.txt --json`):

```json
{
  "file": "a.txt",
  "lines": [
    {
      "line_number": 1,
      "status": "commit",
      "commit_sha": "9eefd35a64cc886dc3a94b9afcd9e55c9c21684e",
      "short_commit_sha": "9eefd35a",
      "author": "Tester",
      "author_time": "2026-10-26T23:33:53Z",
      "content": "hello"
    }
  ],
  "summary": {
    "total_lines": 1,
    "checkpoint_lines": 0,
    "commit_lines": 1,
    "uncommitted_lines": 0,
    "checkpoint_percentage": 0,
    "commit_percentage": 100
  }
}
```

Single line (`entire why a.txt:1 --json`) — note the key is `line`, singular,
not `lines`:

```json
{
  "file": "a.txt",
  "line": {
    "line_number": 1,
    "status": "commit",
    "commit_sha": "9eefd35a64cc886dc3a94b9afcd9e55c9c21684e",
    "short_commit_sha": "9eefd35a",
    "author": "Tester",
    "author_time": "2026-10-26T23:33:53Z",
    "content": "hello"
  }
}
```

`status` is one of `commit`, `checkpoint` or `uncommitted` — the three things
a line can be attributed to.

A **checkpoint**-attributed line carries three extra fields beyond the commit
ones:

```json
{
  "line_number": 2,
  "status": "checkpoint",
  "commit_sha": "e65ad184d0c3dae5c1410f5f5e285c2465eb70ed",
  "short_commit_sha": "e65ad184",
  "author": "Tester",
  "author_time": "2026-10-26T23:45:45Z",
  "checkpoint_id": "01M5X9P4P6Z0PZBJ7NYZ56CHZH",
  "metadata_missing": true,
  "metadata_missing_reason": "checkpoint metadata was not found locally (...). Run: git fetch origin refs/entire/checkpoints/ZH/01M5X9P4P6Z0PZBJ7NYZ56CHZH:refs/entire/checkpoints/ZH/01M5X9P4P6Z0PZBJ7NYZ56CHZH. Then re-run entire checkpoint explain 01M5X9P4P6Z0PZBJ7NYZ56CHZH.",
  "content": "second",
  "candidates": [
    {
      "checkpoint_id": "01M5X9P4P6Z0PZBJ7NYZ56CHZH",
      "metadata_missing": true,
      "metadata_missing_reason": "checkpoint metadata was not found locally (...)."
    }
  ]
}
```

The complete key inventory of the `why` response:

* Top level — `file`, `lines`, `summary`, `line` (single-line form only).
* A line entry — `line_number`, `status`, `commit_sha`, `short_commit_sha`,
  `author`, `author_time`, `content`, plus `checkpoint_id`,
  `metadata_missing`, `metadata_missing_reason` and `candidates` when the
  line is checkpoint-attributed.
* `summary` — `total_lines`, `checkpoint_lines`, `commit_lines`,
  `uncommitted_lines`, `checkpoint_percentage`, `commit_percentage`.

`metadata_missing` with a `metadata_missing_reason` is the normal shape when
a checkpoint's metadata is not available locally — the CLI has the commit
but not the checkpoint body. The extension must show that state, not treat
it as an error.

### `entire checkpoint explain`

```
entire checkpoint explain [<id-or-sha>] [--checkpoint <id>] [--commit <ref>] [--json]
```

Human-readable context about sessions, commits and checkpoints. Auto-detects
whether the positional argument is a checkpoint ID or a commit SHA.
Checkpoints in another repository can be explained with
`--repo gh/owner/name` or `--repo et/project/repo` — that is the drill-down
for a cross-repo `entire search` hit, and it reads from that repository's
Entire API without writing to this one. Checkpoint IDs are 12-char hex or
26-char ULID.

### `entire checkpoint list`

```
entire checkpoint list [--json] [--pending] [--outgoing]
```

* `--json` — machine-readable JSON instead of the human view.
* `--pending` — the *pending* dataset: turns recorded in session state but
  not yet checkpointed. Each preview shows the turns since the last
  checkpoint, the files touched, subagent task records, and the prompts since
  the last checkpoint. Agent turns live in session state, not in git, so
  pending work has no checkpoint ID until it is committed.
* `--outgoing` — what the next `git push` will send: the checkpoints queued
  for the checkpoint sync remote, read from local state with no network
  call. Needs the `git-refs` backend; on the legacy `branch` backend it
  reports an error.

## Configuration

Layered, most specific wins:

1. `.entire/settings.local.json`  (local, gitignored)
2. `.entire/settings.json`         (project, committed)
3. `~/.config/entire/settings.json` (global)
4. defaults

| Option | Values |
|---|---|
| `enabled` | `true`, `false` |
| `log_level` | `debug`, `info`, `warn`, `error` |
| `checkpoints.primary.type` | `git-refs` (default), `branch` (legacy) |
| `telemetry` | `true`, `false` |
| `absolute_git_hook_path` | `true`, `false` |
| `commit_linking` | `always`, `prompt` (default) |
| `sign_checkpoint_commits` | `true`, `false` (default on) |
| `strategy_options.push_sessions` | `true`, `false` (default on) |
| `strategy_options.checkpoint_remote` | `{"provider":"github","repo":"org/repo"}` |
| `strategy_options.checkpoint_push_remote` | remote name |

## Agent hook locations

| Agent | Hook file |
|---|---|
| Antigravity | `.agents/hooks.json` |
| Claude Code | `.claude/settings.json` |
| Codex | `.codex/hooks.json` |
| **Copilot CLI** | **`.github/hooks/entire.json`** |
| Cursor | `.cursor/hooks.json` |
| Factory AI Droid | `.factory/settings.json` |
| OpenCode | `.opencode/plugins/entire.ts` |
| Pi | `.pi/extensions/entire/index.ts` |

Multiple agents can be enabled at once; each is independent. Entire detects
which agents are active by looking for installed hook files, not by a
setting.

## Agent-aware guidance

`entire agent-help` prints usage aimed at a coding agent, and
`entire agent-help <command>` gives the exact flags of the installed
version. It states the CLI is the source of truth and that flags must not
be guessed — an extension should read `agent-help` rather than hardcode
flags, and should offer to run it.

## CLI internals (Go module paths, from the binary)

```
github.com/entireio/cli/cmd/entire/cli/agent/{antigravity,claudecode,codex,
    copilotcli,cursor,external,factoryaidroid,opencode,pi,skilldiscovery,types,vogon}
github.com/entireio/cli/cmd/entire/cli/{checkpoint,entiredir,gitdir,codesearch,
    dispatch,experimental,...}
github.com/entireio/auth-go/{deviceflow,refresh,tokens,tokenstore,...}
```

Built with Go 1.27.3. The `copilotcli` package is the direct precedent for
an editor-side integration.
