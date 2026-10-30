---
title: Testing
description: How the test suite runs, the fake CLIs it uses, the coverage tests, and the CI checks.
sidebar:
  order: 2
---

## Running the suite

```sh
npm test
```

`npm test` runs `vscode-test`, which downloads a copy of VS Code, opens the `test-workspace` folder in an extension host, and runs the compiled tests in `out/test/**/*.test.js` with Mocha. The `pretest` step first compiles the tests (`tsc -p . --outDir out`), compiles the extension, and lints. The Mocha UI is `tdd` (`suite`, `test`), and the timeout is raised to 10 seconds because many tests start a fake CLI as a child process several times.

On a machine without a display, such as a CI runner or a remote host, run it under a virtual one: `xvfb-run --auto-servernum npm test`.

To run the same suite from inside the editor, install the VS Code Extension Test Runner. It reads `.vscode-test.mjs`. It runs the compiled JavaScript, so keep `npm run watch-tests` running or run `npm run compile-tests` first.

Run `npm test` before committing. Every new public function needs at least one test.

## Fake CLIs

The extension reads the real `entire` binary, but the tests must not depend on one or on an account. `src/test/support/` holds fake CLIs: small scripts written to a temporary directory that answer the commands a test needs, such as `activityCli.ts`, `controlPlaneCli.ts`, `pluginCli.ts` and `trailCli.ts`. A test points the runner at the fake and checks what the extension does with the answer.

Two kinds of test sit beside these:

- **Against a fake CLI.** The service runs and the fake answers `status`, `session list` and so on.
- **Against a stub runner.** The test records the arguments the code builds and asserts them. The CLI is not run. The coverage matrix flags which rows are tested this way, for example `why`, `blame`, `hooks` and `session resume`.

Behaviour that depends on a live Entire account is not covered by any test: control-plane mutations, dispatch, plugin install and the live MCP server are checked against fakes only.

## Temporary directories

Use `makeTempDir(prefix)` from `src/test/support/tempDir.ts` to make a temporary directory. It records the directory, and a root-level `suiteTeardown` removes everything after the whole run, so a directory is never deleted while a later test still uses it, and it is cleaned up even when a test fails. `removeTempDir(dir)` removes one sooner. Do not call `fs.mkdtempSync` directly.

## Coverage tests

`src/test/coverage.test.ts` checks `docs/coverage.md` against the code. It fails when a CLI call in `src/` has no row, when a row names a command no code builds, when the totals line is wrong, when a cited file or command id does not exist, and when an excluded row has no reason. See [CLI coverage](/entirely/reference/coverage/).

Other tests check the manifest itself. `manifest.test.ts` and `settings.test.ts` read `package.json`, so a command or setting that is declared but not wired fails the suite.

## CLI contract check

The extension's contract with the CLI is its flag names and JSON shape. CI has a separate job, "Check the Entire CLI contract", that installs the CLI at the version the extension expects (0.12.2) and runs `npm run check:cli` (`scripts/check-cli-contract.js`). The script asks `entire agent-help` for each command the extension invokes and checks that the flags it passes still exist. It needs no account and no network beyond the install. The shape of the JSON cannot be checked without a login, so the unit tests decode recorded payloads instead. When the CLI changes, bumping the pinned version is a deliberate change.

## Lint and static analysis

- `npm run lint` runs ESLint on `src`. The rules are `curly`, `eqeqeq`, `semi`, `no-throw-literal` and an import naming rule. TypeScript strict mode catches the rest.
- The `Build and test` job lints the GitHub workflows with `actionlint`.
- CodeQL runs on pull requests and on a weekly schedule. OpenSSF Scorecard runs weekly. Dependabot opens weekly update pull requests for npm and GitHub Actions.

## Package check

```sh
npx vsce package --no-git-tag-version --allow-missing-repository
npm run package:check
```

`package:check` (`scripts/check-package.js`) runs `vsce ls` and checks the file list the packager would produce. Sources, tests and other files that do not belong must not be in the VSIX. CI runs it on every pull request, and the release workflow runs it before publishing. See [Release](/entirely/contributing/release/).
