# T13 — End-to-end wiring audit

> **Depends on**: T-security-hardening, T-packaging-and-release.

## Goal

Prove that every command, provider, setting and disposable the manifest advertises is actually connected — and that the extension works as a whole, not just as parts.


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

- Enumerate every command in package.json and assert each one is registered at activation. An advertised command that does nothing is worse than an absent one.
- Assert every disposable is pushed onto context.subscriptions, and that deactivating the extension leaves no listener behind.
- Assert every setting the code reads is declared in package.json, and every setting declared is actually read.
- Assert the tree view provider, the status bar item and the output channel are all created and all disposed.
- Check that no module imports `vscode` from `src/lib/` — that layer must stay testable without an extension host.
- Look for the AI-generated tells: a `TODO`, a `throw new Error('not implemented')`, a function that returns a hardcoded value, a catch block that swallows an error silently.
- Run the extension in a real extension host against a real Git workspace with the CLI present, and confirm the status bar, the tree and a checkpoint diff all work.


## Tests

- A test that iterates package.json's contributed commands and asserts each is registered.
- A test that asserts every disposable lands in context.subscriptions.
- A test that scans src/lib/ for `vscode` imports.
- An extension-host test that opens a workspace, activates the extension, and asserts the tree has children.




## Task kind: Audit

This task performs a security, dependency, or quality audit and produces a **findings document**.

Audit rules:
- Run the audit tool(s) listed in the task goal
- Document every finding: severity, location, and recommended fix — do not silently suppress warnings
- For security audits: cross-reference findings against the OWASP Top 10 checklist
- Produce a findings document at a well-defined path before marking this task complete
- The deliverable is the findings document, not a code feature


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

- [ ] A test asserts every command in package.json is registered and every registered command exists in package.json
- [ ] A test asserts no disposable is leaked
- [ ] The extension-host test activates the extension in a real workspace and observes working UI
- [ ] A scan finds no TODO, no unimplemented branch and no silently swallowed error


## After Completion

Update PROGRESS.md row for T13 to `[x]`.
Commit: `feat(integration-wiring): implement end-to-end wiring audit`
