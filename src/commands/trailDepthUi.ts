import * as vscode from 'vscode';

import { describePick, describePickDetail, discussionLabel, findingLabel, describeDiscussion, describeFinding, type DepthConfirmation, type DiscussionMessage, type Trail, type TrailComment, type TrailFinding, type TrailPick } from '../lib/entire';
import { truncatePrompt } from '../lib/entire/text';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { TrailDepthUi } from './trailDepth';
import { unsavedFiles } from './unsavedWork';

async function pickOne<T>(items: readonly (vscode.QuickPickItem & { value: T })[], title: string): Promise<T | undefined> {
	const picked = await vscode.window.showQuickPick([...items], { title, ignoreFocusOut: true });
	return picked?.value;
}

/** The trail depth questions, asked and answered in the editor. */
export class EditorTrailDepthUi implements TrailDepthUi {
	constructor(private readonly documents: GeneratedDocuments) {}

	pickTrail(trails: readonly Trail[]): Promise<Trail | undefined> {
		return pickOne(
			trails.map(trail => ({ label: `#${trail.number} ${trail.title ?? 'Untitled trail'}`, description: trail.status, value: trail })),
			'Which trail?',
		);
	}

	pickChange(picks: readonly TrailPick[]): Promise<TrailPick | undefined> {
		return pickOne(
			picks.map(pick => ({ label: describePick(pick), description: describePickDetail(pick), value: pick })),
			'Which change?',
		);
	}

	pickDiscussion(discussions: readonly TrailComment[]): Promise<TrailComment | undefined> {
		return pickOne(
			discussions.map(discussion => ({ label: discussionLabel(discussion), description: describeDiscussion(discussion), value: discussion })),
			'Which discussion?',
		);
	}

	pickMessage(messages: readonly DiscussionMessage[]): Promise<DiscussionMessage | undefined> {
		return pickOne(
			messages.map(message => ({
				label: truncatePrompt(message.body ?? '(no text)', 80),
				description: [message.author, message.createdAt].filter(part => part !== undefined).join(' · '),
				value: message,
			})),
			'Which message?',
		);
	}

	pickFinding(findings: readonly TrailFinding[]): Promise<TrailFinding | undefined> {
		return pickOne(
			findings.map(finding => ({ label: findingLabel(finding), description: describeFinding(finding), value: finding })),
			'Which finding?',
		);
	}

	input(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly placeHolder?: string;
		readonly validate?: (value: string) => string | undefined;
	}): Promise<string | undefined> {
		return Promise.resolve(
			vscode.window.showInputBox({
				title: options.title,
				prompt: options.prompt,
				value: options.value,
				placeHolder: options.placeHolder,
				ignoreFocusOut: true,
				validateInput: options.validate,
			}),
		);
	}

	choice<T extends string>(
		title: string,
		items: readonly { readonly label: string; readonly description?: string; readonly value: T }[],
	): Promise<T | undefined> {
		return pickOne(items, title);
	}

	async confirm(prompt: DepthConfirmation): Promise<'primary' | 'alternative' | undefined> {
		const buttons = prompt.alternative ? [prompt.action, prompt.alternative] : [prompt.action];
		const choice = await vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, ...buttons);
		return choice === prompt.action ? 'primary' : choice !== undefined && choice === prompt.alternative ? 'alternative' : undefined;
	}

	unsavedFiles(): ReturnType<typeof unsavedFiles> {
		return unsavedFiles();
	}

	async show(kind: 'trail-discussion' | 'trail-finding', name: string, text: string): Promise<void> {
		const uri = this.documents.set(kind, text, name);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	// A message with buttons settles only when it is dismissed, so none is awaited.
	notify(level: 'info' | 'warn' | 'error', message: string, copy?: string): void {
		const show =
			level === 'info' ? vscode.window.showInformationMessage : level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showErrorMessage;
		if (copy === undefined) {
			void show(message);
			return;
		}
		void Promise.resolve(show(message, 'Copy Command')).then(choice => {
			if (choice === 'Copy Command') {
				return vscode.env.clipboard.writeText(copy);
			}
			return undefined;
		});
	}

	withProgress<T>(title: string, work: () => Promise<T>): Promise<T> {
		return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => work()));
	}
}

