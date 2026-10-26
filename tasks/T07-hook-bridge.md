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
- The nine events are SessionStart, UserPromptSubmitted, PreToolUse, PostToolUse, SubagentStart, SubagentStop, SessionEnd, AgentStop and ErrorOccurred.
- The payload carries at least `session_id`, `cwd`, `source` and `hook_event_name`; prompts and tool inputs are optional.
- The CLI's own installed hooks guard on `command -v entire` and exit 0 when it is missing. The extension must behave the same way: never surface a hook failure to the user.
- Delivery must not block the editor. Fire and forget, and never await a hook before completing the user action that triggered it.
- The extension's session id must be stable for the lifetime of a workspace session so that a turn's Pre and Post events pair up.
- If the user has the CLI's own Copilot CLI hooks installed, the extension must not double-report: detect the installed hook file and stand down.


## Tests

- A test that each editor event maps to the correct hook subcommand and payload.
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

- [ ] Each of the nine events invokes the matching `entire hooks copilot-cli` subcommand with JSON on stdin
- [ ] No hook failure is surfaced as a user-visible error
- [ ] Hook delivery does not block the triggering editor action
- [ ] The bridge is inert when `.github/hooks/entire.json` already exists


## After Completion

Update PROGRESS.md row for T07 to `[x]`.
Commit: `feat(hook-bridge): implement copilot cli hook bridge`
