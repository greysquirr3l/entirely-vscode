import type { DiscussionView } from './trailDepth';
import { escapeMarkdown } from './text';

/**
 * The Markdown document for a discussion.
 *
 * Every value in it came from the CLI or from a person who wrote in the
 * discussion, so each is escaped and can only be text: a message that
 * holds a link, a heading or an HTML tag is shown as the words it is.
 * The document opens only on the explicit command and is never logged.
 */
export function discussionMarkdown(change: string, discussionTitle: string | undefined, view: DiscussionView): string {
	const title = view.title ?? discussionTitle;
	const lines: string[] = [`# ${escapeMarkdown(title && title.length > 0 ? title : 'Untitled discussion')}`, '', `On ${escapeMarkdown(change)}`, ''];
	if (view.messages === undefined) {
		lines.push('The CLI answered in a form this version of Entirely does not read, so the messages are not shown.');
		return `${lines.join('\n')}\n`;
	}
	if (view.messages.length === 0) {
		lines.push('This discussion holds no messages.');
		return `${lines.join('\n')}\n`;
	}
	for (const message of view.messages) {
		const who = message.author ? escapeMarkdown(message.author) : 'Someone';
		const when = message.createdAt ? `, ${escapeMarkdown(message.createdAt)}` : '';
		lines.push(`## ${who}${when}`, '', escapeMarkdown(message.body ?? ''), '');
	}
	return `${lines.join('\n')}\n`;
}
