# T06 — Checkpoint list and diff viewer

> **Depends on**: T-domain-types.

## Goal

Make recorded checkpoints browsable from the editor and openable in the native diff editor.


## Implements


### Capability: [checkpoint-history](../capabilities/checkpoint-history.md) — Checkpoint History

- MUST source checkpoints from `entire checkpoint list --json`.
- MUST open a checkpoint's diff using the native VS Code diff editor rather than a custom view.
- MUST tolerate a checkpoint whose diff is unavailable, showing an explanation instead of an error toast.

**Scenarios this task must satisfy:**

- **list-checkpoints** — WHEN `the user opens the checkpoint list in a tracked repository` THEN `each recorded checkpoint is listed with its message, author and time`
- **open-checkpoint** — WHEN `the user selects a checkpoint` THEN `the checkpoint's changes open in the diff editor`
- **checkpoint-without-diff** — WHEN `a checkpoint has no retrievable diff` THEN `the extension explains that the diff is unavailable and does not open an empty diff`



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

- Source from `entire checkpoint list --json`; the list is scoped to the current branch.
- The CLI also offers `entire checkpoint list --pending --json`, which returns work that is recorded in session state but not yet checkpointed - a preview per session showing the turns since the last checkpoint, the files touched, subagent task records and the prompts since the last checkpoint.
- Pending work is worth surfacing separately: it is the agent's in-flight work that has no checkpoint ID yet, and it is exactly what a user wants to see while an agent is still running.
- The CLI also offers `entire checkpoint list --outgoing`, which reports what the next `git push` will send, read from local state with no network call. It requires the `git-refs` backend and errors on the legacy `branch` backend.
- Opening a checkpoint should use `vscode.diff` with a title that identifies the checkpoint, so the user can step through diffs with the usual navigation.
- A checkpoint with no available diff must be explained, not shown as an empty diff.
- Keep the checkpoint list as a tree-view section rather than a separate panel, so the Entire view is a single place.
- Include the checkpoint message, author and timestamp in the item label and tooltip.


## Tests

- A test that a checkpoint selection opens a diff via vscode.diff.
- A test that a checkpoint with no diff shows an explanatory message and opens nothing.
- A test that the list renders message, author and time.





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

- [ ] Selecting a checkpoint calls vscode.diff with both sides and a descriptive title
- [ ] A missing diff produces a user-facing explanation and no diff editor
- [ ] The checkpoint list reflects the CLI's output without manual reformatting


## After Completion

Update PROGRESS.md row for T06 to `[x]`.
Commit: `feat(checkpoint-history): implement checkpoint list and diff viewer`
