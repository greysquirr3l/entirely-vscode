import {
	boundOutput,
	checkTextPath,
	defaultOutputName,
	describeBound,
	describeNoCli,
	isHookName,
	renderDepthDocument,
	type ControlConfirmation,
	type DepthDocumentKind,
	type DoctorSubcommandCheck,
	type KeepEnd,
	type PathFacts,
	type TraceRequest,
} from '../lib/entire';
import type { DepthRead, DoctorDepthService } from '../services/doctorDepth';
import type { SaveResult } from '../services/bundleFile';
import { INSTALL_COMMAND, INSTALL_DOCS } from '../services/onboarding';

/** Which hook traces the person asked for. */
export type TraceMode = 'latest' | 'last' | 'summary' | 'slow';

/** A document that opens read-only, with Copy, and Save when it was cut. */
export interface OutputDocument {
	readonly kind: DepthDocumentKind;
	/** The text as shown, banner included, so Copy copies what is on screen. */
	readonly text: string;
	/** Writes the whole output to a chosen file. Present only when the shown text was cut. */
	readonly saveWhole?: () => Promise<void>;
}

/** The questions and answers of the doctor's log, trace, bundle and migration commands. */
export interface DoctorDepthUi {
	/** Shows a message. Resolves to the action chosen, once the message is answered or dismissed. */
	notify(level: 'info' | 'warn', message: string, actions?: readonly string[]): Promise<string | undefined>;
	/** True only when the person chose to go ahead. */
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
	pickTraceMode(modes: readonly TraceMode[]): Promise<TraceMode | undefined>;
	ask(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly validate: (value: string) => string | undefined;
	}): Promise<string | undefined>;
	/** A save dialog. `extensions` are without the dot. */
	chooseSavePath(options: { readonly title: string; readonly defaultName: string; readonly extensions: readonly string[] }): Promise<string | undefined>;
	showOutput(document: OutputDocument): Promise<void>;
	reveal(file: string): Promise<void>;
	copyText(text: string): Promise<void>;
	openUrl(url: string): Promise<void>;
	openFile(file: string): Promise<void>;
}

/** What the flows need to look at and write files the person chose. */
export interface DepthFiles {
	inspect(file: string): Promise<PathFacts>;
	saveText(file: string, text: string): Promise<SaveResult>;
}

/** The settings the flows read, each time they run. */
export interface DepthSettings {
	readonly traceCount: number;
	readonly traceCountMin: number;
	readonly traceCountMax: number;
	readonly outputMaxBytes: number;
}

