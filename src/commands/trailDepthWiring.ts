import * as vscode from 'vscode';

import { touchedKeys, type ActingLogin, type TrailPick } from '../lib/entire';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { TrailsProvider } from '../providers/trailsProvider';
import type { CliRunner } from '../services/cli';
import { MAX_TRAIL_BADGE_LIMIT, readExtensionSettings } from '../services/configuration';
import type { GitService } from '../services/gitService';
import type { SelectionService } from '../services/selection';
import { TrailAuthoringService } from '../services/trailAuthoring';
import type { TrailChangesService } from '../services/trailChanges';
import type { DepthDependencies } from '../services/trailDepthSupport';
import { TrailDiscussionService } from '../services/trailDiscussions';
import { TrailFindingService } from '../services/trailFindings';
import type { TrailService } from '../services/trailService';
import { createThreadSource, type ThreadSource } from '../services/trailThreadSource';
import { TrailWatchService } from '../services/trailWatch';
import { registerTrailDepthCommands } from './trailDepthCommands';
import { EditorTrailDepthUi } from './trailDepthUi';

/** What the depth services are built from. */
export interface TrailDepthWiringOptions {
	readonly runner: CliRunner;
	readonly trails: TrailService;
	readonly workspaceRoot: () => string | undefined;
	readonly workspaceFolder: () => vscode.Uri | undefined;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<ActingLogin | undefined>;
	/** The handle of the login last seen acting, which names whose access is missing. */
	readonly actingHandle: () => string | undefined;
	readonly log: (line: string) => void;
}

/** The services built, and the means to finish wiring them once the Trails view exists. */
export interface TrailDepth {
	/** What the Trails view reads under a change. */
	readonly threads: ThreadSource;
	/** Registers the commands, once the view's provider exists. */
	register(
		context: vscode.ExtensionContext,
		view: {
			readonly provider: TrailsProvider;
			readonly selection: SelectionService;
			readonly trailChanges: Pick<TrailChangesService, 'withChanges'>;
			readonly documents: GeneratedDocuments;
			readonly git: GitService | undefined;
		},
	): void;
}

/**
 * Builds the services behind trail create and update, the discussions and
 * findings under a change, and the watch, and registers their commands.
 *
 * The watch service is disposed with the extension, which ends every watch
 * process. Nothing here runs on a timer of its own.
 */
export function createTrailDepth(options: TrailDepthWiringOptions): TrailDepth {
	const depth: DepthDependencies = { runner: options.runner, trails: options.trails, workspaceRoot: options.workspaceRoot };
	const authoring = new TrailAuthoringService(depth);
	const discussions = new TrailDiscussionService(depth);
	const findings = new TrailFindingService(depth);
	let provider: TrailsProvider | undefined;

	const watch = new TrailWatchService({
		...depth,
		limit: () => readExtensionSettings().trailWatchLimit,
		refreshDelaySeconds: () => readExtensionSettings().trailWatchRefreshDelay,
		refresh: key => provider?.invalidateThreads(key),
		login: options.actingHandle,
		log: options.log,
		ended: (_key, reason) => {
			void vscode.window.showInformationMessage(`Entirely stopped watching: ${reason}`);
		},
	});

	return {
		threads: createThreadSource(depth, discussions, findings, watch, options.actingHandle),
		register(context, view) {
			provider = view.provider;
			const trailsProvider = view.provider;
			const changed = (pick?: TrailPick): void => {
				if (pick) {
					view.selection.invalidate(touchedKeys(pick));
				}
				void trailsProvider.refresh().then(() => view.selection.reloadFrom(trailsProvider));
			};
			registerTrailDepthCommands(context, {
				trails: options.trails,
				authoring,
				discussions,
				findings,
				watch,
				acting: options.acting,
				ui: new EditorTrailDepthUi(view.documents),
				changed,
				threadsChanged: key => {
					if (key) {
						trailsProvider.invalidateThreads(key);
					}
				},
				withChanges: trails =>
					Promise.resolve(
						vscode.window.withProgress(
							{ location: vscode.ProgressLocation.Notification, title: 'Reading the changes of the trails…', cancellable: true },
							(_progress, token) => view.trailChanges.withChanges(trails, MAX_TRAIL_BADGE_LIMIT, () => token.isCancellationRequested),
						),
					),
				currentBranch: () => {
					const repository = view.git?.repositoryFor(options.workspaceFolder());
					return view.git && repository ? view.git.currentBranch(repository) : undefined;
				},
				folderName: () => vscode.workspace.workspaceFolders?.[0]?.name ?? 'the workspace',
				retryThreads: target => {
					if (typeof target === 'object' && target !== null && 'kind' in target) {
						trailsProvider.retryThreads(target as Parameters<TrailsProvider['retryThreads']>[0]);
					}
				},
			});
		},
	};
}
