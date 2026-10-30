import * as vscode from 'vscode';

import {
	describeEmptyOutcome,
	isSameRepository,
	scopeLine,
	summariseReport,
	type FileHit,
	type WorkHit,
	type WorkHitKind,
	type WorkSearchOutcome,
	type WorkSearchReport,
} from '../lib/entire';
import type { WorkSearchSource } from '../services/workSearch';

/** What a click on a result opens. */
export type SearchTarget =
	| { readonly kind: 'hit'; readonly hit: WorkHit; readonly local: boolean }
	| { readonly kind: 'file'; readonly file: FileHit; readonly local: boolean };

export type SearchNode =
	| { readonly kind: 'scope'; readonly text: string; readonly summary: string }
	| { readonly kind: 'group'; readonly label: string; readonly items: readonly SearchNode[] }
	| { readonly kind: 'result'; readonly target: SearchTarget };

const GROUPS: readonly { readonly kind: WorkHitKind; readonly label: string }[] = [
	{ kind: 'session', label: 'Sessions' },
	{ kind: 'commit', label: 'Commits' },
	{ kind: 'checkpoint', label: 'Checkpoints' },
	{ kind: 'other', label: 'Other results' },
];

/** Lays a report out as the scope line followed by one group per kind of result. */
export function buildSearchNodes(report: WorkSearchReport): SearchNode[] {
	const nodes: SearchNode[] = [
		{ kind: 'scope', text: scopeLine(report.scope), summary: summariseReport(report) },
	];
	for (const note of report.notes) {
		nodes.push({ kind: 'scope', text: note, summary: '' });
	}
	const current = report.scope.repo;

	for (const group of GROUPS) {
		const items = report.hits
			.filter(hit => hit.kind === group.kind)
			.map(
				(hit): SearchNode => ({
					kind: 'result',
					target: { kind: 'hit', hit, local: report.scope.reach === 'current' || isSameRepository(hit.repo, current) },
				}),
			);
		if (items.length > 0) {
			nodes.push({ kind: 'group', label: `${group.label} (${items.length})`, items });
		}
	}

	if (report.files.length > 0) {
		const items = report.files.map(
			(file): SearchNode => ({
				kind: 'result',
				target: { kind: 'file', file, local: report.scope.reach === 'current' || isSameRepository(file.repo, current) },
			}),
		);
		nodes.push({ kind: 'group', label: `Files (${items.length})`, items });
	}
	return nodes;
}

const KIND_ICONS: Record<WorkHitKind, string> = {
	session: 'comment-discussion',
	commit: 'git-commit',
	checkpoint: 'history',
	other: 'search',
};

/**
 * The Search view: a query goes in, and the sessions, commits,
 * checkpoints and files the CLI matched come out under a line that says
 * where the search looked.
 */
export class SearchProvider implements vscode.TreeDataProvider<SearchNode> {
	private readonly changed = new vscode.EventEmitter<SearchNode | undefined>();
	private outcome: WorkSearchOutcome | undefined;
	private running: string | undefined;
	private generation = 0;

	readonly onDidChangeTreeData: vscode.Event<SearchNode | undefined> = this.changed.event;
	/** The last query, so the box can be filled in again. */
	lastQuery: string | undefined;

	constructor(private readonly source: WorkSearchSource) {}

	/** Runs a search. An answer to a search the user has since replaced is dropped. */
	async run(query: string): Promise<WorkSearchOutcome | undefined> {
		const generation = ++this.generation;
		this.lastQuery = query;
		this.running = query;
		this.outcome = undefined;
		this.changed.fire(undefined);

		const outcome = await this.source.search(query);
		if (generation !== this.generation) {
			return undefined;
		}
		this.running = undefined;
		this.outcome = outcome;
		this.changed.fire(undefined);
		return outcome;
	}

	/** Empties the view. */
	clear(): void {
		this.generation += 1;
		this.running = undefined;
		this.outcome = undefined;
		this.lastQuery = undefined;
		this.changed.fire(undefined);
	}

	get isIdle(): boolean {
		return this.outcome === undefined && this.running === undefined;
	}

	/** The line shown in place of a list when there is nothing to list. */
	get viewMessage(): string | undefined {
		if (this.running !== undefined) {
			return `Searching for "${this.running}"...`;
		}
		return this.outcome ? describeEmptyOutcome(this.outcome) : undefined;
	}

	getTreeItem(node: SearchNode): vscode.TreeItem {
		switch (node.kind) {
			case 'scope': {
				const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
				item.description = node.summary;
				item.iconPath = new vscode.ThemeIcon('info');
				item.contextValue = 'entirely.searchScope';
				return item;
			}
			case 'group':
				return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			case 'result':
				return resultItem(node.target);
		}
	}

	getChildren(node?: SearchNode): SearchNode[] {
		if (node) {
			return node.kind === 'group' ? [...node.items] : [];
		}
		if (this.outcome?.kind !== 'results') {
			return [];
		}
		return buildSearchNodes(this.outcome.report);
	}

	dispose(): void {
		this.changed.dispose();
	}
}

function resultItem(target: SearchTarget): vscode.TreeItem {
	if (target.kind === 'file') {
		const { file } = target;
		const item = new vscode.TreeItem(
			file.line !== undefined ? `${file.path}:${file.line}` : file.path,
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = file.text?.trim();
		item.tooltip = target.local ? file.path : `${file.path} in ${file.repo ?? 'another repository'}`;
		item.iconPath = new vscode.ThemeIcon('file');
		item.command = { command: 'entirely.openSearchResult', title: 'Open Search Result', arguments: [target] };
		return item;
	}

	const { hit } = target;
	const item = new vscode.TreeItem(hit.title ?? hit.id, vscode.TreeItemCollapsibleState.None);
	const where = target.local ? undefined : hit.repo;
	item.description = [hit.kind === 'other' ? hit.typeName : hit.id.slice(0, 7), hit.author, where]
		.filter((part): part is string => part !== undefined && part.length > 0)
		.join(' · ');
	item.tooltip = `${hit.typeName}${hit.repo ? ` in ${hit.repo}` : ''}${hit.branch ? ` on ${hit.branch}` : ''}`;
	item.iconPath = new vscode.ThemeIcon(KIND_ICONS[hit.kind]);
	item.command = { command: 'entirely.openSearchResult', title: 'Open Search Result', arguments: [target] };
	return item;
}
