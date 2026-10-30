import type { RecapPeriod } from '../lib/entire';
import type { RecapSource } from '../services/recap';

/** The questions and answers of the recap command. */
export interface RecapUi {
	pickPeriod(periods: readonly RecapPeriod[]): Promise<RecapPeriod | undefined>;
	withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
	warn(message: string): Promise<void>;
	/** Opens the recap in a read-only editor. */
	showRecap(text: string): Promise<void>;
}

export interface RecapDependencies {
	readonly source: RecapSource;
	readonly ui: RecapUi;
}

export type RecapResult = 'shown' | 'cancelled' | 'failed';

/**
 * Asks which period to summarise, reads the CLI's static recap, and opens
 * it in a read-only editor. The periods are the ones the CLI's help
 * describes. Nothing here changes anything, so there is no confirmation.
 */
export async function showRecap(deps: RecapDependencies): Promise<RecapResult> {
	const { ui, source } = deps;
	const periods = await source.periods();
	if (!periods.ok) {
		await ui.warn(`The recap cannot be shown: ${periods.detail}.`);
		return 'failed';
	}

	let period: RecapPeriod | undefined;
	if (periods.value.length > 0) {
		period = await ui.pickPeriod(periods.value);
		if (!period) {
			return 'cancelled';
		}
	}

	const chosen = period;
	const outcome = await ui.withProgress('Reading the recap…', () => source.read(chosen));
	switch (outcome.kind) {
		case 'found':
			await ui.showRecap(outcome.text);
			return 'shown';
		case 'empty':
			await ui.warn('The Entire CLI printed no recap for that period.');
			return 'failed';
		case 'failed':
			await ui.warn(`The recap could not be read: ${outcome.detail}.`);
			return 'failed';
	}
}
