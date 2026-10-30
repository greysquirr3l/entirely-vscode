---
title: CLI coverage
description: Which parts of the Entire CLI the extension covers, what it leaves out on purpose, and the gaps.
sidebar:
  order: 6
---

The extension keeps a written audit of the Entire CLI against what the editor does with it: [docs/coverage.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/docs/coverage.md). This page summarises it. The file has the full 133-row matrix with the evidence for each row.

The audit was derived against Entire CLI 0.12.2 on 2026-10-30. Its sources are Entire's own LLM documentation (`llms.txt` and `llms-full.txt`) and the command list from the installed CLI. It adds the commands the CLI hides or ships as plugins: `why`, `blame`, `import`, `review`, `tokens`, `experts`, `runner`, `mcp`, `completion`, `graph`, `investigate` and `brain`.

## Totals

| Mark | Rows | Meaning |
| --- | --- | --- |
| Supported | 74 | The extension calls it, you can reach it from the editor, and a test in the repository covers it. |
| Excluded | 7 | A decision: the extension deliberately does not do it. |
| Gap | 52 | Not done, and no decision to leave it out. |
| **Total** | **133** | |

Some "supported" rows are covered in part. The matrix says so in each row: some tests run the call against a fake CLI, and some only check the arguments built for it. `why`, `blame`, `hooks`, `session resume` and `checkpoint explain` are tested with a stub runner that records arguments. The CLI itself is not run in those tests. For `enable`, the argument building is tested, and the hook bridge end to end uses a stub.

## Excluded on purpose

| Command | Reason |
| --- | --- |
| `entire auth switch` | It changes the CLI's active login for every tool on the machine. The extension pins a login for itself with `entirely.cliContext` and never changes the global one. |
| `entire auth token` | It prints a bearer credential. The extension never shows, logs or stores a token. |
| `entire trail resume` | `entire session resume` already covers the editor use case, through **Resume Session** in an editor terminal. |
| `entire labs` | It only lists experimental commands. Each has its own row. |
| `entire help` | The command tree is read through `agent-help`, which always matches the installed CLI. |
| `entire completion` | Shell completion belongs to the terminal and the user's shell setup. |
| `entire global-flags` | A documentation page for the flags themselves. `--context` has its own row. |

## Gaps

None of these is excluded. Each is something the CLI can do and the editor does not.

1. **Setup and teardown.** `disable`, `configure`, `clean`, `runner setup`. Nothing in the editor stops capture or edits repository settings.
2. **Diagnostics beyond the report.** `doctor bundle`, `logs`, `trace`, `migrate-checkpoints`.
3. **Review and expertise.** `review`, `experts`.
4. **Token analysis across history.** `tokens`, `tokens profile`.
5. **Checkpoint deletion.** `checkpoint delete`. It is destructive and would need the same confirmation care as the control-plane deletes.
6. **Control plane breadth.** Create and read for organisations and projects, organisation invitations, and repository `clone`, `mirror add`, `detach`, `remove`, `resync`, `protection`, `remote add` and `visibility get`.
7. **Plugin management.** `plugin browse`, `doctor`, `index update`, `info`, `remove`, `search`, `upgrade`. Only `list` and `install` are wired.
8. **Trail depth.** `trail create`, `update`, `watch`, and the comment and finding commands that edit, reply, resolve or dismiss.

A gap is a finding, not a failure. Closing one means a command in `package.json`, a service, a test, and a move of the row from Gap to Supported.

## How the matrix is enforced

`src/test/coverage.test.ts` reads the file and fails when:

- a CLI call in `src/` names a known command and section 1 has no row for it;
- a section 1 row names a command that no caller builds;
- the totals line disagrees with the table;
- a supported row cites a source file or command id that does not exist;
- an excluded row has no reason;
- a supported row's cited test never mentions the command's words;
- the installed CLI is present and `entire help -t` lists a command the matrix lacks. This check skips where `entire` is not installed.

The citation check proves a test names the command. It does not prove the test runs the call against a real CLI, which is why the Notes column says where a test covers only part. After each Entire release, the maintainers pull `llms.txt` again, diff the CLI reference against the matrix, and update the version and date.

See also [CLI commands used](/entirely/reference/cli-commands-used/) and [Testing](/entirely/contributing/testing/).
