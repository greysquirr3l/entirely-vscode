---
title: Views
description: Every view the extension adds, with its default visibility, when-clause, welcome text and toolbar.
sidebar:
  order: 3
---

Entirely adds one view container to the Activity Bar and one view to the Explorer. The data comes from `contributes.viewsContainers`, `contributes.views`, `contributes.viewsWelcome` and `contributes.menus` in `package.json`.

## The container

| Property | Value |
| --- | --- |
| Id | `entirely` |
| Title | Entirely for Entire |
| Location | Activity Bar |
| Icon | `images/entirely-view.svg`, Entire's official symbol, unmodified. See [Status bar](/entirely/reference/status-bar/#the-entire-symbol). |

Four views are open by default and five start collapsed. A command that shows a collapsed view expands it, for example **Entirely: Open Activity**.

## Views in the container

| Order | Name | Id | Default | Toolbar commands | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Sessions | `entirely.sessions` | Open | Show Only This Workspace's Session / Show All Sessions | Every session Entire tracks for the repository, across worktrees. Row menu: transcript, resume, attach, adopt, stop. |
| 2 | Session | `entirely.sessionDetail` | Open | none | Detail for the session selected in Sessions. |
| 3 | Checkpoints | `entirely.checkpoints` | Open | Search Checkpoints, Clear Checkpoint Search | Checkpoint history. A file row opens the native diff editor. |
| 4 | Trails | `entirely.trails` | Open | none | Trails of the project the repository belongs to. **Has a badge.** |
| 5 | Activity | `entirely.activity` | Collapsed | Show Recent Commits or Sessions, Generate Dispatch, Refresh Activity | Recent sessions and commits across your repositories on Entire. |
| 6 | Search | `entirely.search` | Collapsed | Search Past Work and Code, Clear Search Results | Results of `entire search`. |
| 7 | Integrations | `entirely.integrations` | Collapsed | Refresh Integrations | Suggested plugins and the MCP server, per workspace folder. |
| 8 | Control Plane | `entirely.controlPlane` | Collapsed | Create Repository, Call the Entire API, Refresh Control Plane | Organisations, projects, repositories and clusters you can see, and who has access. |
| 9 | Account | `entirely.authentication` | Collapsed | Sign In to Entire / Sign Out of Entire | Who the CLI is signed in as. |

The toolbar commands marked with a pair swap on a context key: the sessions pair on `entirely.ownSessionOnly`, the Activity pair on `entirely.activityListing`, and sign in or out on `entirely.signedIn`. Clear Search Results shows while `entirely.searchActive` is set, and Clear Checkpoint Search while `entirely.checkpointFilterActive` is set. Command ids are listed on [Commands](/entirely/reference/commands/).

### The Explorer view

| Name | Id | When | Default |
| --- | --- | --- | --- |
| Entirely Sessions | `entirely.explorerSessions` | `config.entirely.showSessionsInExplorer` | Hidden until the setting is `true` |

It is the same sessions tree, placed below the source control views in the Explorer. Turn it on with `entirely.showSessionsInExplorer` (default `false`).

## Badge

Only the **Trails** view carries a badge. Its value is the number of changes that are not yet approved, with the tooltip "N not yet approved". It is cleared when the count is zero. The same reason text also appears as the view's message when the list is empty. See [Trails and review](/entirely/guides/trails-and-review/).

## Welcome content

Each view shows welcome text when it has nothing to list. Links are command links.

| View | When | Text and actions |
| --- | --- | --- |
| Sessions | always | "No sessions yet. Sessions are recorded automatically when an agent runs in a repository that Entire tracks." Action: Refresh. |
| Session | always | "Select a session to see its details." |
| Checkpoints | no checkpoint filter active | "No checkpoints yet. A checkpoint is recorded when agent work is committed, and appears here once it is." Action: Refresh. |
| Trails | always | "No trails to show. Trails are listed for the project this repository belongs to, once you are signed in to Entire." Action: Refresh. |
| Activity | always | "See recent sessions and commits across your repositories on Entire." Actions: Open Activity, Generate a Dispatch. |
| Search | no search active | "Search past agent work, commits and code." Action: Search. |
| Integrations | `entirely.integrationsState == no-cli` | "The Entire CLI is needed to see which integrations are available." Actions: Show How to Install (opens `docs.entire.com/installation`), Refresh. |
| Integrations | `entirely.integrationsState == no-folder` | "Open a folder to see which Entire integrations are available in it." |
| Account | always | "Not signed in." Action: Sign in to Entire. |
| Entirely Sessions (Explorer) | always | Same text as Sessions. |

The Control Plane view declares no welcome text.

## Related

- [Sessions and checkpoints](/entirely/guides/sessions-and-checkpoints/)
- [Search](/entirely/guides/search/)
- [Control plane](/entirely/guides/control-plane/)
- [Settings](/entirely/reference/settings/)
