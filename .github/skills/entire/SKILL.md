---
name: entire
description: 'Use when: working in a repository that Entire tracks and the answer may already be in its history — why a line exists, what a previous agent did, what a checkpoint changed, whether the task at hand was done before. Also use when asked what Entire recorded, what an earlier session did, or to search past work and code.'
---

# Entire: the history this repository already has

Entire records what coding agents did, freezes each piece of work into a checkpoint, and
publishes it. In a repository it tracks, the record of earlier work is already here. Read it
before you write, and before you repeat something.

## Start with the map

```
entire agent-help
```

That prints the commands that bear on the work, marks the ones that only read, and separates
out the ones that belong to the person. It is the CLI describing itself, so it is true of the
version installed here rather than of this file.

Read a command's own flags from the CLI, never from memory and never from this file:

```
entire agent-help <command>
```

## Read before you write

| Question | Command |
|---|---|
| Why is this line like this? | `entire why <file>:<line>` |
| Has this been done before? | `entire search "<your own words>"` |
| What did that checkpoint change? | `entire checkpoint explain <id>` |
| What did that session do? | `entire session info` |
| What is recorded on this branch? | `entire checkpoint list` |

`entire search` matches semantically and by keyword over checkpoints, commits and sessions.
`entire why` gives the commit, the checkpoint, the prompt and the session behind a line, which
is usually enough to settle a question about code you did not write.

Give every command `--json` when you intend to read the answer. For a search,
`entire search "<query>" --compact` returns a trimmed shape meant for an agent: the id, the type,
the branch, the author, the date, the files touched, a score and a snippet. Fetch the full
detail of one hit with `entire checkpoint explain <id>`.

## The editor already reported your work

When the editor has the compatible agent integration installed, the editor reports your
activity to Entire itself. Do not run `entire hooks` by hand: it would report the same events
twice.

## What is yours, and what is the person's

Everything in this skill only reads. The commands that change something — the ones under
`org`, `repo`, `project`, `plugin`, `clean`, `disable`, `enable`, `login` — belong to the
person. Suggest them, in plain words, and let them run them.

Nothing else is needed to record your work. A checkpoint is written for the commit that
carries it, so there is nothing to save and nothing to submit.
