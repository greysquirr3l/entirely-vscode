# Post-mortem: the Entire Gates saga

**When:** 28 October 2026, while merging
`fix(cli): ignore relative PATH entries when looking for the CLI` into
`main`.

**Outcome:** PR #18 merged. The change was good; the *process* took most of
the day.

**Why this is written down:** everything below is Entire-side and
maintainer-side, so none of it is in the extension's code. But every one of
it is a way for a pull request to sit open with a red check that nobody can
explain, and the next person to open a pull request here will meet the same
thing.

---

## The two rules that would have saved the afternoon

1. **Open the pull request as the author of the commits.** The `main`
   ruleset has `require_extra_approval_for_unattributed_changes: true`.
   When the pull request's author is not the commit author, GitHub wants an
   approval from an account that is *neither* — and the pull request's
   author is never allowed to approve their own pull request. With two
   accounts, that is a deadlock. The only shape that merges is: **pull
   request author = commit author, reviewed by the other account.**

2. **Expect the Entire gate to end `neutral`, not `success`.** The gate
   reports `failure` when it finds an open trail tracking the head branch
   and the trail has no approval it counts. It reports `neutral` when no
   open trail tracks the head branch. GitHub's merge button treats
   `failure` as blocking and `neutral` as passing. So a pull request whose
   trail is not linked to the head — which is the normal state, because
   nobody links it by hand — merges once the ruleset's approval
   requirement is met.

## The timeline

| Time (UTC) | Event |
|---|---|
| 17:00 | PR #11 opened. Gate: `neutral` — "no open trail tracks its head branch" |
| 17:04 | Trail 26 approved through the CLI. The gate later flipped to `pass` |
| 17:07 | GitHub review added. Gate passed, but GitHub still said `REVIEW_REQUIRED` |
| 17:12 | Trail 27 and change 4 created automatically for the next pull request |
| 17:36 | PR #12 opened on a re-authored branch. Gate: "unassessed" |
| 17:40 | PR #14. Trail 28 and change 5 created **by hand** with `entire trail create` |
| 17:40 → 18:59 | Five approvals, four pull requests (#12–#18), three force-pushes, two empty commits, two branch renames |
| 19:07 | The trail approved in the web UI as `sosh-ncampbell`, and merged |

## The root causes

**1. The ruleset plus two accounts is a deadlock.** See rule 1 above. This
was the single largest cost: PRs #11 through #16 were all opened with the
pull request author and the commit author as different accounts.

**2. The gate does not count an approval by the trail's author.** Change 7
had an approval by `greysquirr3l` bound to the exact head commit, made
*before* the gate run started, and the run still reported
`0 of 1 required approvals`. Five approvals across four trails and three
pull requests were all counted as zero. The message does not say that
self-approval does not count, which is why it took so long to find.

**3. A GitHub review does not satisfy the gate.** A pull request review
from `sosh-ncampbell` on PR #19 left the gate saying "No reviewers have
approved this trail", even after a new run was forced. Only an approval on
the *trail*, recorded by Entire, counts. The gate's approval requirement
and the `main` ruleset's review requirement are two separate things, and
both have to be satisfied.

**4. The gate snapshots approvals when a run begins.** A run takes about
four and a half minutes. Approving while a run is in flight cannot work:
the approval has to be made, and then a *new* run has to be forced. Editing
the pull request body is enough to force one; a push does it too.

**5. `failure` blocks the merge and `neutral` does not.** See rule 2
above. PR #13 merged with a `neutral` gate.

**6. A GitHub-mirrored Entire project is a projection of GitHub.** Access is
managed at the source, so `entire project grant` on one is refused:

> project access on a GitHub-mirrored project is a read-only projection of
> GitHub; grants are managed by the source

The second account could not resolve the project at all — `entire project
list` did not show it even though `entire repo mirror list` showed the
repository. Those two commands disagree, and the second one is not evidence
that the project is reachable.

**7. The CLI's identity is independent of `gh auth switch`.** Switching
`gh` to `sosh-ncampbell` changed nothing: `entire auth status` still
reported `github:greysquirr3l`. A second identity needs
`entire login --device`, completed in a browser that is signed in to the
other GitHub account.

## The procedure that works

1. Open the pull request **as the author of the commits**, and have the
   other account review it on GitHub. That satisfies the `main` ruleset.
2. On the trail's page in the web UI, signed in as the **other** account,
   press **Approve**. The CLI cannot do this: the other account cannot
   resolve a GitHub-mirrored project (see root cause 6), so the approval
   has to be made in the browser.
3. Force a new gate run — editing the pull request body is the cheapest
   way — and wait for it to finish.

PR #19 was merged with exactly this procedure, and the gate went from
"No reviewers have approved this trail" to "1 approval(s) recorded" with
nothing else changed.

## A red herring, recorded so nobody follows it again

The hand-made changes (`entire trail create`, `entire trail link`) carry a
`branch` and the App's changes carried an empty one, which looked like the
difference between a change that counts and one that does not. It is not.
The branch is cleared *when the change merges*, so every change that
looked different was already merged. The branch field is a consequence, not
a cause.

## What we did about it in the extension

The plugin reads Entire's state through the CLI, and the CLI reports that
state in words. The rule the extension now follows is that **a fact it does
not have is never rendered as a fact it has**:

- `CheckpointDestination` has an explicit `unknown` state, with the reason
  it is unknown. It used to be reported as `local-only`, which made the
  doctor say "Destination: this machine only" — a claim the extension had no
  basis for — about a CLI that had simply said nothing.
- The doctor report names the CLI version, the version the extension reads
  payloads from, and says so when the CLI is older than that.
- A payload the extension cannot read is reported with the CLI's version
  rather than degraded into silence.
- The status bar warns, rather than staying calm, when the checkpoints are
  not going somewhere Entire can read them from. A dashboard that will stay
  empty is the failure this whole feature exists to prevent, and it must be
  visible without running a command.

See `entirely.minimumCliVersion` for the version the extension reads
payloads from.