import * as vscode from 'vscode';

import {
	describeViewerNote,
	isCommitHash,
	isSelection,
	isSelectionSource,
	renderDetailDocument,
	selectionKey,
	type Selection,
	type SelectionSource,
} from '../lib/entire';
import type { DetailPanel } from '../providers/detailPanel';
import type { SessionDetailProvider } from '../providers/sessionDetailProvider';
import type { SelectedRows } from '../providers/selectedMark';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { ActivityProvider } from '../providers/activityProvider';
import type { SessionsProvider, SessionNode } from '../providers/sessionsProvider';
import { selectionOfSession } from '../providers/sessionsProvider';
import type { TrailsNode, TrailsProvider } from '../providers/trailsProvider';
import { selectionOfTrailsNode } from '../providers/trailsProvider';
import type { SelectionService } from '../services/selection';
import type { ActivityNode } from '../providers/activityProvider';

/** The part of a tree view the wiring listens to. */
export type SelectableView<T> = Pick<vscode.TreeView<T>, 'onDidChangeSelection'>;

/** What the viewer's commands need. They are registered before any view exists, so a row can never be clicked before they are there. */
export type SelectionCommandDependencies = Pick<SelectionWiring, 'selection' | 'documents' | 'show' | 'inform'> & {
	/** Puts text on the clipboard. Defaults to the editor's. */
	readonly copy?: (text: string) => Thenable<void>;
	/** The detail panel, so a click can bring it back. */
	readonly panel?: Pick<DetailPanel, 'reveal'>;
	/** Says something briefly in the status bar. Defaults to the editor's. */
	readonly say?: (message: string) => void;
};

/** What the selection wiring is built from. */
export interface SelectionWiring {
	readonly selection: SelectionService;
	readonly panel: Pick<DetailPanel, 'apply' | 'onDidChangeOpen'>;
	/** The Session view, which shows the rows of a selected session. */
	readonly sessionView: Pick<SessionDetailProvider, 'render'>;
	/** Marks the row the viewer is about. One row at a time, so the mark leaves the other views. */
	readonly selected: Pick<SelectedRows, 'mark'>;
	readonly sessions: SessionsProvider;
	readonly trails: TrailsProvider;
	readonly activity: ActivityProvider;
	readonly documents: Pick<GeneratedDocuments, 'set'>;
	readonly views: {
		readonly sessions: SelectableView<SessionNode>;
		readonly explorerSessions: SelectableView<SessionNode>;
		readonly trails: SelectableView<TrailsNode>;
		readonly activity: SelectableView<ActivityNode>;
	};
	/** Opens a generated document. Defaults to a preview tab in the editor. */
	readonly show?: (uri: vscode.Uri) => Promise<void>;
	/** Tells the user there is nothing to open. Defaults to an information message. */
	readonly inform?: (message: string) => void;
}

const ACTIVITY_PREFIXES = ['commit:', 'activity:', 'repo:'] as const;

async function showReadOnly(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, { preview: true });
}

/**
 * Loads the argument of `entirely.selectItem` into the viewer.
 *
 * The argument comes from a tree item's command, but the command can be run
 * by anything, so a value that is not a selection does nothing.
 */
export async function selectItem(
	selection: Pick<SelectionService, 'select' | 'notify'>,
	chosen: unknown,
	source: unknown,
): Promise<void> {
	if (!isSelection(chosen)) {
		// A row that arrives with nothing to show is said in the viewer, as a
		// line, and never thrown.
		selection.notify('Could not show that row: it did not carry anything to show. Select it again, or refresh the view.');
		return;
	}
	await selection.select(chosen, isSelectionSource(source) ? source : 'command');
}

/** Opens what the viewer shows as a read-only document, the way it is shown. */
export async function openDetailInEditor(wiring: SelectionCommandDependencies): Promise<void> {
	const state = wiring.selection.state;
	if (state.kind === 'empty' || state.kind === 'notice') {
		const inform = wiring.inform ?? ((message: string) => void vscode.window.showInformationMessage(message));
		inform('Select a session, a trail change or an Activity entry first, then open its details.');
		return;
	}
	const text = renderDetailDocument(state.model, describeViewerNote(state));
	const uri = wiring.documents.set('detail', text, `Details — ${state.model.title}`);
	await (wiring.show ?? showReadOnly)(uri);
}

/**
 * Copies the hash of the Activity commit the panel shows.
 *
 * The panel's link gives the row id, and anything else, including a hash
 * typed into a command link, is ignored: only the item on show can be
 * copied, and only what looks like a commit hash.
 */
