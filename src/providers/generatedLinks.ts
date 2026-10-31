import * as vscode from 'vscode';

import { findCheckpointLinks } from '../lib/entire';
import { GENERATED_SCHEME } from './generatedDocuments';

/**
 * Makes the checkpoint ids in a generated document clickable.
 *
 * The token profile writes each id as a Markdown link to the command that
 * explains the checkpoint. A plain text editor does not follow such links, so
 * this turns exactly those spans into document links. Only that one command
 * with an id the CLI could have issued is recognised; any other `command:`
 * text in a document stays text.
 */
export class GeneratedLinks implements vscode.DocumentLinkProvider {
	provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
		return findCheckpointLinks(document.getText()).map(span => {
			const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
			const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:entirely.explainCheckpoint?${encodeURIComponent(JSON.stringify([span.id]))}`));
			link.tooltip = 'Open this checkpoint';
			return link;
		});
	}
}

/** Registers the provider for the generated-document scheme. */
export function registerGeneratedLinks(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ scheme: GENERATED_SCHEME }, new GeneratedLinks()));
}
