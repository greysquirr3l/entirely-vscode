# Entirely

<img src="images/hero.png" alt="Entirely" width="128">

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
| **BYOK models** | Works with whatever model Copilot Chat is using — hosted, BYOK, or local — without the extension knowing the model exists |
| **Doctor** | A copyable diagnostic report: CLI version, repository state, effective settings, last error |

The extension never re-implements Entire. It discovers the installed CLI,
reads its JSON output, and shells out for anything mutating. If the CLI is
missing, the extension degrades quietly rather than failing obscurely.

**Model-agnostic by construction.** No model name, provider or context-window
size is hardcoded anywhere. The model is an opaque string, recorded exactly
as the Copilot transcript reports it — so a BYOK model from any provider and
a local Ollama model work the same as a hosted one, and a model the
extension has never seen is not a special case.

## Status

**Planned.** The implementation plan is `plan.toml`.

| Phase | Tasks | |
|---|---|---|
| Foundations | 2 | manifest and build, CLI process runner with discovery |
| Data Model | 1 | the CLI's JSON types and decoders |
| Editor Surface | 4 | status bar, session tree, checkpoint history, onboarding prompt |
| Agent Integration | 2 | Copilot CLI hook bridge, why-this-line |
| Polish and Release | 4 | settings, terminal PATH repair, diagnostics, packaging and CI |
| Hardening | 3 | security audit, wiring audit, scaffold cleanup |

The manifest, build pipeline and contributed surface are in place; the
extension compiles, lints and passes its extension-host tests. The plan
validates against `wiggum` at 9/10 with a valid DAG and 8 parallelisable
groups.

## Requirements

* The [Entire CLI](https://docs.entire.com/installation) — `entire version`
  must run. Without it the extension stays dormant.
* VS Code 1.140 or newer.

## Development

```sh
npm install
npm run compile     # type check, lint, bundle
npm test            # extension-host tests
npm run watch       # rebuild on change
```

### Tests

The extension-host tests live in `src/test/` and run inside a real VS Code
extension host. The runner is [`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli),
configured by `.vscode-test.mjs`:

```sh
npm run compile-tests   # compile the tests to out/
npm test                # run them in a headless extension host
```

Install the
[VS Code Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
to run the same suite from inside the editor. It reads the same
`.vscode-test.mjs`, discovers the compiled test files under `out/test/`, and
runs them in a debuggable Extension Development Host — so failures land in the
Testing view with source-mapped stack traces instead of in a terminal.

The runner executes the compiled JavaScript, not the TypeScript sources, so
compile the tests first — `npm run compile-tests`, or keep `npm run watch-tests`
running in the background.

No extra configuration is needed: `sourceMap` is on in `tsconfig.json` and
`.vscodeignore` excludes `**/*.map`, so stack traces point back at the
original TypeScript. On a remote without a display, set
`extension-test-runner.wrapper` to `xvfb-run`.

## Licence

MIT

## Issues

Found something broken, or want to see something built? The repository and
issue tracker live at
[greysquirr3l/entirely-vscode](https://github.com/greysquirr3l/entirely-vscode).
