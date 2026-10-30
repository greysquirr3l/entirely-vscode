import {
	lineState,
	UNATTRIBUTED_LABEL,
	UNSYNCED_LABEL,
	type WhyAnswer,
	type WhyLine,
	type WhySummary,
} from '../lib/entire';

/**
 * Escapes text for HTML.
 *
 * Every piece of text in the panel comes from a repository or from a
 * prompt, so none of it is trusted to be well formed.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** The words used for each kind of attribution. */
const ATTRIBUTION_WORDS: Record<WhyLine['attribution'], string> = {
	commit: 'A commit',
	checkpoint: 'A checkpoint',
	uncommitted: 'Not yet committed',
};

/** The colour each kind of attribution is drawn in. */
const ATTRIBUTION_COLOURS: Record<WhyLine['attribution'], string> = {
	commit: 'var(--vscode-gitDecoration-modifiedResourceForeground, #4ec9b0)',
	checkpoint: 'var(--vscode-charts-purple, #b180d7)',
	uncommitted: 'var(--vscode-descriptionForeground, #999999)',
};

/**
 * The words for a line.
 *
 * A line with no recorded change and a line whose recorded change has not
 * synced read differently here, in the single-line answer and in the
 * table of a whole file alike.
 */
function wordsFor(line: WhyLine): string {
	switch (lineState(line)) {
		case 'unattributed':
			return UNATTRIBUTED_LABEL;
		case 'unsynced':
			return UNSYNCED_LABEL;
		case 'attributed':
			return ATTRIBUTION_WORDS[line.attribution];
	}
}

/** A row of facts about a line. */
function fact(label: string, value: string | undefined): string {
	if (!value) {
		return '';
	}

	return `<div class="fact"><span class="fact-label">${escapeHtml(label)}</span><span class="fact-value">${escapeHtml(
		value,
	)}</span></div>`;
}

/** The candidates that could own a line. */
function candidatesFor(line: WhyLine): string {
	if (line.candidates.length === 0) {
		return '';
	}

	const items = line.candidates
		.map(candidate => {
			const parts = [candidate.agent, candidate.prompt].filter(
				(part): part is string => typeof part === 'string' && part.length > 0,
			);

			return `<li><span class="candidate-id">${escapeHtml(candidate.checkpointId)}</span>${
				parts.length > 0 ? `<span class="candidate-detail">${escapeHtml(parts.join(' — '))}</span>` : ''
			}</li>`;
		})
		.join('');

	return `<h3>Candidates</h3><p class="muted">More than one checkpoint could own this line.</p><ul class="candidates">${items}</ul>`;
}

/** The explanation of one line. */
function renderLine(line: WhyLine): string {
	const attributed = lineState(line) !== 'unattributed';

	const facts = [
		fact('Author', line.author),
		fact('When', line.authorTime),
		fact('Commit', line.shortCommitSha),
		fact('Checkpoint', line.checkpointId),
		fact('Session', line.sessionId),
		fact('Agent', line.agent),
	].join('');

	const factsBlock = facts.length > 0 ? `<div class="facts">${facts}</div>` : '';

	const prompt =
		line.prompt && line.prompt.length > 0
			? `<h3>What the agent was asked to do</h3><blockquote class="prompt">${escapeHtml(line.prompt)}</blockquote>`
			: '';

	const missing =
		line.metadataMissing
			? `<p class="muted">The checkpoint's own record is not available here${
					line.metadataMissingReason ? `: ${escapeHtml(line.metadataMissingReason)}` : '.'
				}</p>`
			: '';

	const drillDown =
		line.checkpointId && line.checkpointId.length > 0
			? `<p><a class="button" href="command:entirely.explainCheckpoint?${encodeURIComponent(
					JSON.stringify([line.checkpointId]),
				)}">Explain this checkpoint</a></p>`
			: '';

	const content =
		line.content && line.content.length > 0
			? `<pre class="code"><span class="line-number">${line.lineNumber}</span>${escapeHtml(
					line.content,
				)}</pre>`
			: '';

	if (!attributed) {
		return `
			<div class="verdict unattributed">
				<strong>${escapeHtml(UNATTRIBUTED_LABEL)}.</strong>
				<span>Entire has no recorded change that accounts for this line.</span>
			</div>
			${content}
			${factsBlock}`;
	}

	return `
		<div class="verdict">
			<span class="dot" style="background:${ATTRIBUTION_COLOURS[line.attribution]}"></span>
			<strong>${escapeHtml(wordsFor(line))}</strong>
		</div>
		${content}
		${factsBlock}
		${prompt}
		${missing}
		${candidatesFor(line)}
		${drillDown}`;
}

