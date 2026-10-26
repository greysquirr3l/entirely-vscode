# T05 — Tree view of tracked sessions

> **Depends on**: T-domain-types.

## Goal

Show every session Entire tracks for the repository - across all worktrees, not just the open folder - and let the user inspect one.


## Implements


### Capability: [session-tree](../capabilities/session-tree.md) — Session Explorer

- MUST source sessions from `entire session list --json`, which returns worktree paths across the whole repository rather than only the open folder.
- MUST show, per session, the agent, its status, the branch, the turn and checkpoint counts, and the last prompt.
- MUST refresh the tree when a session's status changes, and MUST NOT poll more often than the refresh interval allows.

**Scenarios this task must satisfy:**

- **list-sessions** — WHEN `the user opens the Entire view in a tracked repository` THEN `the tree lists each tracked session with its agent, status, branch and counts`
- **session-detail** — WHEN `the user selects a session` THEN `the session's details are shown, including its last prompt and its checkpoint count`
- **empty-repository** — WHEN `the repository has no tracked sessions` THEN `the tree shows an empty-state message that explains how sessions get recorded`



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

- Source from `entire session list --json`, which spans all worktrees of the repository; the tree should not imply the sessions are in the current folder.
- Group the tree usefully: by status (active, finished) is more useful than a flat list, and an active session deserves to be at the top.
- Show the agent, status, branch, turn count, checkpoint count and last prompt on each session item.
- Truncate the last prompt to one line - it is a prompt, not a document.
- Provide a refresh command and an empty state that explains how sessions are recorded.
- Implement `getParent` so a grouped tree reports the right parent for each element.


## Tests

- A test that the tree renders one group per status with the right session counts.
- A test that the empty state message is shown for a repository with no sessions.
- A test that the last prompt is truncated to a single line.





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

- [ ] The tree shows a group per status with the correct number of children
- [ ] getParent returns the correct group for each session element
- [ ] A repository with no sessions shows an explanatory empty state
- [ ] The refresh command re-queries the CLI and updates the tree


## After Completion

Update PROGRESS.md row for T05 to `[x]`.
Commit: `feat(session-tree): implement tree view of tracked sessions`
