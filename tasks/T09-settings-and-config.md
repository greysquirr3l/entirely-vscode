# T09 — Configuration surface and settings-driven behaviour

> **Depends on**: T-status-bar, T-session-tree.

## Goal

Expose the behaviour a user may reasonably want to change as VS Code settings, and make the extension read Entire's own layered configuration where it matters.


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

- Entire's settings are layered: `.entire/settings.local.json`, `.entire/settings.json`, `~/.config/entire/settings.json`, then defaults. The extension should surface the effective value of the settings it acts on.
- The settings the CLI understands include enabled, log_level, checkpoints.primary.type, telemetry, absolute_git_hook_path, commit_linking, sign_checkpoint_commits, and strategy_options.*.
- Give the extension its own settings for the things the CLI does not cover: the CLI path, the refresh interval, whether to show the session view in the explorer, and the log level for the extension's own output channel.
- A setting must be documented in package.json with a description and a sensible default - an undocumented setting is a hidden setting.
- Changing a setting must take effect without requiring a window reload.


## Tests

- A test that each setting is declared in package.json and registered with the configuration API.
- A test that changing the CLI path setting re-resolves the CLI.
- A test that the effective Entire setting is read from the layered locations in the documented precedence order.





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

- [ ] Each contributed configuration property has a description and a default value
- [ ] Changing the CLI path setting causes the extension to re-resolve the binary
- [ ] Effective settings are resolved in the order local, project, global, defaults
- [ ] No setting is read without being declared in package.json


## After Completion

Update PROGRESS.md row for T09 to `[x]`.
Commit: `feat(settings-and-config): implement configuration surface and settings-driven behaviour`
