import * as vscode from 'vscode';

import type { CheckpointDetail, WhyAnswer } from '../lib/entire';
import { escapeHtml, renderWhyBody, renderWhyStyles } from './whyView';

/** The view type of the panel. */
const VIEW_TYPE = 'entirely.why';

/**
 * The panel that shows the explanation.
 *
 * There is one panel, reused for every question, so asking about another
 * line replaces the answer rather than filling the editor with tabs.
 */
export class WhyPanel {
	private static panel: vscode.WebviewPanel | undefined;

	/** Shows the explanation of a line or a file. */
	static show(answer: WhyAnswer): void {
		const panel = WhyPanel.panelFor('Why does this line exist?');
		panel.webview.html = WhyPanel.document(
			panel.webview,
			'Why does this line exist?',
			renderWhyBody(answer),
		);
		panel.reveal(vscode.ViewColumn.Beside, true);
	}

	/** Shows the story of a checkpoint. */
	static showCheckpoint(detail: CheckpointDetail, prompt?: string): void {
		const panel = WhyPanel.panelFor('Checkpoint');
		panel.webview.html = WhyPanel.document(
			panel.webview,
			'Checkpoint',
			WhyPanel.checkpointBody(detail, prompt),
		);
		panel.reveal(vscode.ViewColumn.Beside, true);
	}

	/** Closes the panel. */
	static dispose(): void {
		WhyPanel.panel?.dispose();
		WhyPanel.panel = undefined;
	}

	/** The panel, created the first time it is needed. */
	private static panelFor(title: string): vscode.WebviewPanel {
		if (WhyPanel.panel) {
			WhyPanel.panel.title = title;
			return WhyPanel.panel;
		}

		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: false,
				enableCommandUris: true,
				retainContextWhenHidden: false,
			},
		);

		panel.onDidDispose(() => {
			WhyPanel.panel = undefined;
		});

		WhyPanel.panel = panel;
		return panel;
	}

	/** Wraps the body in a document with a content security policy. */
	private static document(
		webview: vscode.Webview,
		title: string,
		body: string,
	): string {
		return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"
		/>
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${escapeHtml(title)}</title>
		<style>${renderWhyStyles()}</style>
	</head>
	<body>${body}</body>
</html>`;
	}

	/** Renders a checkpoint's story. */
	private static checkpointBody(detail: CheckpointDetail, prompt?: string): string {
		const files = detail.filesTouched
			.map(file => `<li>${escapeHtml(file)}</li>`)
			.join('');

		const sessions = detail.sessions
			.map(
				session =>
					`<li><span class="fact-value">${escapeHtml(session.sessionId ?? 'unknown session')}</span>${
						session.agent ? `<span class="candidate-detail">${escapeHtml(session.agent)}</span>` : ''
					}</li>`,
			)
			.join('');

		return `
			<h1>Checkpoint ${escapeHtml(detail.id)}</h1>
			<p class="path">${escapeHtml(detail.strategy ?? 'checkpoint')}${
				detail.branch ? ` · ${escapeHtml(detail.branch)}` : ''
			}</p>
			${
				prompt && prompt.length > 0
					? `<h3>What the agent was asked to do</h3><blockquote class="prompt">${escapeHtml(prompt)}</blockquote>`
					: ''
			}
			${
				files.length > 0
					? `<h3>Files it touched</h3><ul class="candidates">${files}</ul>`
					: ''
			}
			${
				sessions.length > 0
					? `<h3>Sessions</h3><ul class="candidates">${sessions}</ul>`
					: ''
			}
			${
				detail.partial
					? `<p class="muted">Some of this checkpoint could not be read${
							detail.tasksError ? `: ${escapeHtml(detail.tasksError)}` : '.'
						}</p>`
					: ''
			}`;
	}
}
