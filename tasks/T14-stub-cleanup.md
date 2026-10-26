# T14 — Remove scaffold leftovers and placeholder code

> **Depends on**: T-integration-wiring.

## Goal

Delete everything the generator left behind — the hello-world command, the sample test, the template description — so nothing in the published extension is scaffolding.


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

- The generator leaves a `greysquirr3l.entirely.helloWorld` command and a `src/test/extension.test.ts` that only asserts the hello world. Both must go, and the manifest must not reference them.
- The generator's README is a quickstart template. Replace it with a real README that leads with what the extension does.
- The generator's CHANGELOG is a one-line placeholder. Replace it with a real Keep a Changelog entry for 0.1.0.
- Remove `vsc-extension-quickstart.md` from the published package.
- Search the whole source tree for `TODO`, `FIXME`, `XXX`, `placeholder`, `stub` and `not implemented` and resolve every hit — either by implementing it or by deleting it.
- Check the icon and gallery assets: a missing or placeholder icon makes the marketplace listing look unfinished.


## Tests

- A test that asserts the hello-world command is absent from the manifest and unregistered.
- A test that scans the source tree for placeholder markers and fails if any are found.
- A test that asserts the packaged .vsix contains no quickstart file.




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

- [ ] package.json contains no hello-world command and the extension registers no such command
- [ ] A source scan finds no TODO, FIXME or placeholder marker
- [ ] The packaged .vsix contains no generator template files
- [ ] The README and CHANGELOG describe the actual extension


## After Completion

Update PROGRESS.md row for T14 to `[x]`.
Commit: `feat(stub-cleanup): implement remove scaffold leftovers and placeholder code`