/** The distribution of a whole file. */
function renderSummary(summary: WhySummary): string {
	const total = Math.max(summary.totalLines, 1);
	const checkpointWidth = (summary.checkpointLines / total) * 100;
	const commitWidth = (summary.commitLines / total) * 100;
	const uncommittedWidth = (summary.uncommittedLines / total) * 100;

	return `
		<h3>Distribution</h3>
		<div class="bar" role="img" aria-label="${summary.checkpointLines} checkpoint, ${summary.commitLines} commit, ${summary.uncommittedLines} uncommitted">
			<span class="bar-checkpoint" style="width:${checkpointWidth}%"></span>
			<span class="bar-commit" style="width:${commitWidth}%"></span>
			<span class="bar-uncommitted" style="width:${uncommittedWidth}%"></span>
		</div>
		<div class="legend">
			<span><i class="dot" style="background:${ATTRIBUTION_COLOURS.checkpoint}"></i>${summary.checkpointLines} checkpoint (${summary.checkpointPercentage}%)</span>
			<span><i class="dot" style="background:${ATTRIBUTION_COLOURS.commit}"></i>${summary.commitLines} commit (${summary.commitPercentage}%)</span>
			<span><i class="dot" style="background:${ATTRIBUTION_COLOURS.uncommitted}"></i>${summary.uncommittedLines} uncommitted</span>
		</div>`;
}

/** One row of the table of a whole file. */
function renderRow(line: WhyLine): string {
	const facts = [line.agent, line.author, line.shortCommitSha].filter(
		(part): part is string => typeof part === 'string' && part.length > 0,
	);

	return `<tr><td class="number">${line.lineNumber}</td><td class="status">${escapeHtml(
		wordsFor(line),
	)}</td><td class="detail">${escapeHtml(facts.join(' · '))}</td></tr>`;
}