export async function copyCommitHash(
	deps: Pick<SelectionCommandDependencies, 'selection' | 'copy' | 'say'>,
	rowId: unknown,
): Promise<void> {
	const shown = deps.selection.currentSelection;
	if (typeof rowId !== 'string' || shown?.kind !== 'commit' || selectionKey(shown) !== rowId) {
		return;
	}
	const hash = shown.entry.id;
	if (!hash || !isCommitHash(hash)) {
		return;
	}
	await (deps.copy ?? ((text: string) => vscode.env.clipboard.writeText(text)))(hash);
	(deps.say ?? ((message: string) => void vscode.window.setStatusBarMessage(message, 3000)))(`Copied ${hash}`);
}

/** Sends a keyboard or mouse selection in a tree to the service. A selection of several rows, or of a group, is ignored. */
function listen<T>(
	view: SelectableView<T>,
	selection: SelectionService,
	source: SelectionSource,
	toSelection: (node: T) => Selection | undefined,
	before?: (node: T) => void,
): vscode.Disposable {
	return view.onDidChangeSelection(event => {
		if (event.selection.length !== 1) {
			return;
		}
		const node = event.selection[0];
		const chosen = toSelection(node);
		if (chosen) {
			before?.(node);
			void selection.select(chosen, source);
		}
	});
}

/** Registers the commands the detail panel is driven by. */
export function registerSelectionCommands(context: { readonly subscriptions: vscode.Disposable[] }, wiring: SelectionCommandDependencies): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.selectItem', async (chosen?: unknown, source?: unknown) => {
			await selectItem(wiring.selection, chosen, source);
			// An unchanged item applies nothing, so a click on it must still
			// bring a hidden panel back.
			wiring.panel?.reveal();
		}),

		vscode.commands.registerCommand('entirely.retryDetail', async () => {
			await wiring.selection.refresh();
		}),

		vscode.commands.registerCommand('entirely.openDetailInEditor', async () => {
			await openDetailInEditor(wiring);
		}),

		vscode.commands.registerCommand('entirely.copyCommitHash', async (rowId?: unknown) => {
			await copyCommitHash(wiring, rowId);
		}),
	);
}

/**
 * Wires the Sessions, Trails and Activity views to the detail panel.
 *
 * A row is selected by clicking it (its command) and by moving to it with
 * the keyboard (the view's selection event); both reach one service that
 * reads the item once. Everything registered here goes onto the context.
 */
export function wireSelection(context: { readonly subscriptions: vscode.Disposable[] }, wiring: SelectionWiring): void {
	const { selection, sessions, trails, activity, views } = wiring;

	void vscode.commands.executeCommand('setContext', 'entirely.detailShown', false);

	context.subscriptions.push(
		selection.onDidChange(state => {
			wiring.sessionView.render(state);
			wiring.panel.apply(state);
			if (state.kind === 'empty' || state.kind === 'notice') {
				wiring.selected.mark(undefined);
			}
		}),

		// Closing the panel leaves nothing shown, so nothing is marked, and
		// the same row chosen again opens it again.
		wiring.panel.onDidChangeOpen(open => {
			void vscode.commands.executeCommand('setContext', 'entirely.detailShown', open);
			if (!open) {
				selection.release();
				wiring.selected.mark(undefined);
			}
		}),

		// The editor keeps its own highlight on the row last chosen in each
		// tree and an extension cannot clear it, so the viewer's row carries a
		// mark of its own, and there is one mark for all three views.
		selection.onDidSelect(({ key }) => wiring.selected.mark(key)),

		listen(views.sessions, selection, 'sessions', node => (node.kind === 'session' ? selectionOfSession(node) : undefined), node => {
			if (node.kind === 'session') {
				sessions.select(node);
			}
		}),
		listen(views.explorerSessions, selection, 'sessions', node => (node.kind === 'session' ? selectionOfSession(node) : undefined), node => {
			if (node.kind === 'session') {
				sessions.select(node);
			}
		}),
		listen(views.trails, selection, 'trails', selectionOfTrailsNode),
		listen(views.activity, selection, 'activity', node => (node.kind === 'line' ? node.selection : undefined)),

		// A row that disappears when its view is read again empties the viewer.
		// Only a change of the whole tree counts: marking a row refreshes the row.
		sessions.onDidChangeTreeData(element => {
			if (element === undefined) {
				selection.reconcile('sessions', key => sessions.contains(key.slice('session:'.length)));
			}
		}),
		trails.onDidChangeTreeData(element => {
			if (element === undefined) {
				selection.reconcile('trails', key => trails.has(key));
			}
		}),
		activity.onDidChangeTreeData(element => {
			if (element === undefined) {
				// Activity rows are drawn from the text of the last read, so a new
				// read makes everything held about them out of date.
				selection.clearCache(ACTIVITY_PREFIXES);
				selection.reconcile('activity', key => activity.contains(key));
			}
		}),
	);
}
