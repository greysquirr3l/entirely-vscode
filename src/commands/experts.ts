import * as path from 'path';

import {
	MAX_EXPERTS_QUESTION,
	UNREADABLE_EXPERTS,
	describeEmptyExperts,
	describeExperts,
	describeNotMirrored,
	workspaceRelative,
	type AccountContext,
	type ExpertsRequest,
} from '../lib/entire';
import type { ExpertsSource } from '../services/experts';
import type { GeneratedViewUi } from './generatedView';

export interface ExpertsUi extends GeneratedViewUi {
	/** Asks a question in words. Returns undefined when cancelled. */
	askQuestion(maxLength: number): Promise<string | undefined>;
	/** Asks for a path inside the workspace when none was chosen. */
	askPath(): Promise<string | undefined>;
}

export interface ExpertsDependencies {
	readonly source: ExpertsSource;
	readonly ui: ExpertsUi;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly workspaceRoot: () => string | undefined;
}

export type ExpertsResult = 'shown' | 'empty' | 'cancelled' | 'failed';

const NO_LOGIN = "No Entire login is available, so Entirely cannot say who Entire's servers would be asked as. Sign in first.";

async function ask(deps: ExpertsDependencies, request: ExpertsRequest): Promise<ExpertsResult> {
	const { ui } = deps;
	const acting = await deps.acting();
	if (!acting) {
		await ui.warn(NO_LOGIN);
		return 'failed';
	}
	const outcome = await ui.withProgress(`Asking Entire's servers (as ${acting.handle})…`, signal => deps.source.ask(request, acting, signal));
	switch (outcome.kind) {
		case 'found':
			await ui.show('experts', describeExperts(outcome.entries, request, outcome.context), 'Who has touched this code');
			return 'shown';
		case 'empty':
			await ui.show('experts', describeEmptyExperts(request, outcome.context), 'Who has touched this code');
			return 'empty';
		case 'unreadable':
			await ui.warn(UNREADABLE_EXPERTS);
			return 'failed';
		case 'notMirrored':
			await ui.warn(describeNotMirrored(outcome.cliText));
			return 'failed';
		case 'cancelled':
			return 'cancelled';
		case 'noCli':
		case 'unsupported':
			await ui.warn(`Experts cannot be asked: ${outcome.detail}.`);
			return 'failed';
		case 'failed':
			await ui.warn(`Entire could not be asked: ${outcome.detail}. It was not asked again.`);
			return 'failed';
	}
}

/** Ranks the agents, skills and tools that have touched a file or folder. `file` is an absolute path. */
export async function expertsForPath(deps: ExpertsDependencies, file?: string): Promise<ExpertsResult> {
	const root = deps.workspaceRoot();
	if (!root) {
		await deps.ui.warn('Open a folder first: Entire answers for the repository of the workspace.');
		return 'failed';
	}
	const chosen = file ?? (await deps.ui.askPath());
	if (chosen === undefined) {
		return 'cancelled';
	}
	const absolute = path.isAbsolute(chosen) ? chosen : path.join(root, chosen);
	const relative = path.resolve(absolute) === path.resolve(root) ? '.' : workspaceRelative(root, absolute);
	if (relative === undefined) {
		await deps.ui.warn('That path is outside the workspace, so Entire cannot be asked about it.');
		return 'failed';
	}
	return ask(deps, { kind: 'scope', scope: relative.split(path.sep).join('/') });
}

/** Sends a question in words to Entire. The question is not logged. */
export async function expertsAsk(deps: ExpertsDependencies): Promise<ExpertsResult> {
	const text = await deps.ui.askQuestion(MAX_EXPERTS_QUESTION);
	if (text === undefined) {
		return 'cancelled';
	}
	const question = text.trim().slice(0, MAX_EXPERTS_QUESTION).trim();
	if (question.length === 0) {
		return 'cancelled';
	}
	return ask(deps, { kind: 'query', text: question });
}

/** Ranks by the files staged in git. */
export async function expertsStaged(deps: ExpertsDependencies): Promise<ExpertsResult> {
	return ask(deps, { kind: 'staged' });
}

/** Opens the last reply as Entire sent it. It is held in memory only and shown only by this command. */
export async function showRawReply(deps: Pick<ExpertsDependencies, 'source' | 'ui'>): Promise<boolean> {
	const reply = deps.source.lastReply();
	if (reply === undefined || reply.length === 0) {
		await deps.ui.warn('There is no experts reply to show yet. Ask first.');
		return false;
	}
	await deps.ui.show('expertsRaw', reply, 'Experts reply (raw)');
	return true;
}
