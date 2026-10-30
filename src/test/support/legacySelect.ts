import { selectSession } from '../../commands/sessionDetail';
import type { SessionDetailProvider } from '../../providers/sessionDetailProvider';
import type { SessionItemNode, SessionsProvider } from '../../providers/sessionsProvider';
import { SelectionService } from '../../services/selection';
import { createSelectionLoader } from '../../services/selectionLoader';
import type { SessionDetailSource } from '../../services/sessionDetail';
import type { TokenUsageSource } from '../../services/tokenUsage';

/** What the session tests build their views from. */
export interface SessionViewDependencies {
	readonly sessions: SessionsProvider;
	readonly sessionDetail: SessionDetailProvider;
	readonly detail: SessionDetailSource;
	readonly usage: TokenUsageSource;
}

/**
 * Selects a session the way the extension does: through a selection service
 * that feeds the detail provider. The cache is off, so every call reads.
 */
export async function selectSessionInto(
	deps: SessionViewDependencies,
	element: SessionItemNode | undefined,
): Promise<void> {
	const service = new SelectionService({
		loader: createSelectionLoader({
			detail: deps.detail,
			usage: deps.usage,
			trails: {
				showCapability: async () => ({ kind: 'unavailable', reason: 'absent', detail: 'no trail reads in this test' }),
				show: async () => ({ kind: 'failed', detail: 'no trail reads in this test' }),
			},
		}),
		ttlSeconds: () => 0,
	});
	const bound = service.onDidChange(state => deps.sessionDetail.render(state));
	try {
		await selectSession({ sessions: deps.sessions, selection: service }, element);
	} finally {
		bound.dispose();
		service.dispose();
	}
}
