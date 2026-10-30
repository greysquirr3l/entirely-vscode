# Security Policy

## Supported versions

Entirely is pre-1.0. Only the latest release gets security fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a vulnerability

Please report a vulnerability privately. Don't open a public issue, pull
request or discussion for it.

GitHub's private vulnerability reporting is not enabled on this repository
yet, so the Security tab has no report form. Until it is, email
<s0ma@protonmail.com> and put "Entirely security report" in the subject.

If you can't email, open a public issue that says only that you have a
security report and how to reach you. Leave out the details.

A report helps most with:

- the extension version and the VS Code version
- the steps to reproduce
- what you expected, and what happened
- any proof-of-concept code or output

Please don't include anything that could harm someone else's machine.

## What to expect

We aim to acknowledge a report within three working days and to ship a fix
or a mitigation within 30 days. A fix that depends on a dependency can take
longer, and we'll say so. We credit reporters in the release notes unless
you'd rather we didn't, and keep the details private until a fix has shipped.

## Scope

In scope: the Entirely extension in this repository.

Out of scope: the Entire CLI and the Entire forge. Report those to Entire,
under the policy at <https://github.com/entireio/cli/blob/HEAD/SECURITY.md>.
If you aren't sure where a problem lives, report it here and we'll route it.

## What the extension does to protect you

- It stores no secrets. Tokens stay in the Entire CLI's own credential store,
  and the extension never reads that store.
- Anything that changes Entire or your repository asks first, and says what
  it will touch.
- Transcripts, prompt bodies, checkpoint payloads and search queries are kept
  out of the output channel. Sensitive operands are redacted from logged
  command lines.
- It writes MCP configuration only inside the workspace, only after you
  agree, and never puts a credential or a path to your CLI in it.
- It opens only Entire addresses in your browser.
- `entirely.cliPath` and `entirely.cliContext` can only be set in user
  settings, so a workspace can't point the extension at a different binary
  or login.
