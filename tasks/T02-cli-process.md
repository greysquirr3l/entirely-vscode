# T02 — Entire CLI process runner with discovery

> **Depends on**: T-project-scaffold.

## Goal

Implement the one place that knows how to find, run and parse the Entire CLI, so that nothing else in the extension touches the process boundary. It owns every failure path: a missing binary, a broken binary, a timeout and a malformed response are all typed outcomes, never thrown errors.


## Implements


### Capability: [cli-discovery](../capabilities/cli-discovery.md) — Entire CLI Discovery

- MUST locate the `entire` binary by checking PATH first, then the documented install locations, and MUST record which one was used.
- MUST distinguish 'not installed' from 'installed but broken' and MUST surface the distinction in the UI.
- MUST never throw out of discovery; a missing CLI is an expected state, not an error.

**Scenarios this task must satisfy:**

- **cli-on-path** — WHEN `the `entire` binary is on PATH and `entire version` exits zero` THEN `discovery reports the CLI as available with its version string`
- **cli-absent** — WHEN `no `entire` binary is found on PATH or in any known install location` THEN `discovery reports the CLI as absent and the extension shows an actionable install prompt instead of failing`
- **cli-present-but-broken** — WHEN `an `entire` binary is found but `entire version` exits non-zero or prints unparseable output` THEN `discovery reports the CLI as present but unusable, and the error detail is available for diagnosis`


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

- Discovery order: `entire` on PATH, then the documented install locations (`~/.local/bin`, `/usr/local/bin`, the XDG data dir, and the Windows equivalents).
- Cache the resolved path, but re-verify it cheaply so a CLI installed after activation is picked up.
- Run every invocation with a timeout and treat a timeout as 'the CLI is not usable', never as a hang.
- Capture stdout and stderr separately, and never merge them - the CLI's JSON goes to stdout and its diagnostics to stderr.
- Parse JSON from stdout with a strict schema; a CLI that emits a warning before its JSON must not break parsing.
- Expose the CLI's own `agent-help` output as structured usage, so callers never hardcode a flag list.
- Keep every filesystem and process concern in this module; the rest of the extension must not import `child_process`.


## Tests

- Unit tests against a fake CLI script that emits the real `status --json` and `session list --json` shapes.
- A test that the runner reports 'absent' when no binary exists, and 'broken' when one exists but exits non-zero.
- A test that a timeout is reported as a failure rather than hanging the suite.
- A test that a CLI printing a warning line before its JSON still parses.





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

- [ ] No module outside src/services/cli imports child_process or fs for CLI access
- [ ] The runner never throws for a missing CLI; it returns a typed result
- [ ] Unit tests cover absent, broken, timing-out and warning-prefixed CLI cases
- [ ] The resolved CLI path is discoverable by other modules without re-running discovery


## After Completion

Update PROGRESS.md row for T02 to `[x]`.
Commit: `feat(cli-process): implement entire cli process runner with discovery`
