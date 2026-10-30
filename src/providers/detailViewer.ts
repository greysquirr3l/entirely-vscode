import * as vscode from 'vscode';

import { formatClock, selectionKey, type ViewerState } from '../lib/entire';
import type { DetailNode, SessionDetailProvider } from './sessionDetailProvider';

/** The part of the viewer's tree view this class drives. */
export interface ViewerSurface {
	title?: string;
	description?: string;
	reveal(element: DetailNode, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Thenable<void>;
}

/** The viewer's title. The view's id never changes, only what it is called. */
export const VIEWER_TITLE = 'Details';

/** The viewer's description for a state: the name of the item, and when it was read if it is from the cache. */
export function describeViewer(state: ViewerState): string | undefined {
	if (state.kind === 'empty') {
		return undefined;
	}
	if (state.kind === 'notice') {
		return 'Nothing to show';
	}
	const name = state.model.title;
	return state.kind === 'ready' && state.asOf !== undefined ? `${name} · as of ${formatClock(state.asOf)}` : name;
}

/**
 * Shows the selection service's state in the Details tree view.
 *
 * A collapsed or hidden view is revealed when the content changes to a
 * different item, without taking keyboard focus from the view the user
 * chose the row in. Choosing the item that is already shown reveals
 * nothing again.
 */
export class DetailViewer implements vscode.Disposable {
	private revealed: string | undefined;

	constructor(
		private readonly provider: SessionDetailProvider,
		private readonly surface: ViewerSurface,
	) {
		surface.title = VIEWER_TITLE;
	}

	apply(state: ViewerState): void {
		this.provider.render(state);
		this.surface.description = describeViewer(state);

		if (state.kind === 'empty') {
			this.revealed = undefined;
			return;
		}

		const key = state.kind === 'notice' ? `notice:${state.message}` : selectionKey(state.selection);
		const first = this.provider.firstNode;
		if (key === this.revealed || !first) {
			return;
		}
		this.revealed = key;
		// Revealing a node of a view that is not on screen fails quietly: the
		// content is there when the view is next opened.
		void Promise.resolve(this.surface.reveal(first, { focus: false, select: false })).then(undefined, () => undefined);
	}

	dispose(): void {
		this.revealed = undefined;
	}
}
