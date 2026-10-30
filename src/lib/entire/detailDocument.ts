import type { DetailRow } from './sessionDetailRows';
import type { DetailModel } from './selection';

function renderRow(row: DetailRow): string[] {
	if (row.lines) {
		const summary = row.value.length > 0 ? ` (${row.value})` : '';
		return [`${row.label}${summary}:`, ...row.lines.map(line => `  ${line}`)];
	}
	return [`${row.label}: ${row.value}`];
}

/**
 * The detail as text for a read-only document.
 *
 * This is the only place a trail's body is written out in full. The
 * viewer rows say only that a description exists, and the output channel
 * never sees it.
 *
 * `note` is what the viewer says about the item's state, such as that it is
 * still loading, so the document says what the viewer says.
 */
export function renderDetailDocument(model: DetailModel, note?: string): string {
	const lines: string[] = [`Details — ${model.title}`, ''];
	if (note) {
		lines.push(note, '');
	}
	if (model.heading) {
		lines.push(model.heading, '');
	}
	for (const row of model.rows) {
		lines.push(...renderRow(row));
	}
	if (model.body && model.body.trim().length > 0) {
		lines.push('', 'Description', '-----------', model.body.trim());
	}
	return `${lines.join('\n')}\n`;
}
