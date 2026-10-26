# T12 — Security and privacy review of the extension

> **Depends on**: T-hook-bridge, T-settings-and-config.

## Goal

Audit the extension for the ways it can leak data, run something it should not, or degrade a user's machine — and fix what the audit finds.


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

- The extension shells out to a CLI. Every argument must be passed as a separate argv element, never concatenated into a shell string — a filename with a space or a quote in it must not become shell syntax.
- The extension reads `.entire/settings.json` and other user files. Validate their shape before use; a malformed settings file must not crash the extension.
- Entire writes session data that includes agent transcripts and, potentially, source code. The extension must not copy that data anywhere outside the machine the CLI put it on.
- The extension must not add telemetry of its own, and must not read the Entire access token to do anything other than pass it to the CLI.
- The CLI's own redaction is best-effort, not a guarantee. The extension must not surface prompt or transcript content in a place a user did not ask for it — no status bar tooltip, no notification body.
- Respect the CLI's `telemetry` setting: if it is off, the extension must not attempt any network call of its own.
- The output channel is a local buffer, but it can be attached to a bug report. It must not contain secret material by default.


## Tests

- A test that a filename containing a space, a quote or a semicolon is passed through as a single argv element and never interpreted.
- A test that a malformed `.entire/settings.json` is ignored rather than thrown from.
- A test that the output channel does not contain prompt bodies or token material at the default log level.




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

- [ ] Every child_process invocation passes arguments as an argv array, never a shell string
- [ ] A path or filename containing shell metacharacters is handled safely
- [ ] The extension contains no network client and no access-token handling of its own
- [ ] A test proves prompt content never reaches the output channel at the default log level


## After Completion

Update PROGRESS.md row for T12 to `[x]`.
Commit: `feat(security-hardening): implement security and privacy review of the extension`
