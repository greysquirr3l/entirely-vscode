import type { ImportOutcome, ImportPreview, ImportScope } from '../lib/entire';
import type { HistoryImportSource } from '../services/historyImport';

/** What the import asks the person to agree to. */
export interface ImportConfirmation {
	readonly message: string;
	/** The CLI's own report of what would be imported. */
	readonly detail: string;
	readonly action: string;
}

/** How the person narrowed the import: everything the agent has, or chosen sessions. */
export type ImportNarrowing = { readonly kind: 'all' } | { readonly kind: 'sessions'; readonly ids: readonly string[] };

/** The questions and answers of the import command. */
export interface ImportUi {
	chooseAgent(agents: readonly string[]): Promise<string | undefined>;
	chooseNarrowing(agent: string): Promise<ImportNarrowing | undefined>;
	/** True only when the person chose to go ahead. */
	confirm(prompt: ImportConfirmation): Promise<boolean>;
	/**
	 * Runs the work with progress shown. The signal aborts when the person cancels.
	 * The work runs off the host's event loop; this only wraps it.
	 */
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
}

/** What the import command needs. */
export interface ImportDependencies {
	readonly importer: HistoryImportSource;
	readonly ui: ImportUi;
	/** Re-reads the checkpoint and session views. */
	readonly refresh: () => Promise<void>;
	/** True while an import is running, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

/** How the command ended. */
export type ImportResult = 'cancelled' | 'done' | 'failed' | 'nothing-to-import';

const sharedRunning = { active: false };

/** The confirmation's words, from what the CLI said it would do. */
function confirmation(scope: ImportScope, preview: ImportPreview): ImportConfirmation {
	const which = scope.sessionIds.length > 0 ? `${scope.sessionIds.length} chosen session(s)` : 'the past month of history';
	return {
		message: `Import ${scope.agent} ${which} as read-only checkpoints?`,
		detail:
			`This uses an experimental Entire CLI command. The CLI reports:\n\n${preview.text}\n\n` +
			'Imported checkpoints are read-only: they cannot be resumed or rewound, and are not linked to a commit. ' +
			'Nothing has been written yet.',
		action: 'Import',
	};
}

/**
 * Imports past agent history, after showing what would be imported.
 *
 * The CLI's preview (its dry run) is the only source of what will happen;
 * the person agrees to that text, and a declined preview runs nothing. The
 * import itself runs with progress and can be cancelled. The outcome is
 * what the CLI reported, and the views are re-read either way because a
 * cancelled or failed import may still have written some turns.
 */
export async function importHistory(deps: ImportDependencies): Promise<ImportResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.inform('An import is already running.');
		return 'cancelled';
	}
	running.active = true;
	try {
		return await runImport(deps);
	} finally {
		running.active = false;
	}
}

async function runImport(deps: ImportDependencies): Promise<ImportResult> {
	const { importer, ui } = deps;

	const offered = await importer.agents();
	if (!offered.ok) {
		await ui.warn(`Cannot import history: ${offered.detail}.`);
		return 'failed';
	}
	const agent = await ui.chooseAgent(offered.agents);
	if (agent === undefined) {
		return 'cancelled';
	}
	const narrowing = await ui.chooseNarrowing(agent);
	if (narrowing === undefined) {
		return 'cancelled';
	}
	const scope: ImportScope = { agent, sessionIds: narrowing.kind === 'sessions' ? narrowing.ids : [] };

	const previewed = await ui.withProgress(`Checking what ${agent} history would be imported…`, () => importer.preview(scope));
	if (!previewed.ok) {
		await ui.warn(`Could not preview the ${agent} import: ${previewed.detail}.`);
		return 'failed';
	}
	if (previewed.preview.nothingToImport) {
		await ui.inform(`Nothing to import from ${agent}. The CLI said: ${previewed.preview.text}`);
		return 'nothing-to-import';
	}

	if (!(await ui.confirm(confirmation(scope, previewed.preview)))) {
		return 'cancelled';
	}

	const outcome: ImportOutcome = await ui.withProgress(`Importing ${agent} history…`, signal => importer.run(scope, signal));
	await deps.refresh();

	switch (outcome.kind) {
		case 'done':
			await ui.inform(outcome.text);
			return 'done';
		case 'cancelled':
			await ui.warn(
				`The ${agent} import was cancelled. Some turns may already be imported; running it again skips them.`,
			);
			return 'cancelled';
		case 'failed':
			await ui.warn(`The ${agent} import failed: ${outcome.detail}.`);
			return 'failed';
	}
}
