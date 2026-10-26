# Entirely

A Visual Studio Code extension for [Entire](https://entire.com) — the Git
forge built for agent-human collaboration.

Entire records what coding agents did as **sessions**, freezes them into
**checkpoints**, and publishes that history so a team can see what every
agent did and why. The CLI does the work. Entirely is the editor-side
surface for it.

```
Entirely (this extension)
   └── entire CLI  (the source of truth — never re-implemented here)
         └── git refs, session state, the Entire API
```

## What it will do

| Surface | What it shows |
|---|---|
| **Status bar** | Whether the workspace is tracked by Entire, and whether an agent session is live right now |
| **Entire view** | Every session Entire tracks for the repository — across all worktrees, not just the open folder |
| **Checkpoint history** | Recorded checkpoints, opening straight into the native diff editor |
| **Why this line** | Which agent edit introduced the line under the cursor, and why |
| **Hook bridge** | Reports the editor's own agent activity to Entire, so editor work lands in the same session history |
| **Doctor** | A copyable diagnostic report: CLI version, repository state, effective settings, last error |

The extension never re-implements Entire. It discovers the installed CLI,
reads its JSON output, and shells out for anything mutating. If the CLI is
missing, the extension degrades quietly rather than failing obscurely.

## Status

**Planned.** The implementation plan is `plan.toml`; the generated task
files are in `tasks/`.

| Phase | Tasks | |
|---|---|---|
| Foundations | 2 | manifest and build, CLI process runner with discovery |
| Data Model | 1 | the CLI's JSON types and decoders |
| Editor Surface | 3 | status bar, session tree, checkpoint history |
| Agent Integration | 2 | Copilot CLI hook bridge, why-this-line |
| Polish and Release | 3 | settings, diagnostics, packaging and CI |
| Hardening | 3 | security audit, wiring audit, scaffold cleanup |

The scaffold compiles, lints and passes its extension-host test. The plan
validates against `wiggum` at 9/10 with a valid DAG and 8 parallelisable
groups.

## Requirements

* The [Entire CLI](https://docs.entire.com/installation) — `entire version`
  must run. Without it the extension stays dormant.
* VS Code 1.96 or newer.

## Development

```sh
npm install
npm run compile     # type check, lint, bundle
npm test            # extension-host tests
npm run watch       # rebuild on change
```

### Working on the plan

```sh
wiggum validate plan.toml          # schema + lint
wiggum check plan.toml              # quality score
wiggum generate plan.toml           # regenerate tasks/ and prompts
```

Generated artifacts: `tasks/`, `capabilities/`, `AGENTS.md`,
`IMPLEMENTATION_PLAN.md`, `PROGRESS.md`, `features.json` and the prompts in
`.vscode/`. `plan.toml` is the source of truth — edit it and regenerate
rather than editing the generated files.

## Research

`research/CLI-SURFACE.md` documents the Entire CLI's integration surface, as
recovered by installing CLI v0.12.2 and exercising it against a real Git
repository. It is the factual basis for this plan: the command surface, the
exact JSON shapes, what `entire enable` installs, the Copilot CLI hook
protocol, the on-disk session data model, and the settings schema.

`research/install.sh` is the installer, kept for reference.

## Licence

MIT
