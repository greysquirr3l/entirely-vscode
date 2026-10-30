import * as vscode from 'vscode';

import { escapeHtml } from './whyView';

/** The view type of the panel. */
const VIEW_TYPE = 'entirely.signIn';

/**
 * The panel that shows a sign-in in progress.
 *
 * The sign-in cannot finish inside the editor: the CLI opens a browser
 * or prints a code, and a person has to act on it. This panel is where
 * the person sees what the CLI said, as it says it, so that the code is
 * on the screen while the command is still waiting.
 */
export class AuthenticationPanel {
	private static panel: vscode.WebviewPanel | undefined;
	private static output = '';
	private static note = '';
	private static detail = '';
	private static state: 'running' | 'done' | 'failed' = 'running';

	/** Opens the panel and says what is being done. */
	static start(note: string): void {
		AuthenticationPanel.note = note;
		AuthenticationPanel.detail = '';
		AuthenticationPanel.output = '';
		AuthenticationPanel.state = 'running';

		const panel = AuthenticationPanel.panelFor();
		panel.reveal(vscode.ViewColumn.Beside, true);
		AuthenticationPanel.render();
	}

	/** Adds what the CLI wrote. */
	static append(text: string): void {
		AuthenticationPanel.output += text;
		AuthenticationPanel.render();
	}

	/** Says that the sign-in finished, and how. */
	static finish(ok: boolean, detail?: string): void {
		AuthenticationPanel.state = ok ? 'done' : 'failed';
		// The note says what to do before the sign-in. Once it is done it
		// would be stale, and once it failed it still helps explain why.
		AuthenticationPanel.detail = ok ? '' : (detail ?? '');
		AuthenticationPanel.render();
	}

	/** Closes the panel. */
	static dispose(): void {
		AuthenticationPanel.panel?.dispose();
		AuthenticationPanel.panel = undefined;
	}

	/** The panel, created the first time it is needed. */
	private static panelFor(): vscode.WebviewPanel {
		if (AuthenticationPanel.panel) {
			return AuthenticationPanel.panel;
		}

		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			'Sign in to Entire',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: false,
				enableCommandUris: true,
				retainContextWhenHidden: false,
			},
		);

		AuthenticationPanel.panel = panel;

		return panel;
	}

	/** Writes the panel's contents. */
	private static render(): void {
		const panel = AuthenticationPanel.panel;

		if (!panel) {
			return;
		}

		panel.webview.html = AuthenticationPanel.document();
	}

	/** The panel's document. */
	private static document(): string {
		const heading =
			AuthenticationPanel.state === 'running'
				? 'Signing in to Entire'
				: AuthenticationPanel.state === 'done'
					? 'Signed in'
					: 'The sign-in did not finish';

		return [
			'<!DOCTYPE html>',
			'<html lang="en">',
			'<head>',
			'<meta charset="UTF-8">',
			'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
			'<title>Sign in to Entire</title>',
			'<style>',
			AuthenticationPanel.styles(),
			'</style>',
			'</head>',
			'<body>',
			`<h1>${escapeHtml(heading)}</h1>`,
			...AuthenticationPanel.paragraphs(),
			'<pre class="output">',
			escapeHtml(AuthenticationPanel.output),
			'</pre>',
			'</body>',
			'</html>',
		].join('\n');
	}

	/** The lines under the heading for the current state. */
	private static paragraphs(): string[] {
		if (AuthenticationPanel.state === 'done') {
			return [];
		}

		return [AuthenticationPanel.note, AuthenticationPanel.detail]
			.filter(line => line.length > 0)
			.map(line => `<p class="note">${escapeHtml(line)}</p>`);
	}

	/** The panel's styling. */
	private static styles(): string {
		return [
			'body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem 1.5rem; }',
			'h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 0.5rem; }',
			'.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; }',
			'.output {',
			'  font-family: var(--vscode-editor-font-family);',
			'  white-space: pre-wrap;',
			'  word-break: break-word;',
			'  background: var(--vscode-textCodeBlock-background);',
			'  border-radius: 3px;',
			'  padding: 0.75rem 1rem;',
			'  margin: 0;',
			'}',
		].join('\n');
	}
}