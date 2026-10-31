import * as vscode from 'vscode';

import type { ControlConfirmation, ProfileScope } from '../lib/entire';
import type { GeneratedDocuments, GeneratedKind } from '../providers/generatedDocuments';
import type { ExpertsUi } from './experts';
import type { ReviewUi } from './review';
import type { TokenProfileUi } from './tokenProfile';

/** The token profile, experts and review questions, asked and shown in the editor. */
export class EditorAnalysisUi implements TokenProfileUi, ExpertsUi, ReviewUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	async show(kind: GeneratedKind, text: string, name?: string): Promise<void> {
		const uri = this.documents.set(kind, text, name);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}

	notify(message: string): void {
		void vscode.window.showInformationMessage(message);
	}

	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return Promise.resolve(
			vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (_progress, token) => {
				const controller = new AbortController();
				const listener = token.onCancellationRequested(() => controller.abort());
				return work(controller.signal).finally(() => listener.dispose());
			}),
		);
	}

	async pickScope(limit: number): Promise<ProfileScope | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				{ label: "The CLI's default", description: 'The number of checkpoints the CLI chooses', scope: { kind: 'default' } as ProfileScope },
				{ label: `The latest ${limit} checkpoints`, description: 'From the setting entirely.tokenProfileCheckpoints', scope: { kind: 'limit', count: limit } as ProfileScope },
				{ label: 'All checkpoints', description: 'Every committed checkpoint; slower on a long history', scope: { kind: 'all' } as ProfileScope },
			],
			{ title: 'Token profile: how much history?', ignoreFocusOut: true },
		);
		return picked?.scope;
	}

	askQuestion(maxLength: number): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Ask Entire who knows about something',
				prompt: "A question in words, such as who owns token refresh. It is sent to Entire's servers, which answer from the provenance they hold for this repository.",
				ignoreFocusOut: true,
				validateInput: value => (value.length > maxLength ? `At most ${maxLength} characters.` : undefined),
			}),
		);
	}

	askPath(): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Who has touched this path?',
				prompt: "A file or folder in this workspace. The path is sent to Entire's servers, which answer from the provenance they hold for this repository.",
				ignoreFocusOut: true,
			}),
		);
	}

	async confirm(prompt: ControlConfirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, prompt.action);
		return choice === prompt.action;
	}

	async pickProfile(names: readonly string[]): Promise<string | undefined> {
		const picked = await vscode.window.showQuickPick(
			names.map(label => ({ label })),
			{ title: 'Review: which profile?', placeHolder: 'The CLI lists the profiles configured for this repository', ignoreFocusOut: true },
		);
		return picked?.label;
	}

	async pickTarget(branches: readonly string[], current: string | undefined): Promise<{ readonly target?: string } | undefined> {
		const picked = await vscode.window.showQuickPick(
			[
				{ label: current ? `Current branch (${current})` : 'Current branch', target: undefined as string | undefined },
				...branches.map(label => ({ label, description: 'Checked out in a worktree and reviewed there', target: label as string | undefined })),
			],
			{ title: 'Review: which branch?', ignoreFocusOut: true },
		);
		return picked ? { target: picked.target } : undefined;
	}

	askPrompt(maxLength: number): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: 'Review: one-off instructions',
				prompt: 'Optional. Extra instructions for this run only. Leave empty for none.',
				ignoreFocusOut: true,
				validateInput: value => (value.length > maxLength ? `At most ${maxLength} characters.` : undefined),
			}),
		);
	}

	async offer(message: string, action: string): Promise<boolean> {
		return (await vscode.window.showInformationMessage(message, action)) === action;
	}
}
