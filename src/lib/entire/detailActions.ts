import type { DetailRow } from './sessionDetailRows';
import type { DetailModel } from './selection';

/**
 * The commands the detail panel links to, and the only ones its links may run.
 *
 * The panel is a webview, so a link in it runs a command by id. VS Code only
 * runs the ids listed when the panel is created, so this list is also the
 * panel's `enableCommandUris`. Each of these commands checks its own argument.
 */
export const DETAIL_COMMANDS = [
	'entirely.retryDetail',
	'entirely.openDetailInEditor',
	'entirely.refresh',
	'entirely.setUp',
	'entirely.trailApprove',
	'entirely.trailComment',
	'entirely.trailMerge',
	'entirely.trailCheckout',
	'entirely.trailLink',
	'entirely.trailUnlink',
	'entirely.copyCommitHash',
	'entirely.openTranscript',
	'entirely.explainCheckpoint',
] as const;

export type DetailCommand = (typeof DETAIL_COMMANDS)[number];

/** Whether an id is one the panel may link to. */
export function isDetailCommand(id: string): id is DetailCommand {
	return (DETAIL_COMMANDS as readonly string[]).includes(id);
}

/** One link in the panel's action bar. */
export interface DetailAction {
	readonly label: string;
	readonly command: DetailCommand;
	/** What the command is given: the row id, as text. */
	readonly args: readonly string[];
	/** Said to a screen reader and shown as the hover text. */
	readonly description: string;
}

/**
 * The address of a link that runs a command.
 *
 * The arguments are JSON in the query, as VS Code's command links take
 * them, and every one is a string.
 */
export function linkFor(command: DetailCommand, args: readonly string[]): string {
	return args.length === 0 ? `command:${command}` : `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

/**
 * The link of a row that runs a command, when its command is one the panel
 * may run and its arguments are all text.
 */
export function rowLink(row: DetailRow): string | undefined {
	const run = row.command;
	if (!run || !isDetailCommand(run.command) || !run.arguments.every(argument => typeof argument === 'string')) {
		return undefined;
	}
	return linkFor(run.command, run.arguments as readonly string[]);
}

function action(label: string, command: DetailCommand, key: string, description: string): DetailAction {
	return { label, command, args: [key], description };
}

/**
 * The actions the panel offers for an item, besides Refresh and Open as text.
 *
 * Each one is an existing command given the item's row id. The commands
 * keep their own confirmations, so nothing here changes anything by itself.
 */
export function detailActions(model: DetailModel): DetailAction[] {
	const key = model.key;
	switch (model.kind) {
		case 'change':
			return [
				action('Approve', 'entirely.trailApprove', key, 'Approve this change'),
				action('Comment', 'entirely.trailComment', key, 'Comment on this change'),
				action('Merge', 'entirely.trailMerge', key, 'Merge this change'),
				action('Check out', 'entirely.trailCheckout', key, 'Check out this change’s branch'),
				action('Link branch', 'entirely.trailLink', key, 'Link the current branch to this trail'),
				action('Unlink branch', 'entirely.trailUnlink', key, 'Remove a branch from this trail'),
			];
		case 'trail':
			return [
				action('Link branch', 'entirely.trailLink', key, 'Link the current branch to this trail'),
				action('Unlink branch', 'entirely.trailUnlink', key, 'Remove a branch from this trail'),
			];
		case 'commit':
			// Only a line that printed a hash has one to copy.
			return model.rows.some(row => row.label === 'Commit')
				? [action('Copy hash', 'entirely.copyCommitHash', key, 'Copy the commit hash')]
				: [];
		case 'session':
			// A session's transcript and checkpoint links are rows of its own.
		case 'activity-session':
		case 'repository':
			return [];
	}
}
