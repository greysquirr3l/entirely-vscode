# T08 — Why does this line exist

> **Depends on**: T-domain-types.

## Goal

Answer the question a reviewer actually asks - who changed this line, and why - without leaving the editor.


## Implements


### Capability: [why-this-line](../capabilities/why-this-line.md) — Why Does This Line Exist

- MUST use Entire's own `why` command to answer, so the answer matches the CLI and the web UI rather than re-deriving history locally.
- MUST present the answer with the originating session and checkpoint when the CLI supplies them.

**Scenarios this task must satisfy:**

- **explain-line** — WHEN `the user runs the why-this-line command with the cursor on a changed line` THEN `the originating agent, session and explanation are shown`
- **unexplained-line** — WHEN `Entire has no record of the line under the cursor` THEN `the extension says the line is not attributed to any recorded change`



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

- Use Entire's own `why` command so the answer is consistent with the CLI and the web UI; do not re-derive history from the Git log.
- The command is `entire why <file>[:line] [--line N] [--json]`. Pass the relative path and the line number; `--json` is what the extension should always use.
- The JSON has TWO shapes and the difference matters: a single line gives `{ file, line: {...} }` with `line` singular, while a whole file gives `{ file, lines: [...], summary: {...} }` with `lines` plural. Decode both.
- The whole-file form's `summary` block gives `total_lines`, `checkpoint_lines`, `commit_lines`, `uncommitted_lines`, `checkpoint_percentage` and `commit_percentage` - a distribution worth rendering as a small bar.
- Each line entry carries `line_number`, `status`, `commit_sha`, `short_commit_sha`, `author`, `author_time` and `content`.
- `status` is one of `commit`, `checkpoint` or `uncommitted` - the three things a line can be attributed to.
- A checkpoint-attributed line carries four more: `checkpoint_id`, `metadata_missing`, `metadata_missing_reason` and a `candidates` array. The candidate list is how the CLI expresses ambiguity - more than one checkpoint could own the line.
- `metadata_missing: true` with a `metadata_missing_reason` is the NORMAL state when the checkpoint body is not available locally: the CLI has the commit but not the checkpoint. Show that state; do not treat it as an error.
- `entire checkpoint explain <id-or-sha> --json` gives the full story for a checkpoint, including its session and prompt. Use it as the drill-down from a checkpoint-attributed line.
- Render the result in a side panel or a well-formed notification, showing the originating session, checkpoint and agent when the CLI returns them.
- When the line is unattributed, say so plainly - a confident wrong answer is worse than an honest none.
- Offer a command palette entry and an editor context-menu entry, both operating on the current selection or cursor line.
- For the whole-file form, the `summary` block gives `total_lines`, `checkpoint_lines`, `commit_lines`, `uncommitted_lines` and the two percentages - a useful thing to render as a small distribution bar.


## Tests

- A test that the why command invokes the CLI with the cursor line as the subject.
- A test that an unattributed line produces an explicit 'not attributed' message.
- A test that the command is available from both the palette and the context menu.





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

- [ ] The why command shells out to the CLI rather than reading Git history directly
- [ ] The result names the session, checkpoint and agent when the CLI supplies them
- [ ] An unattributed line yields an explicit statement, not a guess
- [ ] The command appears in both the palette and the editor context menu


## After Completion

Update PROGRESS.md row for T08 to `[x]`.
Commit: `feat(why-this-line): implement why does this line exist`
