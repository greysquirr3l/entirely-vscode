# T10 — Output channel, diagnostics and the doctor command

> **Depends on**: T-cli-process, T-status-bar.

## Goal

Make the extension debuggable: one output channel for everything it does, and a doctor command that answers 'why is this not working?'.


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

- One output channel, named 'Entire', for CLI invocations, their exit codes, and the errors that were swallowed.
- Log the exact command line and the working directory for each CLI invocation - that is what a user needs to reproduce a problem.
- Do not log full checkpoint payloads or prompt bodies by default; log their size and a truncation instead, and provide an explicit command to dump the detail.
- A `doctor` command that reports: CLI path and version, whether the workspace is a repository, whether Entire is enabled, the effective settings, and the last CLI error.
- Doctor output should be copyable - a user will paste it into an issue.
- Respect a debug setting that raises the log level without needing a separate channel.


## Tests

- A test that each CLI invocation writes its command line and exit code to the channel.
- A test that the doctor command reports the CLI version and the workspace state.
- A test that prompt bodies are not written to the channel at the default log level.





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

- [ ] Every CLI invocation appears in the output channel with its command line and exit code
- [ ] The doctor command produces a complete, copyable diagnostic report
- [ ] No prompt body appears in the channel at the default log level
- [ ] The channel is disposed through context.subscriptions


## After Completion

Update PROGRESS.md row for T10 to `[x]`.
Commit: `feat(output-and-diagnostics): implement output channel, diagnostics and the doctor command`
