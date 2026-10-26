# T01 — Extension manifest, build pipeline, and repository hygiene

> **Depends on**: None.

## Goal

Turn the generated scaffold into the manifest, build, lint and test setup the real extension will live in, with the contributed surface declared but not yet implemented.


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

- Set `engines.vscode` to the lowest version the implementation actually needs, and keep `@types/vscode` at or below it.
- Use auto-generated activation events (`contributes.commands` plus implied `onCommand` activation) rather than a hand-maintained `activationEvents` array.
- Declare the extension's contributed surface: a status bar item, a tree view container, a configuration section, and the command palette entries.
- Add `extensionKind` so the extension runs on the workspace side in Remote SSH, Containers and WSL.
- Set the repository, publisher, license, icon and categories fields - the marketplace listing is part of a top-tier extension.
- Add a `prepublishOnly` script and a `.vscodeignore` that keeps sources and tests out of the published package.
- Install dependencies and make sure `npm run compile`, `npm run lint` and `npm test` all work on a clean checkout.


## Tests

- A smoke test that activates the extension and asserts the contributed commands are registered.
- The packaged `.vsix` must contain `dist/extension.js` and must not contain `src/` or `out/`.




## Task kind: Infrastructure

This task creates or modifies CI/CD pipelines, deployment configs, container files, or build tooling.

Infrastructure rules:
- Config changes must be idempotent — safe to re-apply without side effects
- Lint workflow/config files (`actionlint`, `yamllint`, or equivalent) if tooling is available
- Verify the change in a branch or dry-run mode before finalising
- Document the deploy/run procedure in a README, RUNBOOK, or inline comment


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

- [ ] npm run compile produces dist/extension.js with no TypeScript errors
- [ ] npm run lint reports zero problems
- [ ] npm test passes in the extension host
- [ ] package.json contributes a status bar item, a tree view, and a configuration section


## After Completion

Update PROGRESS.md row for T01 to `[x]`.
Commit: `feat(project-scaffold): implement extension manifest, build pipeline, and repository hygiene`
