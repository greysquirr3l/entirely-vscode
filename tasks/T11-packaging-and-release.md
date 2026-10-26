# T11 — Marketplace packaging, CI and release workflow

> **Depends on**: T-settings-and-config, T-output-and-diagnostics.

## Goal

Make the extension installable, publishable and continuously verified - the difference between a project and a top-tier extension.


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

- A GitHub Actions workflow that builds, lints, type-checks and tests the extension on every push, and packages a .vsix on release.
- The package script must run the type check and the linter before bundling - a published extension that does not compile is worse than no release.
- Use a secret-backed publish step with `vsce publish` for the marketplace, and publish to Open VSX as well so the extension is installable outside the Microsoft marketplace.
- Include a CHANGELOG with Keep a Changelog structure and a README that leads with what the extension does, not with how to build it.
- Include screenshots or a short GIF in the marketplace listing, and set the correct categories, keywords and support links.
- Add a LICENSE file and the `repository`, `bugs` and `homepage` fields.
- Version the extension with SemVer and keep the changelog in step with the releases.


## Tests

- CI must pass on a clean checkout: type check, lint, unit tests and the extension-host smoke test.
- The packaging job must produce a .vsix that installs into a clean VS Code instance.
- The published package must contain no source maps of test files, no tests, and no development dependencies.




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

- [ ] CI runs the type check, the linter and the test suite and all three pass
- [ ] The release job publishes a .vsix to both marketplaces
- [ ] The published .vsix contains no test files and no development dependencies
- [ ] The README's first screen explains what the extension does for a user


## After Completion

Update PROGRESS.md row for T11 to `[x]`.
Commit: `feat(packaging-and-release): implement marketplace packaging, ci and release workflow`
