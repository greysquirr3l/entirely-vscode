import type { ControlConfirmation } from './controlPlaneActions';
import type { PathCheck } from './bundlePath';

/** What the person is told before any path is asked for. */
export const BUNDLE_NOTICE: ControlConfirmation = {
	message: 'Write a diagnostic bundle?',
	detail:
		"The archive holds the CLI's logs, your Entire settings files and a snapshot of git status, history and remotes. " +
		'Known secrets are redacted by pattern; prompts, file paths and commit messages that appear in those files are not. ' +
		'Treat it as private, and do not attach it anywhere you would not paste your logs.',
	action: 'Choose where to save…',
};

/** The separate, strict question before an unredacted bundle. */
export const RAW_BUNDLE_NOTICE: ControlConfirmation = {
	message: 'Write an UNREDACTED bundle?',
	detail:
		'The archive will hold raw log lines, settings and git output, including any API keys, tokens or credentials they contain. ' +
		'Only do this when Entire support has asked for it.',
	action: 'Write unredacted bundle',
};

const WORKSPACE_WARNING = 'This folder is inside the workspace, so git may offer to commit the archive.';

/** The question before the CLI is run, when the path replaces a file or sits in the workspace. */
export function confirmBundleWrite(file: string, check: Extract<PathCheck, { ok: true }>, raw: boolean): ControlConfirmation | undefined {
	if (!check.overwrites && !check.insideWorkspace) {
		return undefined;
	}
	const parts: string[] = [];
	if (check.overwrites) {
		parts.push('Its current contents will be lost.');
	}
	if (check.insideWorkspace) {
		parts.push(WORKSPACE_WARNING);
	}
	if (raw) {
		parts.push('The new archive will be unredacted.');
	}
	return {
		message: check.overwrites ? `Replace ${file}?` : `Write the bundle to ${file}?`,
		detail: parts.join('\n\n'),
		action: check.overwrites ? 'Replace' : 'Write the bundle',
	};
}

/** How a bundle ended. */
export type BundleOutcome =
	| { readonly kind: 'written'; readonly file: string; readonly bytes: number; readonly raw: boolean }
	| { readonly kind: 'unconfirmed'; readonly file: string; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string }
	| { readonly kind: 'cancelled'; readonly file: string };

/** The sentence that says how a bundle ended. */
export function describeBundleOutcome(outcome: BundleOutcome): string {
	switch (outcome.kind) {
		case 'written': {
			const size = outcome.bytes < 1024 ? `${outcome.bytes} B` : `${Math.max(1, Math.round(outcome.bytes / 1024))} KB`;
			return outcome.raw
				? `The unredacted bundle was written to ${outcome.file} (${size}). It may hold secrets; handle it as one.`
				: `The bundle was written to ${outcome.file} (${size}). Secrets are redacted by pattern; other content is not.`;
		}
		case 'unconfirmed':
			return `The bundle is unconfirmed: ${outcome.detail}.`;
		case 'failed':
			return `The bundle was not written: ${outcome.detail}.`;
		case 'cancelled':
			return `The bundle was cancelled. A partial file may remain at ${outcome.file}.`;
	}
}

/** What reading a written bundle back found. */
export type BundleReadback =
	| { readonly kind: 'zip'; readonly bytes: number }
	| { readonly kind: 'missing' }
	| { readonly kind: 'not-a-file' }
	| { readonly kind: 'empty' }
	| { readonly kind: 'not-a-zip' };

/** Turns what was found at the path into an outcome. */
export function bundleOutcomeFromReadback(file: string, readback: BundleReadback, raw: boolean): BundleOutcome {
	switch (readback.kind) {
		case 'zip':
			return { kind: 'written', file, bytes: readback.bytes, raw };
		case 'missing':
			return { kind: 'unconfirmed', file, detail: `the CLI finished but no archive was found at ${file}` };
		case 'not-a-file':
			return { kind: 'unconfirmed', file, detail: `the CLI finished but what is at ${file} is not a regular file` };
		case 'empty':
			return { kind: 'unconfirmed', file, detail: `the CLI finished but the file at ${file} is empty` };
		case 'not-a-zip':
			return { kind: 'unconfirmed', file, detail: `the CLI finished but the file at ${file} is not a zip archive` };
	}
}
