import * as vscode from 'vscode';

import { humanizeStatus, isCommitRef, isSessionId, nameSession, type Session } from '../lib/entire';
import type { GitService } from '../services/gitService';
import type { ChosenSession, Confirmation, LifecycleUi } from './sessionLifecycle';

/** How many recent commits the commit picker offers. */
const RECENT_COMMITS = 20;

interface SessionPick extends vscode.QuickPickItem {
	readonly session?: Session;
	readonly other?: true;
}

function sessionPick(session: Session): SessionPick {
	return {
		label: nameSession(session),
		description: humanizeStatus(session.status),
		detail: session.worktreePath,
		session,
	};
}

/** The lifecycle commands' questions, asked in the editor. */
export class EditorLifecycleUi implements LifecycleUi {
	constructor(
		private readonly git: GitService | undefined,
		private readonly workspaceFolder: () => vscode.Uri | undefined,
	) {}

	async confirm(prompt: Confirmation): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			prompt.message,
			{ modal: true, detail: prompt.detail },
			prompt.action,
		);
		return choice === prompt.action;
	}

	async chooseSession(title: string, sessions: readonly Session[]): Promise<Session | undefined> {
		if (sessions.length === 0) {
			await this.inform('There is no session for this to act on.');
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(sessions.map(sessionPick), { title, matchOnDetail: true });
		return picked?.session;
	}

	async chooseSessionOrId(title: string, sessions: readonly Session[]): Promise<ChosenSession | undefined> {
		const other: SessionPick = {
			label: 'Enter a session id…',
			description: 'for a session the Sessions view does not list',
			other: true,
		};
		const picked = await vscode.window.showQuickPick([...sessions.map(sessionPick), other], {
			title,
			matchOnDetail: true,
		});
		if (!picked) {
			return undefined;
		}
		if (picked.session) {
			return { id: picked.session.id, session: picked.session };
		}
		const id = await vscode.window.showInputBox({
			title,
			prompt: 'The id of the agent session to attach',
			ignoreFocusOut: true,
			validateInput: value => (isSessionId(value.trim()) ? undefined : 'That is not a session id the CLI can be given.'),
		});
		return id === undefined ? undefined : { id: id.trim() };
	}

	async chooseCommit(): Promise<string | undefined> {
		const head: vscode.QuickPickItem & { ref?: string } = {
			label: 'HEAD',
			description: 'the last commit (default)',
			ref: 'HEAD',
		};
		const other: vscode.QuickPickItem & { ref?: string } = { label: 'Enter a commit or ref…' };

		const repository = this.git?.repositoryFor(this.workspaceFolder());
		let recent: (vscode.QuickPickItem & { ref?: string })[] = [];
		if (repository) {
			try {
				recent = (await repository.log({ maxEntries: RECENT_COMMITS })).map(commit => ({
					label: commit.hash.slice(0, 12),
					description: commit.message.split('\n')[0],
					ref: commit.hash,
				}));
			} catch {
				recent = [];
			}
		}

		const picked = await vscode.window.showQuickPick([head, ...recent, other], {
			title: 'Attach to which commit?',
			matchOnDescription: true,
		});
		if (!picked) {
			return undefined;
		}
		if (picked.ref) {
			return picked.ref;
		}
		const ref = await vscode.window.showInputBox({
			title: 'Attach to which commit?',
			prompt: 'A commit hash, ref or HEAD~n',
			value: 'HEAD',
			ignoreFocusOut: true,
			validateInput: value => (isCommitRef(value.trim()) ? undefined : 'That is not a commit or ref the CLI can be given.'),
		});
		return ref?.trim();
	}

	// A message with no buttons settles only when it is dismissed, so the
	// command is not held open waiting for that.
	inform(message: string): Promise<void> {
		void vscode.window.showInformationMessage(message);
		return Promise.resolve();
	}

	warn(message: string): Promise<void> {
		void vscode.window.showWarningMessage(message);
		return Promise.resolve();
	}
}
