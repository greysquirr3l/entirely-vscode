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
| 1 | Sessions | `entirely.sessions` | Open | Show Only This Workspace's Session / Show All Sessions | Every session Entire tracks for the repository, across worktrees. Row menu: transcript, resume, attach, adopt, stop, clean this session. |
| 2 | Session | `entirely.sessionDetail` | Open | none | Detail for the session selected in Sessions. |
| 3 | Checkpoints | `entirely.checkpoints` | Open | Search Checkpoints, Clear Checkpoint Search | Checkpoint history. A file row opens the native diff editor. |
| 4 | Trails | `entirely.trails` | Open | none | Trails of the project the repository belongs to; a trail's changes are read when it is expanded. **Has a badge.** |
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

## The detail panel

The detail of the row you last selected in Sessions (and its Explorer copy), Trails or Activity opens in one panel in the editor area, beside the code, not in a sidebar view. The sidebar lists stay the list. A click selects, and so do the arrow keys; Enter does the same as a click. A selection reads the item once, however it arrives.

| Selected | What the panel shows |
| --- | --- |
| A session, in any group | The session rows (the Session view shows the same rows). See [Sessions and checkpoints](/entirely/guides/sessions-and-checkpoints/#the-detail-panel). |
| A trail change | The change's fields and the gate, plus the parent trail from one `entire trail show`. See [Trails and review](/entirely/guides/trails-and-review/#the-detail-panel). |
| A project trail | Its fields and its changes. |
| An Activity commit, session line or repository | What the CLI printed, with no CLI read. See [Activity, dispatch and recap](/entirely/guides/activity-dispatch-recap/#selecting-a-row). |

There is one panel (view type `entirely.detail`). The first selection opens it beside the code without taking keyboard focus. Every later selection replaces its content and its tab title, which is the item's name, so tabs do not pile up. Closing it is fine: the next selection opens it again. If another tab hides it, it is shown again without taking focus when the item changes. "As of HH:MM:SS" appears when what you see came from the cache. A failed read is a message with a **Retry** link, never a popup.

The panel has **Refresh**, which skips the cache for the selected item only, and **Open as text**, which opens the same text as a read-only `entirely-generated` document. The editor title bar shows both while the panel is the active tab, and the palette offers them while the context key `entirely.detailShown` is set. `entirely.selectionCacheSeconds` (default `30`, `0` turns the cache off) sets how long a loaded detail is kept. Ended sessions and Activity rows are kept ten times as long.

An extension cannot clear the editor's own highlight on the last row chosen in a tree. Entirely marks the row the panel shows with a blue dot and label colour (a file decoration, so the row is not redrawn and the click's own command is not lost) and removes that mark in the other views, but the native highlight in those views stays.

The review actions on a change are links in the panel to the existing commands (Approve, Comment, Merge, Check out, Link branch, Unlink branch), with the item's row id as the argument; a commit has **Copy hash**. Each command checks that the id is the item the panel shows, and otherwise asks which change you mean. Approve asks "Approve *change* as *login*?" in a modal first, because nothing else confirms it there; the other actions keep their own confirmations. Clicking the row that is already shown brings a hidden panel back without reading again.

The panel is a web page without script. It has a strict Content-Security-Policy, escapes every word the CLI sent, and takes its colours from the theme, so light, dark and high-contrast themes work. Its links have visible text and a focus outline.

Where the panel needs a CLI call that was not seen against a live server (`trail show` for a change that was merged or deleted), the wording rests on the fake CLI the tests use. How the panel behaves in a live window (opening beside the code, reveal without focus, theming, keyboard use) is covered by tests against a stand-in for the editor's panel, not by a live window.

## Badge

Only the **Trails** view carries a badge. Its value is the number of changes that are not yet approved among the trails that have been read, and its tooltip says how many of the open trails that covers. The CLI's trail list carries no changes, so the count comes from `trail show` reads: up to `entirely.trailBadgeLimit` open trails (default 10) when you refresh the view or after an action, never on the background refresh, plus any trail you expand. It is cleared when the count is zero. The same reason text also appears as the view's message when the list is empty. See [Trails and review](/entirely/guides/trails-and-review/).

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
