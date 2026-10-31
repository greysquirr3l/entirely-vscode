import type { TrailComment, TrailFinding, TrailSelector, WatchState } from '../lib/entire';
import { depthFailure, type DepthDependencies } from './trailDepthSupport';
import type { TrailDiscussionService } from './trailDiscussions';
import type { TrailFindingService } from './trailFindings';
import type { TrailResult } from './trailService';
import type { TrailWatchService } from './trailWatch';

/** What the Trails view reads under a change. */
export interface ThreadSource {
	/** The discussions of a change. A failure is already worded for the person. */
	discussions(selector: TrailSelector): Promise<TrailResult<readonly TrailComment[]>>;
	/** The findings of a change, every status, so a resolved or dismissed one stays visible. */
	findings(selector: TrailSelector): Promise<TrailResult<readonly TrailFinding[]>>;
	/** Where a change's watch is. */
	watchState(key: string): WatchState | undefined;
	/** Calls back when a change's watch state changes. */
	onWatchChanged(listener: (key: string) => void): { dispose(): void };
}

/**
 * The reads behind the Comments and Findings groups.
 *
 * A failure is worded once here, so a collaborator who cannot see the
 * project gets the honest access message under the change and not the
 * CLI's schema complaint.
 */
export function createThreadSource(
	deps: DepthDependencies,
	discussions: Pick<TrailDiscussionService, 'list'>,
	findings: Pick<TrailFindingService, 'list'>,
	watch: Pick<TrailWatchService, 'stateOf' | 'onDidChange'>,
	actingHandle: () => string | undefined,
): ThreadSource {
	const worded = async <T>(result: TrailResult<T>): Promise<TrailResult<T>> => {
		if (result.kind === 'ok') {
			return result;
		}
		const handle = actingHandle();
		return {
			kind: 'failed',
			detail: await depthFailure(deps, result.detail, result.detail, handle ? { name: '', handle } : undefined),
		};
	};
	return {
		discussions: async selector => worded(await discussions.list(selector)),
		findings: async selector => worded(await findings.list(selector)),
		watchState: key => watch.stateOf(key),
		onWatchChanged: listener => watch.onDidChange(listener),
	};
}
