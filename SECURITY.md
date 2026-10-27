# Security Policy

## Reporting a vulnerability

If you find a vulnerability in Entirely, please report it privately rather
than opening a public issue.

Use GitHub's private reporting form for this repository:
**Security → Report a vulnerability** at
<https://github.com/greysquirr3l/entirely-vscode/security/advisories/new>

That opens a private advisory visible only to the maintainers, so a
vulnerability can be fixed before it is disclosed. Please do not open a
public issue, a pull request or a discussion for a vulnerability.

If private reporting is unavailable to you, email
<s0ma@protonmail.com> instead, and say in the subject that it is a
security report so the message is treated as one.

## What to include

A report is more useful with:

- the version of the extension you were using, and of VS Code
- the steps that reproduce the problem
- what you expected to happen, and what happened instead
- any proof-of-concept code or output

Please do not include anything that would harm someone else's machine
while reproducing the problem.

## Disclosure

We will acknowledge a report within three working days, and we will tell
you what we intend to do about it. We aim to have a fix released, or a
mitigation in place, within 30 days of the report. We may need longer
when a fix is involved in a dependency rather than in the extension, and
we will say so if that is the case.

We will credit you in the release notes, unless you would rather we did
not. We will keep the advisory private until a fix has shipped.

## What this policy covers

Entirely, the extension in this repository. It does not cover the Entire
CLI, which is a separate project — report a vulnerability in the CLI
through the same private advisory form, and we will pass it on.

The extension shells out to the CLI and reads its output. A vulnerability
in the CLI is therefore a vulnerability in the extension's use of it, and
is treated as one until the CLI is fixed.
