# T07 — Copilot CLI hook bridge

> **Depends on**: T-domain-types.

## Goal

Report the extension's own agent activity to Entire using the same hook protocol the CLI installs for Copilot CLI, so editor work lands in the same session history.


## Implements


### Capability: [agent-hooks](../capabilities/agent-hooks.md) — Agent Hook Bridge

- MUST speak the Copilot CLI hook protocol by invoking `entire hooks copilot-cli <event>` with the event payload as JSON on stdin.
- MUST map editor events onto the nine Copilot CLI hook events: SessionStart, UserPromptSubmitted, PreToolUse, PostToolUse, SubagentStart, SubagentStop, SessionEnd, AgentStop and ErrorOccurred.
- MUST preserve the CLI's own convention that a missing `entire` binary is a silent no-op, and MUST NOT surface hook failures as user-visible errors.
- MUST NOT block the editor on hook delivery; a hook that has not completed MUST never delay a user action.

**Scenarios this task must satisfy:**

- **session-start** — WHEN `the extension activates in a tracked workspace` THEN `a SessionStart hook is delivered carrying the session identifier and workspace path`
- **tool-use** — WHEN `the user invokes a file-editing tool through the extension` THEN `a PreToolUse and a matching PostToolUse hook are delivered for that invocation`
- **cli-absent** — WHEN `the `entire` binary cannot be found` THEN `hook delivery is a silent no-op and the editor behaves exactly as if the bridge were not present`


### Capability: [byok-model-support](../capabilities/byok-model-support.md) — Bring Your Own Key Model Support

- MUST treat the model as an opaque string end to end. It MUST NOT be filtered against an allowlist, mapped, normalised, or validated against a known set of models.
- MUST support every model the Copilot Chat picker can offer: the hosted Anthropic and OpenAI models, BYOK models registered through the Copilot Chat model picker, and local models served by Ollama, LM Studio or llama.cpp.
- MUST NOT hardcode a model name, a model id, a provider name or a context-window size anywhere in the extension.
- MUST record the model exactly as the Copilot transcript reports it, so the session view shows the same string the user's picker shows.
- MUST tolerate a model the extension has never seen: an unknown provider, a renamed model, or a local model whose name the extension has no knowledge of.
- MUST NOT gate any feature on the model. A session recorded with an unrecognised model MUST appear in the session tree, the checkpoint history and the why-this-line answer exactly like any other.
- MUST NOT infer anything about a model from its name - not its vendor, not its capabilities, not its cost.

**Scenarios this task must satisfy:**

- **byok-model-recorded** — WHEN `the user runs a BYOK model such as minimax/MiniMax-M3.1-Flash-Preview through Copilot Chat` THEN `the recorded session shows that model string verbatim, and the extension applies no special handling`
- **local-model-recorded** — WHEN `the user runs a local model served by Ollama or LM Studio` THEN `the session is recorded and displayed with no error and no warning about an unrecognised model`
- **unknown-model** — WHEN `a model appears that the extension has never been built against` THEN `the extension behaves identically to any other model, with no allowlist rejection and no degraded feature`
- **model-unavailable** — WHEN `the transcript does not report a model, because the session has not yet produced one` THEN `the session is still recorded, with the model simply absent, and no error is surfaced`



## Project Context

- Project: `entirely` — Entirely is a Visual Studio Code extension for Entire, a Git forge built for
agent-human collaboration.

Entire's CLI records each coding-agent session, freezes it into a checkpoint,
and publishes the history so a team can see what every agent did and why. The
CLI is a terminal tool; everything it exposes is invisible from the editor.
Entirely surfaces it: a status bar that always knows whether the current
workspace is tracking, a tree of live sessions, checkpoint history that opens
straight into the diff, the ability to start a tracked agent turn from the
editor, and an inline blame-style "why does this line exist" query.

The extension never re-implements Entire. It discovers the installed CLI,
reads its JSON output, and shells out for anything mutating. If the CLI is
missing, the extension degrades to a clear, actionable message rather than
failing obscurely.

- Language: typescript
- Architecture: layered

### Architecture: Layered

- **Presentation**: API handlers / CLI / UI
- **Application**: Use cases, orchestration, DTOs
- **Domain**: Entities, value objects, business rules
- **Infrastructure**: Database, external services, config
- Each layer depends only on the layer below it


## Implementation

