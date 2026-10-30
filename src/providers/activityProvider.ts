import * as vscode from 'vscode';

import {
	countEntries,
	oneLine,
	selectionKey,
	type ActivityEntry,
	type ActivityListing,
	type ActivityOverview,
	type Selection,
} from '../lib/entire';
import type { ActivityOutcome, ActivitySource } from '../services/activity';
import { rowUri } from './selectedMark';

export type ActivityNode =
	| { readonly kind: 'scope'; readonly text: string; readonly summary: string }
	| { readonly kind: 'group'; readonly label: string; readonly icon: string; readonly items: readonly ActivityNode[] }
	| { readonly kind: 'line'; readonly label: string; readonly description?: string; readonly tooltip?: string; readonly icon: string; readonly selection?: Selection };

function entryNode(entry: ActivityEntry, listing: ActivityListing): ActivityNode {
	if (entry.id) {
		return {
			kind: 'line',
			label: entry.title && entry.title.length > 0 ? entry.title : entry.id,
			description: [entry.id, entry.repo, entry.detail].filter(Boolean).join(' · '),
			tooltip: entry.text,
			icon: 'git-commit',
			selection: { kind: 'commit', entry },
		};
	}
	return {
		kind: 'line',
		label: entry.text,
		tooltip: entry.text,
		icon: listing === 'commits' ? 'git-commit' : 'comment-discussion',
		selection: { kind: 'activity-session', entry },
	};
}

/** Lays an overview out as a scope line, the headline figures, the repositories and the recent list. */
export function buildActivityNodes(overview: ActivityOverview, login: string | undefined): ActivityNode[] {
	const nodes: ActivityNode[] = [];
	const what = overview.listing === 'commits' ? 'recent commits' : 'recent sessions';
	const scope = {
		kind: 'scope',
		text: login ? `Activity for ${login}` : 'Activity for the active Entire login',
		summary: `${what}${overview.contributions ? `, ${overview.contributions}` : ''}`,
	} as const;
	nodes.push(scope);

	if (overview.stats.length > 0) {
		nodes.push({
			kind: 'group',
			label: 'Overview',
			icon: 'graph',
			items: overview.stats.map(stat => ({
				kind: 'line',
				label: `${stat.label.charAt(0)}${stat.label.slice(1).toLowerCase()}`,
				description: stat.value,
				tooltip: stat.caption ? `${stat.value}: ${stat.caption}` : stat.value,
				icon: 'dash',
			})),
		});
	}

	if (overview.repositories.length > 0) {
		nodes.push({
			kind: 'group',
			label: `Repositories (${overview.repositories.length})`,
			icon: 'repo',
			items: overview.repositories.map(repository => ({
				kind: 'line',
				label: repository.name,
				description: repository.count === undefined ? undefined : String(repository.count),
				icon: 'repo',
				selection: {
					kind: 'repository',
					repository,
					scope: `${scope.text}: ${scope.summary}`,
					stats: overview.stats,
				},
			})),
		});
	}

	const total = countEntries(overview);
	if (total === 0) {
		nodes.push({ kind: 'scope', text: overview.listing === 'commits' ? 'No recent commits.' : 'No recent sessions.', summary: '' });
		return nodes;
	}
	for (const group of overview.groups) {
		if (group.entries.length === 0) {
			continue;
		}
		const items = group.entries.map(entry => entryNode(entry, overview.listing));
		if (group.heading) {
			nodes.push({ kind: 'group', label: group.heading, icon: 'calendar', items });
		} else {
			nodes.push({
				kind: 'group',
				label: `${overview.listing === 'commits' ? 'Commits' : 'Sessions'} (${group.entries.length})`,
				icon: 'history',
				items,
			});
		}
	}
	return nodes;
}

/**
 * The Activity view: what has been going on across the repositories the
 * acting login can see, read from `entire activity`.
 *
 * It reads when it is first opened and when asked, never on a timer,
 * because every read is a request to Entire's servers. The CLI's own
 * text is parsed; nothing is reconstructed from the local checkout.
 */
