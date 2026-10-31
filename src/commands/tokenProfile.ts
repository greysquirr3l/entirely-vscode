import { EMPTY_PROFILE_TEXT, describeProfile, describeProfileScope, type ProfileScope } from '../lib/entire';
import type { TokenProfileSource } from '../services/tokenProfile';
import type { GeneratedViewUi } from './generatedView';

export interface TokenProfileUi extends GeneratedViewUi {
	/** Asks how much history to cover. `limit` is the number of checkpoints from the setting. */
	pickScope(limit: number): Promise<ProfileScope | undefined>;
}

export interface TokenProfileDependencies {
	readonly source: TokenProfileSource;
	readonly ui: TokenProfileUi;
	/** The number of checkpoints the setting asks for. */
	readonly limit: () => number;
}

export type TokenProfileResult = 'shown' | 'empty' | 'cancelled' | 'failed';

/**
 * Asks how much history to profile, reads the CLI's token profile, and opens
 * it as a read-only document. The command reads committed checkpoint
 * metadata and spends nothing, so there is no confirmation. A failure is
 * named and no empty profile is shown in its place.
 */
export async function showTokenProfile(deps: TokenProfileDependencies): Promise<TokenProfileResult> {
	const { ui } = deps;
	const scope = await ui.pickScope(deps.limit());
	if (!scope) {
		return 'cancelled';
	}
	const outcome = await ui.withProgress('Reading the token profile…', () => deps.source.read(scope));
	switch (outcome.kind) {
		case 'found':
			await ui.show('tokenProfile', describeProfile(outcome.profile, describeProfileScope(scope)), 'Token profile');
			return 'shown';
		case 'empty':
			await ui.show('tokenProfile', `# Token profile\n\n${EMPTY_PROFILE_TEXT}\n`, 'Token profile');
			return 'empty';
		case 'noCli':
		case 'unsupported':
			await ui.warn(`The token profile cannot be shown: ${outcome.detail}.`);
			return 'failed';
		case 'failed':
			await ui.warn(`The token profile could not be read: ${outcome.detail}.`);
			return 'failed';
	}
}
