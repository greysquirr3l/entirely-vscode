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

JSON:

```json
{"enabled": false, "agents": null, "active_sessions": null, "error": "not a git repository"}
```

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
