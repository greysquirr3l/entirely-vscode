import { truncatePrompt } from './text';
import type { TrailComment, TrailFinding } from './trail';

/**
 * How the discussions and findings under a change are drawn.
 *
 * The text comes from the CLI, so it is shown as the CLI gave it and cut
 * to one line. These are pure so the rows can be tested without a tree.
 */

/** The longest label a finding row has. */
export const FINDING_LABEL_LIMIT = 80;

/** The label of a discussion. */
export function discussionLabel(discussion: TrailComment): string {
	const title = discussion.title?.trim();
	return title && title.length > 0 ? truncatePrompt(title, FINDING_LABEL_LIMIT) : 'Untitled discussion';
}

/** The state beside a discussion: resolved or open, how many messages, and who wrote last. */
export function describeDiscussion(discussion: TrailComment): string {
	const parts: string[] = [discussion.resolved ? 'resolved' : 'open'];
	if (discussion.messageCount !== undefined) {
		parts.push(`${discussion.messageCount} ${discussion.messageCount === 1 ? 'message' : 'messages'}`);
	}
	if (discussion.lastMessageAuthor) {
		parts.push(`last by ${discussion.lastMessageAuthor}`);
	}
	return parts.join(' · ');
}

/** The context value of a discussion row, which decides its actions. */
export function discussionContextValue(discussion: TrailComment): string {
	return discussion.resolved ? 'entirely.discussion.resolved' : 'entirely.discussion';
}

/** The label of a finding: its title, else the first line of its body, else a fixed label. */
export function findingLabel(finding: TrailFinding): string {
	const title = finding.title?.trim();
	if (title && title.length > 0) {
		return truncatePrompt(title, FINDING_LABEL_LIMIT);
	}
	const body = finding.body?.trim();
	return body && body.length > 0 ? truncatePrompt(body, FINDING_LABEL_LIMIT) : 'Untitled finding';
}

/** The status of a finding, as the three states the rows tell apart. */
export function findingStatus(finding: TrailFinding): 'open' | 'resolved' | 'dismissed' {
	const state = finding.state?.trim().toLowerCase();
	return state === 'resolved' || state === 'dismissed' ? state : 'open';
}

/** The state beside a finding: severity, status, and where it is. */
export function describeFinding(finding: TrailFinding): string {
	const parts: string[] = [];
	if (finding.severity) {
		parts.push(finding.severity);
	}
	parts.push(findingStatus(finding));
	if (finding.file) {
		parts.push(finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`);
	}
	return parts.join(' · ');
}

/** The context value of a finding row, which decides its actions. */
export function findingContextValue(finding: TrailFinding): string {
	return `entirely.finding.${findingStatus(finding)}`;
}

/** The icon of a finding row, by its status and then its severity. */
export function findingIcon(finding: TrailFinding): string {
	const status = findingStatus(finding);
	if (status === 'resolved') {
		return 'pass';
	}
	if (status === 'dismissed') {
		return 'circle-slash';
	}
	switch (finding.severity?.trim().toLowerCase()) {
		case 'high':
			return 'error';
		case 'medium':
			return 'warning';
		default:
			return 'info';
	}
}
