# T03 — Entire data types and the JSON decode layer

> **Depends on**: T-cli-process.

## Goal

Model the Entire CLI's JSON output as precise TypeScript types, with decoding that tolerates the nulls and shape variations the CLI actually emits.


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

- `status --json` has TWO different shapes and the difference is the crux of this task.
- Untracked: `{ enabled: false, agents: null, active_sessions: null, error: "not a git repository" }`.
- Tracked: `{ enabled: true, agents: ["Copilot CLI"], active_sessions: [{ agent, session_id, worktree_path, branch, status }], agent_help: "entire agent-help" }`.
- `agents` and `active_sessions` are ARRAYS when tracked and NULL when not. `error` appears only when untracked; `agent_help` only when tracked. A decoder must handle both, and must treat a non-null `error` as a state rather than a failure.
- `session list --json` returns an array of sessions with `session_id`, `agent`, `status`, `branch`, `worktree_path`, `started_at`, `last_active`, `turns`, `pending_turns`, `checkpoints` and `last_prompt`.
- `session current --json` adds a `resolution` field and may be absent when there is no current session.
- The model, wherever it appears, is an OPAQUE STRING. Type it as `string`, never as a union of known models and never as a branded type. There is no `Model` type that enumerates providers - that is the whole point of BYOK support.
- The model may be absent entirely (a session that has not yet produced one) and may be any string at all: a hosted model, a BYOK model, a local model, or something the extension has never seen.
- Decode into domain types, never into raw `any`. Use a discriminated result type so 'the CLI said no' and 'the CLI failed' stay distinguishable.
- Timestamps arrive as RFC 3339 strings with nanosecond precision; parse them to `Date` and keep the raw string for display.
- `branch` may be absent for a session that is not on a branch yet.
- Write the decoders as pure functions in `src/lib/` so they are testable without a process or an extension host.


## Tests

- Table-driven tests: one fixture per real CLI response shape, captured from the actual CLI.
- A test that the untracked `status --json` decodes to a distinct 'not a repository' state rather than a failure.
- A test that the tracked `status --json` decodes `agents` and `active_sessions` as populated arrays, not as the null shape.
- A test that a session missing `branch` and `last_prompt` still decodes.
- A test that an arbitrary model string - a BYOK id, a local model name with spaces, an empty string - decodes to a plain string with no validation error.
- A test that the decoded model type accepts any string, proving there is no closed union of models.





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

- [ ] No `any` appears in the decode layer
- [ ] Decoders are pure functions with no I/O
- [ ] Tests cover every captured CLI response shape including the null-heavy status response
- [ ] A missing optional field never throws


## After Completion

Update PROGRESS.md row for T03 to `[x]`.
Commit: `feat(domain-types): implement entire data types and the json decode layer`
