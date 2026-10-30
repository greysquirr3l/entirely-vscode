import * as vscode from 'vscode';

import { escapeMarkdown, type BlameMark, type LineState } from '../lib/entire';

/** The command the hover offers for the full answer about a line. */
const WHY_COMMAND = 'entirely.whyThisLine';

/** The theme colour each state is drawn in. */
const STATE_COLOURS: Record<LineState, string> = {
	attributed: 'charts.purple',
	unsynced: 'charts.orange',
	unattributed: 'descriptionForeground',
};

/**
 * Draws a blamed file's attribution in the editor.
 *
 * Each state has its own decoration type, so the three read differently
 * at a glance: a purple bar for a recorded change, orange for a recorded
 * change that has not synced, grey for a line with no recorded change.
 *
 * Marks describe the text as it was when the CLI was asked. They are
 * dropped the moment that text changes, because after an edit the line
 * numbers no longer match, and a stale mark would be a wrong answer.
 */
export class BlameDecorations implements vscode.Disposable {
	private readonly types: Record<LineState, vscode.TextEditorDecorationType>;
	private readonly listeners: vscode.Disposable[] = [];
	private readonly drawn = new Set<string>();

	constructor() {
		this.types = {
			attributed: this.typeFor('attributed'),
			unsynced: this.typeFor('unsynced'),
			unattributed: this.typeFor('unattributed'),
		};

		this.listeners.push(
			vscode.workspace.onDidChangeTextDocument(event => {
				if (event.contentChanges.length > 0) {
					this.clearDocument(event.document);
				}
			}),
			vscode.workspace.onDidCloseTextDocument(document => {
				this.drawn.delete(document.uri.toString());
			}),
		);
	}

	/** Draws the marks on an editor, replacing any earlier ones. */
	apply(editor: vscode.TextEditor, marks: readonly BlameMark[]): void {
		const options: Record<LineState, vscode.DecorationOptions[]> = {
			attributed: [],
			unsynced: [],
			unattributed: [],
		};

		for (const mark of marks) {
			if (mark.line >= editor.document.lineCount) {
				continue;
			}

			const end = editor.document.lineAt(mark.line).range.end;
			options[mark.state].push({
				range: new vscode.Range(end, end),
				hoverMessage: this.hover(mark),
				renderOptions: { after: { contentText: mark.label } },
			});
		}

		for (const state of Object.keys(options) as LineState[]) {
			editor.setDecorations(this.types[state], options[state]);
		}
		this.drawn.add(editor.document.uri.toString());
	}

	/** Whether a document has marks drawn on it. */
	has(document: vscode.TextDocument): boolean {
		return this.drawn.has(document.uri.toString());
	}

	/** Removes the marks from every editor showing a document. */
	clearDocument(document: vscode.TextDocument): void {
		if (!this.drawn.delete(document.uri.toString())) {
			return;
		}
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document === document) {
				this.clearEditor(editor);
			}
		}
	}

	/** Removes the marks from one editor. */
	clearEditor(editor: vscode.TextEditor): void {
		for (const type of Object.values(this.types)) {
			editor.setDecorations(type, []);
		}
		this.drawn.delete(editor.document.uri.toString());
	}

	dispose(): void {
		for (const listener of this.listeners) {
			listener.dispose();
		}
		for (const type of Object.values(this.types)) {
			type.dispose();
		}
		this.drawn.clear();
	}

	private typeFor(state: LineState): vscode.TextEditorDecorationType {
		const colour = new vscode.ThemeColor(STATE_COLOURS[state]);
		return vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			overviewRulerColor: colour,
			overviewRulerLane: vscode.OverviewRulerLane.Left,
			borderStyle: 'solid',
			borderWidth: '0 0 0 2px',
			borderColor: colour,
			after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2em' },
		});
	}

	/** Every value in the hover came from a repository, so all of it is escaped. */
	private hover(mark: BlameMark): vscode.MarkdownString {
		const link = `command:${WHY_COMMAND}?${encodeURIComponent(JSON.stringify([mark.lineNumber]))}`;
		const text = new vscode.MarkdownString(
			`${mark.facts.map(fact => escapeMarkdown(fact)).join('\n\n')}\n\n[Why does this line exist?](${link})`,
		);
		text.isTrusted = { enabledCommands: [WHY_COMMAND] };
		return text;
	}
}
