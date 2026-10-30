---
title: Release
description: Versioning, the tag-driven release workflow, branch protection, the Entire trail gate and the docs deploy.
sidebar:
  order: 4
---

## Versioning

Entirely is pre-1.0 and follows semantic versioning with that caveat: a minor version may carry changes that would be breaking after 1.0. The current version is 0.2.0. Only the latest release gets security fixes. See [Security](/entirely/contributing/security/).

The version lives in `package.json`. [CHANGELOG.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/CHANGELOG.md) follows Keep a Changelog, with an `Unreleased` section at the top and one section per version. Describe what changed for the user, and update the changelog in the same pull request as the change.

## Cutting a release

1. Set the new version in `package.json` and move the `Unreleased` notes under a dated version heading in the changelog.
2. Merge that pull request to `main`.
3. Push a tag named `v<version>`, for example `v0.2.0`.

The tag starts `.github/workflows/release.yml`. It can also be started by hand with `workflow_dispatch`, with an optional `version` and a `publish` switch that is off by default. A manual run with `publish` off is a dry run that builds and checks the package without publishing.

### What the workflow does

The workflow has four jobs.

1. **Build the package.** On Ubuntu with Node 24:
   - `npm ci`.
   - If a version was given by hand, writes it into the manifest with `npm version --no-git-tag-version`.
   - Reads the version from `package.json`.
   - For a tag run, compares the tag (without the `v`) to the manifest version and fails if they differ, so a mistyped tag cannot ship the wrong version.
   - Decides whether to publish: a tag always publishes, a manual run publishes only if asked.
   - Runs `npm run compile`, then the extension-host tests under `xvfb-run`.
   - Builds `entirely.vsix` with `vsce package`, runs `npm run package:check`, and uploads the VSIX as an artifact kept for 14 days.
2. **Publish to the Visual Studio Marketplace.** Runs only if publishing. Uses the `marketplace` environment and the `VSCE_PAT` secret, with `vsce publish --skip-duplicate`.
3. **Publish to Open VSX.** Same, with the `openvsx` environment and `OVSX_PAT`, using `ovsx publish --skip-duplicate`.
4. **Publish the release on GitHub.** Runs after both marketplaces accept the package. It attaches the VSIX and generates release notes. A tag on the repository therefore always means the extension is installable.

Actions are pinned to commit SHAs, and the top-level permissions are read-only. Only the final job gets `contents: write`. Tokens come from the environment and never appear on a command line.

## Branch protection

`main` is protected by a ruleset:

- Changes go through a pull request.
- One approval is required, and it must come after the last push.
- The **Build and test** check from `ci.yml` must pass. It compiles, lints the workflows, runs the tests, builds the package and checks its contents.
- When the pull request author and the commit author differ, the ruleset wants an approval from an account that is neither. A pull request author cannot approve their own pull request, so **open the pull request as the author of the commits**.

The CI workflow also has a separate job, "Check the Entire CLI contract". See [Testing](/entirely/contributing/testing/).

### The Entire trail gate

The repository also uses Entire on itself. A check reads the open Entire trail that tracks the pull request's head branch and counts approvals made on Entire.

- If an open trail tracks the head branch and has no approval the gate counts, the check reports `failure`, and GitHub blocks the merge.
- If no open trail tracks the head branch, which is the usual case, the check ends `neutral`. GitHub treats `neutral` as passing.

So expect a `neutral` result, and approve on Entire (for example with **Entirely: Approve a Change on a Trail**) when a trail does track the branch. The gate does not count an approval made by the trail's own author. The full account is in [docs/post-mortem-entire-gates.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/docs/post-mortem-entire-gates.md). See also [Trails and review](/entirely/guides/trails-and-review/).

## The documentation site

The site in `site/` is built with Astro and Starlight and served at <https://greysquirr3l.github.io/entirely/>. The `site.yml` workflow type-checks and builds it on every pull request and push to `main`. It has no path filter on the trigger, so it always reports a result and can be a required check. The filter is applied to the build steps.

Deployment is manual, from a clone of `greysquirr3l.github.io` placed next to the repository:

```sh
cd site
pnpm run deploy        # build, copy dist/ into entirely/, commit, push, poll the live URL
pnpm run deploy:dry    # the same, but stops before pushing
```

`scripts/deploy-docs.sh` reads its settings from the `deploy-docs` field of `site/package.json`: the pages repo path, the sub-directory (`entirely`), the live URL and the source repo. If the live URL returns "Site not found", Pages is enabled on the source repo and shadows the user page. Disable it with `gh api -X DELETE repos/greysquirr3l/entirely-vscode/pages`.
