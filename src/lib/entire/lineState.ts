import type { WhyLine } from './why';

/**
 * What Entire can say about a line.
 *
 * - `attributed`: a recorded change accounts for the line.
 * - `unattributed`: no recorded change accounts for it (the CLI reports
 *   it as uncommitted, or as something the extension does not know).
 * - `unsynced`: a change is recorded for the line, but its checkpoint
 *   body has not reached this machine yet. The CLI marks this with
 *   `metadata_missing`.
 */
export type LineState = 'attributed' | 'unattributed' | 'unsynced';

/** Works out which of the three a line is. */
export function lineState(line: WhyLine): LineState {
	if (line.attribution === 'uncommitted') {
		return 'unattributed';
	}
	if (line.metadataMissing === true) {
		return 'unsynced';
	}
	return 'attributed';
}

/** The words for a state that is not simply attributed. */
export const UNATTRIBUTED_LABEL = 'Not attributed to any recorded change';
export const UNSYNCED_LABEL = 'Recorded change, not synced yet';
