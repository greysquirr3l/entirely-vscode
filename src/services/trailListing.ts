import { scopeToProject, type TrailListing } from '../lib/entire';
import type { TrailService } from './trailService';

/** Reads the trails section's content. */
export type TrailListingSource = () => Promise<TrailListing>;

/**
 * Reads the trails of the workspace's project.
 *
 * The project comes from `repo view` and the trails from `trail list`. The
 * CLI's list does not carry a trail's changes, so none are read here: they
 * are read when a trail is expanded or selected, with their gates, by
 * `TrailChangesService`.
 */
export function createTrailListingSource(trails: TrailService): TrailListingSource {
	return async (): Promise<TrailListing> => {
		const workspace = await trails.workspace();
		if (workspace.kind === 'failed') {
			return { trails: [], emptyReason: workspace.detail };
		}

		const project = workspace.value.project;
		const list = await trails.list(project);
		if (list.kind === 'failed') {
			return { project, trails: [], emptyReason: list.detail };
		}

		const scoped = scopeToProject(list.value.items, project).map(trail => ({ trail, changes: [] }));

		return {
			project,
			trails: scoped,
			emptyReason: scoped.length === 0 ? `${project} has no trails.` : undefined,
		};
	};
}
