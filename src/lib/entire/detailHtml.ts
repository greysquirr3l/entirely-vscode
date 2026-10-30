import { detailActions, linkFor, rowLink, type DetailAction } from './detailActions';
import { escapeHtml } from './htmlEscape';
import type { DetailRow } from './sessionDetailRows';
import { describeViewerNote, formatClock, type DetailModel, type ViewerState } from './selection';

/**
 * The page's Content-Security-Policy: no scripts, no images, no fonts, no
 * frames, no connections. The page is text and links, with inline style.
 */
export const DETAIL_CSP = "default-src 'none'; style-src 'unsafe-inline';";

const KIND_WORDS: Record<DetailModel['kind'], string> = {
	session: 'Session',
	trail: 'Trail',
	change: 'Change',
	commit: 'Commit',
	'activity-session': 'Session line',
	repository: 'Repository',
};

/** Colour only through the editor's theme variables, so light, dark and high contrast all work. */
const STYLES = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 1rem 1.5rem 2rem; line-height: 1.5; }
main { max-width: 52rem; }
.kind { margin: 0; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.85em; }
h1 { font-size: 1.4em; font-weight: 600; margin: 0.1rem 0 0.25rem; overflow-wrap: anywhere; }
h2 { font-size: 1.05em; font-weight: 600; margin: 1.5rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, currentColor)); }
.asof { margin: 0; color: var(--vscode-descriptionForeground); }
a { color: var(--vscode-textLink-foreground); text-decoration: underline; }
a:hover { color: var(--vscode-textLink-activeForeground); }
a:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
.actions { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.actions a { display: inline-block; padding: 0.2rem 0.75rem; text-decoration: none; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-textLink-foreground))); border-radius: 2px; }
.actions a:hover { background: var(--vscode-button-secondaryHoverBackground); color: var(--vscode-button-secondaryForeground); }
.note { margin: 1rem 0 0; padding: 0.5rem 0.75rem; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, currentColor)); border-left-width: 4px; background: var(--vscode-textBlockQuote-background); }
.note strong { margin-right: 0.25rem; }
.fields { display: grid; grid-template-columns: minmax(8rem, max-content) 1fr; gap: 0.25rem 1rem; margin: 0; }
.fields dt { color: var(--vscode-descriptionForeground); }
.fields dd { margin: 0; overflow-wrap: anywhere; }
.lines { margin: 0; padding-left: 1.25rem; }
.lines li { overflow-wrap: anywhere; white-space: pre-wrap; }
`;

function anchor(href: string, text: string, title?: string): string {
	return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</a>`;
}

function renderValue(row: DetailRow): string {
	const text = escapeHtml(row.value);
	// Only an https address is followed, whatever the CLI printed.
	if (row.link && /^https:\/\//i.test(row.link)) {
		return anchor(row.link, row.value, row.tooltip);
	}
	const link = rowLink(row);
	if (link) {
		return anchor(link, row.value, row.tooltip);
	}
	return row.tooltip ? `<span title="${escapeHtml(row.tooltip)}">${text}</span>` : text;
}

function renderRows(rows: readonly DetailRow[]): string {
	const out: string[] = [];
	let fields: string[] = [];
	let sections = 0;

	const flush = (): void => {
		if (fields.length === 0) {
			return;
		}
		out.push(`<section><h2>${sections === 0 ? 'Details' : 'More details'}</h2><dl class="fields">${fields.join('')}</dl></section>`);
		sections += 1;
		fields = [];
	};

	for (const row of rows) {
		if (row.lines) {
			flush();
			const summary = row.value.length > 0 ? ` (${escapeHtml(row.value)})` : '';
			out.push(
				`<section><h2>${escapeHtml(row.label)}${summary}</h2><ul class="lines">${row.lines
					.map(line => `<li>${escapeHtml(line)}</li>`)
					.join('')}</ul></section>`,
			);
			continue;
		}
		fields.push(`<dt>${escapeHtml(row.label)}</dt><dd>${renderValue(row)}</dd>`);
	}
	flush();
	return out.join('\n');
}

function renderActions(actions: readonly DetailAction[]): string {
	const links = actions.map(
		item => `<li>${anchor(linkFor(item.command, item.args), item.label, item.description)}</li>`,
	);
	return `<nav aria-label="Actions"><ul class="actions">${links.join('')}</ul></nav>`;
}

/** The state's own line, with the word that says what it is so colour is never the only sign. */
function renderNote(state: ViewerState): string {
	const note = describeViewerNote(state);
	if (!note) {
		return '';
	}
	const retry = anchor(linkFor('entirely.retryDetail', []), 'Retry');
	switch (state.kind) {
		case 'loading':
			return `<p class="note" role="status"><strong>Loading.</strong>${escapeHtml(note)}</p>`;
		case 'failed':
			return `<p class="note" role="alert"><strong>Error.</strong>${escapeHtml(note)} ${retry}</p>`;
		case 'gone':
			return `<p class="note" role="status"><strong>Gone.</strong>${escapeHtml(note)} ${anchor(linkFor('entirely.refresh', []), 'Refresh')}</p>`;
		case 'ready':
			return `<p class="note" role="status"><strong>Out of date.</strong>${escapeHtml(note)} ${retry}</p>`;
		case 'notice':
			return `<p class="note" role="status">${escapeHtml(note)}</p>`;
		case 'empty':
			return '';
	}
}

function page(title: string, body: string): string {
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="UTF-8">',
		`<meta http-equiv="Content-Security-Policy" content="${DETAIL_CSP}">`,
		'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		`<title>${escapeHtml(title)}</title>`,
		`<style>${STYLES}</style>`,
		'</head>',
		'<body>',
		`<main>${body}</main>`,
		'</body>',
		'</html>',
	].join('\n');
}

/**
 * The detail panel's whole page for what the selection service shows.
 *
 * Everything the CLI or a person wrote is escaped here, and the page has
 * no script, so it can only show text and offer the links below. A link
 * runs one of `DETAIL_COMMANDS` with the item's row id. A trail's
 * description and a session's prompt body are not rendered beyond the
 * rows the model carries; the full text is in the generated document.
 */
export function renderDetailHtml(state: ViewerState): string {
	if (state.kind === 'empty') {
		return page('Details', '<h1>Details</h1><p class="note">Nothing is selected.</p>');
	}
	if (state.kind === 'notice') {
		return page('Details', `<h1>Details</h1>${renderNote(state)}`);
	}

	const { model } = state;
	const name = model.heading ?? model.title;
	const asOf = state.kind === 'ready' && state.asOf !== undefined ? `As of ${formatClock(state.asOf)}${state.refreshing ? ', refreshing' : ''}` : undefined;
	const actions: DetailAction[] = [
		...detailActions(model),
		{ label: 'Refresh', command: 'entirely.retryDetail', args: [], description: 'Read this item again' },
		{ label: 'Open as text', command: 'entirely.openDetailInEditor', args: [], description: 'Open this detail as a read-only document' },
	];

	return page(
		model.title,
		[
			`<header><p class="kind">${escapeHtml(KIND_WORDS[model.kind])}</p><h1>${escapeHtml(name)}</h1>`,
			asOf ? `<p class="asof">${escapeHtml(asOf)}</p>` : '',
			'</header>',
			renderActions(actions),
			renderNote(state),
			renderRows(model.rows),
		]
			.filter(part => part.length > 0)
			.join('\n'),
	);
}