/** The styles the panel is drawn with. */
const STYLES = `
	:root {
		--entire-surface: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
		--entire-border: var(--vscode-panel-border, rgba(128, 128, 128, 0.22));
		--entire-muted: var(--vscode-descriptionForeground, #9d9d9d);
		--entire-checkpoint: var(--vscode-charts-purple, #b180d7);
		--entire-commit: var(--vscode-gitDecoration-modifiedResourceForeground, #4ec9b0);
		--entire-uncommitted: var(--vscode-descriptionForeground, #9d9d9d);
	}

	body {
		font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
		font-size: var(--vscode-font-size, 13px);
		line-height: 1.5;
		color: var(--vscode-foreground, #cccccc);
		padding: 1.25rem 1.75rem 3rem;
		max-width: 60rem;
	}

	h1 {
		font-size: 1.15rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		margin: 0 0 0.35rem;
	}

	h3 {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--entire-muted);
		margin: 1.75rem 0 0.6rem;
	}

	.path {
		font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.85rem;
		color: var(--entire-muted);
		margin: 0 0 1.4rem;
		word-break: break-all;
	}

	.muted {
		color: var(--entire-muted);
		font-size: 0.85rem;
		margin: 0.4rem 0 0;
	}

	.verdict {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.2rem 0.65rem 0.2rem 0.5rem;
		border: 1px solid var(--entire-border);
		border-radius: 999px;
		background: var(--entire-surface);
		font-size: 0.85rem;
		margin: 0 0 1.1rem;
	}

	.verdict.unattributed {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		border-radius: 4px;
		padding: 0.65rem 0.85rem;
		border-left: 3px solid var(--entire-uncommitted);
	}

	.verdict.unattributed strong {
		font-weight: 600;
	}

	.verdict.unattributed span {
		color: var(--entire-muted);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		display: inline-block;
		flex: none;
	}

	.facts {
		display: grid;
		grid-template-columns: minmax(5.5rem, 7rem) minmax(0, 1fr);
		gap: 0.35rem 1.25rem;
		margin: 0;
		padding: 0.9rem 1.1rem;
		border: 1px solid var(--entire-border);
		border-radius: 4px;
		background: var(--entire-surface);
	}

	/* The label and the value are the two grid items, so the wrapper must
	   not take a cell of its own. */
	.fact {
		display: contents;
	}

	.fact-label {
		color: var(--entire-muted);
		font-size: 0.85rem;
	}

	.fact-value {
		font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.code {
		font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.85rem;
		background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
		border: 1px solid var(--entire-border);
		border-radius: 4px;
		padding: 0.7rem 0.9rem;
		margin: 0 0 1.1rem;
		overflow-x: auto;
		white-space: pre;
	}

	.code .line-number {
		color: var(--entire-muted);
		user-select: none;
		display: inline-block;
		min-width: 2.5rem;
		text-align: right;
		padding-right: 1rem;
		border-right: 1px solid var(--entire-border);
		margin-right: 1rem;
	}

	.prompt {
		margin: 0;
		padding: 0.7rem 1rem;
		border-left: 3px solid var(--entire-checkpoint);
		border-radius: 0 4px 4px 0;
		background: var(--entire-surface);
		white-space: pre-wrap;
	}

	.candidates {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--entire-border);
		border-radius: 4px;
		overflow: hidden;
	}

	.candidates li {
		padding: 0.55rem 0.9rem;
		border-bottom: 1px solid var(--entire-border);
	}

	.candidates li:last-child {
		border-bottom: none;
	}

	.candidate-id {
		font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.85rem;
	}

	.candidate-detail {
		color: var(--entire-muted);
		display: block;
		font-size: 0.85rem;
	}

	.bar {
		display: flex;
		height: 0.5rem;
		border-radius: 999px;
		overflow: hidden;
		background: var(--entire-surface);
		border: 1px solid var(--entire-border);
	}

	.bar-checkpoint { background: var(--entire-checkpoint); }
	.bar-commit { background: var(--entire-commit); }
	.bar-uncommitted { background: var(--entire-uncommitted); }

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.25rem;
		font-size: 0.8rem;
		color: var(--entire-muted);
		margin-top: 0.55rem;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	table {
		border-collapse: collapse;
		width: 100%;
		margin-top: 0.9rem;
	}

	td {
		padding: 0.3rem 0.75rem 0.3rem 0;
		border-bottom: 1px solid var(--entire-border);
		vertical-align: top;
	}

	.number {
		color: var(--entire-muted);
		text-align: right;
		width: 3.5rem;
		font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.85rem;
	}

	.status {
		width: 11rem;
	}

	.detail {
		color: var(--entire-muted);
		font-size: 0.85rem;
	}

	.button {
		display: inline-block;
		padding: 0.35rem 0.85rem;
		border: 1px solid transparent;
		border-radius: 3px;
		background: var(--vscode-button-background, #0e639c);
		color: var(--vscode-button-foreground, #ffffff);
		text-decoration: none;
		font-size: 0.85rem;
	}

	.button:hover {
		background: var(--vscode-button-hoverBackground, #1177bb);
	}
`;

/**
 * Renders the answer as the body of a panel.
 *
 * The rendering is a pure function of the answer, so what the panel says
 * can be checked without opening one.
 */
export function renderWhyBody(answer: WhyAnswer): string {
	if (answer.kind === 'line') {
		return `
			<h1>Why does this line exist?</h1>
			<p class="path">${escapeHtml(answer.file)}:${answer.line.lineNumber}</p>
			${renderLine(answer.line)}`;
	}

	const rows = answer.lines.map(renderRow).join('');

	return `
		<h1>Why does this file look like this?</h1>
		<p class="path">${escapeHtml(answer.file)}</p>
		${renderSummary(answer.summary)}
		<table>${rows}</table>`;
}

/** The styles the panel is drawn with. */
export function renderWhyStyles(): string {
	return STYLES;
}