export class ActivityProvider implements vscode.TreeDataProvider<ActivityNode> {
	private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
	private outcome: ActivityOutcome | undefined;
	private loading = false;
	private started = false;
	private generation = 0;
	private current: ActivityListing = 'sessions';
	private built: { readonly outcome: ActivityOutcome; readonly nodes: ActivityNode[] } | undefined;

	readonly onDidChangeTreeData: vscode.Event<ActivityNode | undefined> = this.changed.event;

	constructor(
		private readonly source: ActivitySource,
		private readonly login: () => string | undefined,
	) {}

	get listing(): ActivityListing {
		return this.current;
	}

	/** Switches between recent sessions and recent commits, and reads again. */
	async show(listing: ActivityListing): Promise<void> {
		this.current = listing;
		await this.refresh();
	}

	/** Reads again. An answer to a read the user has since replaced is dropped. */
	async refresh(): Promise<void> {
		const generation = ++this.generation;
		this.started = true;
		this.loading = true;
		this.outcome = undefined;
		this.changed.fire(undefined);

		const outcome = await this.source.read(this.current);
		if (generation !== this.generation) {
			return;
		}
		this.loading = false;
		this.outcome = outcome;
		this.changed.fire(undefined);
	}

	/** Reads again only if the view has been read before, so a setting change does not wake a view nobody opened. */
	async reloadIfRead(): Promise<void> {
		if (this.started) {
			await this.refresh();
		}
	}

	/**
	 * Whether a row with this key is listed, or `undefined` while the list
	 * is being read, when no row can be said to be missing.
	 */
	contains(key: string): boolean | undefined {
		if (this.loading || this.outcome === undefined) {
			return undefined;
		}
		return this.findLine(key) !== undefined;
	}

	private findLine(key: string): ActivityNode | undefined {
		const search = (nodes: readonly ActivityNode[]): ActivityNode | undefined => {
			for (const node of nodes) {
				if (node.kind === 'line' && node.selection && selectionKey(node.selection) === key) {
					return node;
				}
				if (node.kind === 'group') {
					const found = search(node.items);
					if (found) {
						return found;
					}
				}
			}
			return undefined;
		};
		return search(this.nodesNow());
	}

	/** The nodes for the current outcome, built once so the tree can refresh one of them. */
	private nodesNow(): ActivityNode[] {
		const outcome = this.outcome;
		if (outcome?.kind !== 'found') {
			return [];
		}
		if (this.built?.outcome !== outcome) {
			this.built = { outcome, nodes: buildActivityNodes(outcome.overview, this.login()) };
		}
		return this.built.nodes;
	}

	/** The line shown in place of a list when there is none. */
	get viewMessage(): string | undefined {
		if (this.loading) {
			return 'Reading your activity…';
		}
		switch (this.outcome?.kind) {
			case 'failed':
				return `Activity could not be read: ${oneLine(this.outcome.detail)}`;
			case 'unreadable':
				return `The Entire CLI printed activity in a layout this extension does not recognise${this.outcome.detail ? ` (it began "${oneLine(this.outcome.detail)}")` : ''}. Update the extension or the CLI.`;
			case 'empty':
				return 'The Entire CLI printed no activity. Work appears here once it has been published to Entire.';
			default:
				return undefined;
		}
	}

	getTreeItem(node: ActivityNode): vscode.TreeItem {
		switch (node.kind) {
			case 'scope': {
				const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
				item.description = node.summary;
				item.iconPath = new vscode.ThemeIcon('info');
				return item;
			}
			case 'group': {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
				item.iconPath = new vscode.ThemeIcon(node.icon);
				return item;
			}
			case 'line': {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
				item.description = node.description;
				item.tooltip = node.tooltip;
				item.iconPath = new vscode.ThemeIcon(node.icon);
				if (node.selection) {
					item.resourceUri = rowUri(selectionKey(node.selection));
					item.command = {
						command: 'entirely.selectItem',
						title: 'Show Details',
						arguments: [node.selection, 'activity'],
					};
				}
				return item;
			}
		}
	}

	getChildren(node?: ActivityNode): ActivityNode[] {
		if (node) {
			return node.kind === 'group' ? [...node.items] : [];
		}
		if (!this.started) {
			void this.refresh();
			return [];
		}
		return this.nodesNow();
	}

	dispose(): void {
		this.generation += 1;
		this.changed.dispose();
	}
}
