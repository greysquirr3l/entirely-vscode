import {
	BUNDLE_NOTICE,
	RAW_BUNDLE_NOTICE,
	checkBundlePath,
	confirmBundleWrite,
	defaultBundleName,
	describeBundleOutcome,
	type AccountContext,
} from '../lib/entire';
import type { DoctorDepthService } from '../services/doctorDepth';
import { reportUnavailable, whileIdle, type DepthFiles, type DoctorDepthUi } from './doctorDepth';

export interface BundleDependencies {
	readonly service: DoctorDepthService;
	readonly files: DepthFiles;
	readonly ui: DoctorDepthUi;
	/** The login the CLI will act as, read again just before the run. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly now?: () => Date;
	readonly running?: { active: boolean };
}

export type BundleResult = 'written' | 'unconfirmed' | 'failed' | 'cancelled' | 'declined' | 'refused' | 'busy' | 'unavailable';

const REVEAL = 'Reveal in File Explorer';
const COPY_PATH = 'Copy Path';

/**
 * Writes a diagnostic bundle to a path the person chose.
 *
 * Nothing is asked of the CLI until the person has read what the archive
 * holds, chosen a path that passes the checks, and agreed to replace a file
 * that is already there. The CLI's secret redaction stays on unless this is
 * the separate command for an unredacted bundle, which has its own strict
 * question. The file is read back afterwards and never opened in the editor.
 */
export async function writeDiagnosticBundle(deps: BundleDependencies, options: { readonly raw: boolean }): Promise<BundleResult> {
	const { ui, files } = deps;
	return whileIdle<BundleResult>(deps.running, ui, 'busy', async later => {
		const check = await deps.service.checkBundle();
		if (!check.ok) {
			later(() => reportUnavailable(ui, check));
			return 'unavailable';
		}
		const { flags } = check;
		const out = flags.out;
		if (!out) {
			void ui.notify('warn', 'This Entire CLI does not describe where a bundle is written, so none is offered. Update the CLI.');
			return 'unavailable';
		}
		if (options.raw && !flags.raw) {
			void ui.notify('warn', 'This Entire CLI does not describe an unredacted bundle, so none is offered. Update the CLI.');
			return 'unavailable';
		}

		if (!(await ui.confirm(options.raw ? RAW_BUNDLE_NOTICE : BUNDLE_NOTICE))) {
			return 'declined';
		}

		const file = await ui.chooseSavePath({
			title: options.raw ? 'Save the unredacted diagnostic bundle' : 'Save the diagnostic bundle',
			defaultName: defaultBundleName((deps.now ?? (() => new Date()))()),
			extensions: ['zip'],
		});
		if (file === undefined) {
			return 'declined';
		}

		const path = checkBundlePath(file, await files.inspect(file));
		if (!path.ok) {
			void ui.notify('warn', `The bundle was not written: ${path.reason}.`);
			return 'refused';
		}
		const question = confirmBundleWrite(file, path, options.raw);
		if (question && !(await ui.confirm(question))) {
			return 'declined';
		}

		const acting = await deps.acting();
		const outcome = await ui.withProgress(options.raw ? 'Writing the unredacted bundle…' : 'Writing the bundle…', signal =>
			deps.service.writeBundle({ out, raw: flags.raw }, file, options.raw, acting, signal),
		);

		const message = describeBundleOutcome(outcome);
		if (outcome.kind === 'written') {
			later(async () => {
				const choice = await ui.notify('info', message, [REVEAL, COPY_PATH]);
				if (choice === REVEAL) {
					await ui.reveal(outcome.file);
				} else if (choice === COPY_PATH) {
					await ui.copyText(outcome.file);
				}
			});
			return 'written';
		}
		void ui.notify(outcome.kind === 'cancelled' ? 'info' : 'warn', message);
		return outcome.kind;
	});
}
