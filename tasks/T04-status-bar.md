# T04 — Status bar item showing tracking state

> **Depends on**: T-domain-types.

## Goal

Give the user an always-visible, always-accurate answer to 'is this workspace tracked by Entire, and is an agent running right now?'.


## Implements


### Capability: [workspace-tracking-status](../capabilities/workspace-tracking-status.md) — Workspace Tracking Status

- MUST read tracking state from `entire status --json` and MUST parse it defensively, because the JSON carries nullable fields when the workspace is not a repository.
- MUST surface tracking state in the status bar with a distinct visual treatment for tracked, untracked, and error states.
- MUST refresh when the user switches workspaces, when the Git HEAD changes, and when an agent hook fires.

**Scenarios this task must satisfy:**

- **tracked-workspace** — WHEN `the workspace is a Git repository with Entire enabled` THEN `the status bar shows the tracked state together with the active session when one exists`
- **untracked-workspace** — WHEN `the workspace is a Git repository but Entire is not enabled for it` THEN `the status bar offers an enable action rather than showing an error`
- **not-a-repository** — WHEN `the workspace is not a Git repository` THEN `the status bar shows an inert state and no enable action is offered`



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

- Render distinct treatments for tracked, untracked, tracked-but-no-session, and error states - they must be distinguishable at a glance without hovering.
- Make the item a command: clicking it opens the Entire view, or offers to enable Entire when the workspace is untracked.
- Do not offer an enable action when the workspace is not a Git repository; the CLI cannot track it there.
- Refresh on workspace folder change, on Git HEAD change, and on a manual refresh command.
- When the CLI is absent, the status bar item should stay hidden rather than show a permanent error - the extension should be invisible in a workspace that does not use Entire.
- Expose the item's priority so it sits next to other SCM entries rather than at the far right.


## Tests

- A test that the status bar text reflects each of the four states.
- A test that the item is hidden when the CLI is absent.
- A test that the command registered for the item routes to enable when untracked and to the view otherwise.





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

- [ ] Each state produces a distinguishable status bar rendering
- [ ] The status bar item is not rendered when the CLI is unavailable
- [ ] Clicking the item performs the correct action for the current state
- [ ] The status bar is disposed through context.subscriptions


## After Completion

Update PROGRESS.md row for T04 to `[x]`.
Commit: `feat(status-bar): implement status bar item showing tracking state`