- The protocol is `entire hooks copilot-cli <event>` with the event payload as JSON on stdin; the CLI writes the result, not the caller.
- CRITICAL: the extension must use the VS Code dialect, not the Copilot CLI dialect. The CLI sniffs the raw JSON to pick a host: a string `hookEventName`, a string `transcript_path`, or a string `timestamp` means VS Code; a `transcriptPath` KEY or a numeric `timestamp` means Copilot CLI.
- So the VS Code dialect uses snake_case `transcript_path`, while the Copilot CLI dialect uses camelCase `transcriptPath`. Sending the wrong one is not an error - the payload is read as the other host and the model never resolves.
- Accepted field names: `sessionId` or `session_id`; `transcriptPath` or `transcript_path`; `prompt`; `cwd`; `hookEventName`; `agentId`/`agent_id`; `agentType`/`agent_type`; `agentName`/`agent_name`; `agentDescription`/`agent_description`; `stopReason`; `reason`; `timestamp`.
- The VS Code hook event names are NOT the Copilot CLI ones. The CLI uses `UserPromptSubmitted`; VS Code uses `UserPromptSubmit`. The full allowed set: SessionStart, UserPromptSubmit, Stop, PreToolUse, PostToolUse, SubagentStart, SubagentStop, PreCompact.
- The CLI validates `hookEventName` against the subcommand it was invoked with and SKIPS the event silently on a mismatch. A mismatched name loses the event with no error anywhere.
- `Stop` is overloaded: VS Code emits one Stop where the CLI distinguishes end-of-turn from end-of-session. The CLI routes by `reason`/`stopReason` - a non-terminal Stop becomes `agent-stop`, a terminal one becomes `session-end`. Send every Stop as `agent-stop` and no session ever closes; send every Stop as `session-end` and every turn closes the session.
- `PreCompact` maps to no subcommand at all and is always skipped. Do not send it.
- The MODEL IS NOT READ FROM THE PAYLOAD. No field name populates it - `model`, `modelName`, `modelId`, `modelID` and `selectedModel` were each tested and all left the model empty.
- The CLI reads the model from the TRANSCRIPT FILE named by the payload's transcript path: the last `session.model_change` event's `data.newModel`, falling back to the last `tool.execution_complete` event's `data.model`.
- Only `agent-stop` populates the model. `session-start` records an empty model even when a transcript path is supplied, because the extraction runs in the agent-stop path alone.
- So the extension must send a `transcript_path` pointing at a readable Copilot transcript, and it must send it on the `agent-stop` event, or the model is never recorded.
- BYOK needs NO extension-side special-casing. The CLI stores whatever the transcript says, with no allowlist and no normalisation - verified with `minimax/MiniMax-M3.1-Flash-Preview`, `kimi-k2.7-code` and a local `Qwen 3 Coder (Ollama)`. The extension must NOT filter, map, normalise or validate the model string.
- The transcript is the Copilot agent's own JSONL at `<copilot-home>/session-state/<session-id>/events.jsonl`, where copilot-home is `$COPILOT_HOME` or `~/.copilot`. The extension should resolve the path from the session id rather than hardcoding a home directory, and must tolerate the file not existing yet.
- The CLI's own installed hooks guard on `command -v entire` and exit 0 when it is missing. The extension must behave the same way: never surface a hook failure to the user.
- Delivery must not block the editor. Fire and forget, and never await a hook before completing the user action that triggered it.
- The extension's session id must be stable for the lifetime of a workspace session so that a turn's Pre and Post events pair up.
- If the user has the CLI's own Copilot CLI hooks installed, the extension must not double-report: detect the installed hook file and stand down.


## Tests

- A test that each editor event maps to the correct hook subcommand and payload.
- A test that the payload uses the VS Code dialect - snake_case `transcript_path` and a string `hookEventName` - and never camelCase `transcriptPath`, which would be read as the Copilot CLI host.
- A test that a mismatched `hookEventName` and subcommand pair is caught before dispatch, because the CLI skips such an event silently and the loss is invisible.
- A test that a terminal Stop is sent as `session-end` and a non-terminal Stop as `agent-stop`.
- A test that the `agent-stop` payload carries a `transcript_path`, and that no other event tries to carry the model.
- A test that a transcript containing `tool.execution_complete` with an arbitrary model string is passed through untouched - no allowlist, no normalisation.
- A test that a missing CLI results in a silent no-op and no error surfaced.
- A test that the bridge stands down when `.github/hooks/entire.json` is present.
- A test that hook delivery does not delay the triggering action.





## File Structure (Anti-Godfile)

- Keep each changed file focused on one primary responsibility.
- If this task introduces a new concern, create a focused module/file instead of extending an unrelated catch-all file.
- Do not expand `utils`, `helpers`, or `common` into multi-purpose dumping grounds.
- If a file is already overloaded, extract cohesive pieces before adding new behavior.




## Housekeeping: TODO / FIXME Sweep

Before running preflight, scan all files you created or modified in this task for
`TODO`, `FIXME`, `HACK`, `XXX`, and similar markers.

- **Resolve** any that fall within the scope of this task's goal.
- **Leave in place** any that reference work belonging to a later task or phase — but ensure they include a task reference (e.g. `// TODO(T07): wire up auth adapter`).
- **Remove** any placeholder markers that are no longer relevant after your implementation.

If none are found, move on.

## Preflight

```bash
npm run compile && npm test && npm run lint && npm audit --audit-level=high
```

## Exit Criteria

- [ ] Type-checking passes without errors
- [ ] All tests pass
- [ ] Linter passes with no warnings
- [ ] `npm audit --audit-level=high` reports no vulnerabilities
- [ ] Implementation matches the goal described above
- [ ] No unresolved TODO/FIXME/HACK markers that belong to this task's scope

- [ ] Each editor event invokes the matching `entire hooks copilot-cli` subcommand with JSON on stdin
- [ ] Every payload is in the VS Code dialect and uses the VS Code event names
- [ ] The agent-stop payload carries a transcript_path, and an end-to-end test against a real transcript shows the model recorded
- [ ] A test proves an arbitrary BYOK model string reaches the CLI unmodified
- [ ] No hook failure is surfaced as a user-visible error
- [ ] Hook delivery does not block the triggering editor action
- [ ] The bridge is inert when `.github/hooks/entire.json` already exists


## After Completion

Update PROGRESS.md row for T07 to `[x]`.
Commit: `feat(hook-bridge): implement copilot cli hook bridge`