export interface DoctorDepthDependencies {
	readonly service: DoctorDepthService;
	readonly files: DepthFiles;
	readonly ui: DoctorDepthUi;
	readonly settings: () => DepthSettings;
	/** The CLI's own settings file, when one exists in the workspace. */
	readonly cliSettingsFile: () => string | undefined;
	readonly now?: () => Date;
	/** True while any doctor flow is running, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

export type DepthResult = 'shown' | 'empty' | 'cancelled' | 'busy' | 'unavailable' | 'failed';

const sharedRunning = { active: false };

/**
 * A step to run once the flow is no longer holding the "running" flag.
 *
 * A message with buttons settles only when it is answered or dismissed, and
 * a flow that waited for that would refuse every other doctor command until
 * the person clicked the message away.
 */
export type Later = (step: () => Promise<unknown>) => void;

/** Runs a flow unless one is already running, then runs the steps it deferred. */
export async function whileIdle<T>(
	running: { active: boolean } | undefined,
	ui: Pick<DoctorDepthUi, 'notify'>,
	busy: T,
	work: (later: Later) => Promise<T>,
): Promise<T> {
	const flag = running ?? sharedRunning;
	if (flag.active) {
		void ui.notify('warn', 'Another doctor command is still running. Wait for it to finish, or cancel it.');
		return busy;
	}
	flag.active = true;
	const steps: (() => Promise<unknown>)[] = [];
	let result: T;
	try {
		result = await work(step => void steps.push(step));
	} finally {
		flag.active = false;
	}
	for (const step of steps) {
		await step();
	}
	return result;
}

/** Says why a subcommand cannot be used. Nothing is run. */
export async function reportUnavailable(
	ui: Pick<DoctorDepthUi, 'notify' | 'openUrl'>,
	check: Exclude<DoctorSubcommandCheck<unknown>, { ok: true }>,
): Promise<void> {
	switch (check.reason) {
		case 'no-cli': {
			const action = 'Open Install Instructions';
			const choice = await ui.notify('warn', `${describeNoCli(INSTALL_COMMAND)}`, [action]);
			if (choice === action) {
				await ui.openUrl(INSTALL_DOCS);
			}
			return;
		}
		case 'unsupported': {
			const action = 'Open Update Instructions';
			const choice = await ui.notify('warn', check.detail, [action]);
			if (choice === action) {
				await ui.openUrl(INSTALL_DOCS);
			}
			return;
		}
		case 'unavailable':
		case 'failed':
			await ui.notify('warn', `${check.detail}.`);
			return;
	}
}

/** What a flow needs to open a bounded document. */
export interface OutputContext {
	readonly ui: DoctorDepthUi;
	readonly files: DepthFiles;
	readonly settings: () => DepthSettings;
	readonly now?: () => Date;
}

/**
 * Opens an output in a read-only document, cut to the size cap.
 *
 * A log keeps its newest lines and a trace its first. When something was cut, the
 * document starts with a banner that says how much, and the whole output can be
 * saved to a file. The full text is held only by the closure given to the UI.
 */
export async function presentOutput(context: OutputContext, kind: DepthDocumentKind, text: string, readerTruncated: boolean): Promise<void> {
	const keep: KeepEnd = kind === 'log' ? 'last' : 'first';
	const bound = boundOutput(text, context.settings().outputMaxBytes, keep);
	const banner = describeBound(bound, keep, readerTruncated);
	await context.ui.showOutput({
		kind,
		text: renderDepthDocument(kind, bound.shown, banner),
		saveWhole: banner ? () => saveWholeOutput(context, kind, text).then(() => undefined) : undefined,
	});
}

export type SaveWholeResult = 'saved' | 'cancelled' | 'refused' | 'failed';

/**
 * Writes the whole of an output to a file the person chooses.
 *
 * The same path checks as the bundle apply, a replaced file is named and
 * confirmed, and the file is written through a temporary file. It is not
 * opened.
 */
export async function saveWholeOutput(context: OutputContext, kind: DepthDocumentKind, text: string): Promise<SaveWholeResult> {
	const { ui, files } = context;
	const file = await ui.chooseSavePath({
		title: 'Save the whole output',
		defaultName: defaultOutputName(kind, (context.now ?? (() => new Date()))()),
		extensions: ['txt', 'log'],
	});
	if (file === undefined) {
		return 'cancelled';
	}
	const check = checkTextPath(file, await files.inspect(file));
	if (!check.ok) {
		void ui.notify('warn', `The output was not saved: ${check.reason}.`);
		return 'refused';
	}
	if (check.overwrites || check.insideWorkspace) {
		const detail = [
			...(check.overwrites ? ['Its current contents will be lost.'] : []),
			...(check.insideWorkspace ? ['This folder is inside the workspace, so git may offer to commit the file.'] : []),
		].join('\n\n');
		const agreed = await ui.confirm({
			message: check.overwrites ? `Replace ${file}?` : `Save the output to ${file}?`,
			detail,
			action: check.overwrites ? 'Replace' : 'Save',
		});
		if (!agreed) {
			return 'cancelled';
		}
	}
	const saved = await files.saveText(file, text);
	if (!saved.ok) {
		void ui.notify('warn', `The output was not saved: ${saved.detail}.`);
		return 'failed';
	}
	void ui.notify('info', `Saved the whole output to ${file}.`, ['Reveal in File Explorer', 'Copy Path']).then(choice => {
		if (choice === 'Reveal in File Explorer') {
			return ui.reveal(file);
		}
		return choice === 'Copy Path' ? ui.copyText(file) : undefined;
	});
	return 'saved';
}

/** Shows what a read came to. Text is bounded and opened. */
async function present(
	deps: DoctorDepthDependencies,
	kind: 'log' | 'trace',
	read: DepthRead,
	later: Later,
): Promise<DepthResult> {
	switch (read.kind) {
		case 'cancelled':
			void deps.ui.notify('info', `The ${kind === 'log' ? 'log' : 'trace'} read was cancelled.`);
			return 'cancelled';
		case 'failed':
			void deps.ui.notify('warn', `The ${kind === 'log' ? 'CLI log' : 'hook traces'} could not be read: ${read.detail}.`);
			return 'failed';
		case 'empty':
			if (kind === 'log') {
				void deps.ui.notify('info', 'The log has no lines yet.');
				return 'empty';
			}
			later(() => explainEmptyTraces(deps));
			return 'empty';
		case 'text':
			await presentOutput(deps, kind, read.text, read.truncated);
			return 'shown';
	}
}

async function explainEmptyTraces(deps: DoctorDepthDependencies): Promise<void> {
	const settingsFile = deps.cliSettingsFile();
	const action = 'Open the CLI Settings File';
	const choice = await deps.ui.notify(
		'info',
		'There are no hook traces. The CLI traces only hooks that take 1.5 s or longer, unless its log level was raised (the ENTIRE_LOG_LEVEL environment variable or "log_level" in .entire/settings.json).',
		settingsFile ? [action] : [],
	);
	if (choice === action && settingsFile) {
		await deps.ui.openFile(settingsFile);
	}
}

/** Opens the last lines of the CLI's operational log in a read-only document. */
export async function showCliLog(deps: DoctorDepthDependencies): Promise<DepthResult> {
	return whileIdle(deps.running, deps.ui, 'busy', async later => {
		const check = await deps.service.checkLog();
		if (!check.ok) {
			later(() => reportUnavailable(deps.ui, check));
			return 'unavailable';
		}
		const read = await deps.ui.withProgress('Reading the CLI log…', signal => deps.service.readLog(check.flags, signal));
		return present(deps, 'log', read, later);
	});
}

function traceCountError(value: string, min: number, max: number): string | undefined {
	return /^\d{1,4}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max ? undefined : `Enter a whole number from ${min} to ${max}.`;
}

/** Asks which hook traces to show and opens them in a read-only document. */
export async function showHookTraces(deps: DoctorDepthDependencies): Promise<DepthResult> {
	return whileIdle(deps.running, deps.ui, 'busy', async later => {
		const { ui } = deps;
		const check = await deps.service.checkTrace();
		if (!check.ok) {
			later(() => reportUnavailable(ui, check));
			return 'unavailable';
		}
		const { flags } = check;
		const settings = deps.settings();

		const modes: TraceMode[] = ['latest'];
		if (flags.last) {
			modes.push('last');
		}
		if (flags.summary) {
			modes.push('summary');
		}
		if (flags.slow && flags.last) {
			modes.push('slow');
		}
		const mode = await ui.pickTraceMode(modes);
		if (mode === undefined) {
			return 'cancelled';
		}

		let last: number | undefined;
		if (mode === 'last' || mode === 'slow') {
			const answer = await ui.ask({
				title: 'Hook traces: how many',
				prompt: `How many of the most recent traces to read, from ${settings.traceCountMin} to ${settings.traceCountMax}.`,
				value: String(settings.traceCount),
				validate: value => traceCountError(value, settings.traceCountMin, settings.traceCountMax),
			});
			if (answer === undefined) {
				return 'cancelled';
			}
			last = Number(answer.trim());
		}

		let hook: string | undefined;
		if (flags.hook) {
			const answer = await ui.ask({
				title: 'Hook traces: which hook',
				prompt: 'A hook name such as post-commit. Leave empty for every hook.',
				validate: value => (value.trim().length === 0 || isHookName(value.trim()) ? undefined : 'Use lower-case letters, digits and hyphens, starting with a letter.'),
			});
			if (answer === undefined) {
				return 'cancelled';
			}
			hook = answer.trim().length > 0 ? answer.trim() : undefined;
		}

		const request: TraceRequest = { last, hook, summary: mode === 'summary', slow: mode === 'slow' };
		const read = await ui.withProgress('Reading hook traces…', signal => deps.service.readTraces(flags, request, signal));
		return present(deps, 'trace', read, later);
	});
}
