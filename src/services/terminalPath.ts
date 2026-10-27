import * as vscode from 'vscode';

import {
	pathEntries,
	pathHasDirectory,
	pathSeparator,
	pathWithoutDirectory,
	pathWithDirectory,
	platformSegment,
	terminalEnvSetting,
	terminalPathHasDirectory,
	withPath,
	type PlatformSegment,
	type TerminalEnvironment,
} from '../lib/terminalPath';

/**
 * Where a terminal environment change is written.
 *
 * The editor exposes exactly three targets. `user` is the current
 * profile's user settings, which is the closest thing the API has to a
 * machine-wide scope.
 */
export type RepairScope = 'folder' | 'workspace' | 'user';

/** What the repair will do. */
export type RepairAction = 'add' | 'remove';

/** The result of working out what the repair should write. */
export interface RepairPlan {
	/** The scope the change is written to. */
	readonly scope: RepairScope;
	/** What the change does. */
	readonly action: RepairAction;
	/** The setting that is written. */
	readonly setting: string;
	/** The value that is written. */
	readonly value: TerminalEnvironment;
	/** The directory the CLI was found in. */
	readonly directory: string;
	/** The platform the terminal runs on. */
	readonly segment: PlatformSegment;
}

/** Why the repair cannot be done. */
export type RepairRefusal =
	/** The editor has no terminal environment for this platform. */
	| { readonly kind: 'unsupported-platform' }
	/** There is no workspace to write a workspace-scoped change to. */
	| { readonly kind: 'no-workspace' }
	/** The editor will not accept a change at the scope the user chose. */
	| { readonly kind: 'scope-refused'; readonly scope: RepairScope; readonly detail: string };

/** The outcome of planning or applying the repair. */
export type RepairResult =
	| { readonly kind: 'planned'; readonly plan: RepairPlan }
	| { readonly kind: 'refused'; readonly refusal: RepairRefusal };

/**
 * The scope the editor's configuration API writes to.
 */
function targetFor(scope: RepairScope): vscode.ConfigurationTarget {
	switch (scope) {
		case 'folder':
			return vscode.ConfigurationTarget.WorkspaceFolder;
		case 'workspace':
			return vscode.ConfigurationTarget.Workspace;
		case 'user':
			return vscode.ConfigurationTarget.Global;
	}
}

/**
 * The name of a scope, as it is shown to the user.
 */
export function scopeName(scope: RepairScope): string {
	switch (scope) {
		case 'folder':
			return 'This workspace folder';
		case 'workspace':
			return 'This workspace';
		case 'user':
			return 'Your user settings';
	}
}

/**
 * The explanation of a scope, as it is shown to the user.
 *
 * The user has to know what a scope costs them before they pick one, so
 * the ones that change a file the repository holds say so.
 */
export function scopeDetail(scope: RepairScope): string {
	switch (scope) {
		case 'folder':
			return 'Only this folder, in its own settings file.';
		case 'workspace':
			return 'Every folder in this workspace, in the workspace settings file. That file may be committed.';
		case 'user':
			return 'Every window you open, in your user settings. Nothing in any repository changes.';
	}
}

/**
 * Whether a value is a terminal environment.
 *
 * The editor's setting is an object of variable names and values, where
 * a null value takes a variable away.
 */
function isTerminalEnvironment(value: unknown): value is TerminalEnvironment {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}

	return Object.values(value).every(entry => entry === null || typeof entry === 'string');
}

/**
 * The terminal environment the editor is using right now.
 *
 * The value is read from the editor's configuration, which is where the
 * terminal itself reads it from, so the extension and the terminal always
 * agree about what the PATH is.
 */
export function readTerminalEnv(key: string, resource?: vscode.Uri): TerminalEnvironment {
	const value = vscode.workspace
		.getConfiguration(undefined, resource)
		.get<unknown>(key);

	return isTerminalEnvironment(value) ? value : {};
}

/**
 * The terminal environment stored at one scope.
 *
 * The editor merges the scopes for the value the terminal uses, so the
 * value at a scope is only the part of the environment that scope owns.
 * A change written at a scope replaces that part and leaves the rest
 * alone.
 */
export function readScopeEnv(
	key: string,
	scope: RepairScope,
	resource?: vscode.Uri,
): TerminalEnvironment {
	const inspected = vscode.workspace
		.getConfiguration(undefined, resource)
		.inspect<unknown>(key);

	if (!inspected) {
		return {};
	}

	const value = scope === 'folder'
		? inspected.workspaceFolderValue
		: scope === 'workspace'
			? inspected.workspaceValue
			: inspected.globalValue;

	return isTerminalEnvironment(value) ? value : {};
}

/**
 * Works out what the repair should write.
 *
 * The PATH the terminal has now is what the repair adds to, so nothing
 * the user already has on the PATH is lost. The value written is the one
 * stored at the chosen scope, with the PATH replaced, so the other
 * variables in that scope are kept exactly as they were.
 *
 * A scope that is less specific than the one holding the PATH cannot
 * change what the terminal gets, so the value written there is built
 * from that scope's own PATH instead. Writing the other scope's PATH
 * there would lose what the user keeps in their own settings, and would
 * carry one workspace's PATH into every window they open.
 *
 * The action is decided by what is already there: a directory that is
 * already on the PATH is taken off it, which is how the repair is undone.
 */
export function planRepair(options: {
	readonly directory: string;
	readonly scope: RepairScope;
	readonly platform?: NodeJS.Platform;
	readonly resource?: vscode.Uri;
}): RepairResult {
	const platform = options.platform ?? process.platform;
	const segment = platformSegment(platform);
	if (!segment) {
		return { kind: 'refused', refusal: { kind: 'unsupported-platform' } };
	}

	if (options.scope === 'workspace' && !vscode.workspace.workspaceFolders?.length) {
		return { kind: 'refused', refusal: { kind: 'no-workspace' } };
	}

	if (options.scope === 'folder' && !options.resource) {
		return { kind: 'refused', refusal: { kind: 'no-workspace' } };
	}

	const key = terminalEnvSetting(segment);
	const separator = pathSeparator(platform);
	const effective = readTerminalEnv(key, options.resource);
	const atScope = readScopeEnv(key, options.scope, options.resource);

	const own = typeof atScope.PATH === 'string' ? atScope.PATH : undefined;

	// A more specific scope holding the PATH holds back a change written
	// here, so the value written is built from this scope's own PATH.
	// Writing the other scope's PATH here would lose what the user keeps
	// in their own settings, and would carry one workspace's PATH into
	// every window they open.
	const holder = effectivePathScope(key, options.resource);
	const held = holder !== undefined && scopeRank(options.scope) < scopeRank(holder);
	const base = held
		? own
		: typeof effective.PATH === 'string'
			? effective.PATH
			: undefined;

	// The action is decided by the PATH this scope contributes, so the
	// change is a change to that PATH and not to somebody else's. A scope
	// that is held back has its own PATH, and the directory is taken off
	// that one or put on it.
	const present = base !== undefined
		&& pathEntries(base, separator).includes(options.directory);

	const action: RepairAction = present ? 'remove' : 'add';

	const newPath = action === 'remove'
		? pathWithoutDirectory(base, options.directory, separator)
		: pathWithDirectory(base, options.directory, separator);

	return {
		kind: 'planned',
		plan: {
			scope: options.scope,
			action,
			setting: key,
			value: withPath(atScope, newPath),
			directory: options.directory,
			segment,
		},
	};
}

/**
 * The scopes that keep a terminal environment, in the order the editor
 * takes them.
 *
 * The editor merges the scopes for the value the terminal uses, and the
 * more specific scope wins for the keys it holds. A folder is more
 * specific than a workspace, and a workspace is more specific than the
 * user settings.
 */
const SCOPE_PRECEDENCE: readonly RepairScope[] = ['folder', 'workspace', 'user'];

/**
 * How specific a scope is.
 *
 * A higher number is a more specific scope: a folder beats a workspace,
 * and a workspace beats the user settings.
 */
function scopeRank(scope: RepairScope): number {
	return SCOPE_PRECEDENCE.length - SCOPE_PRECEDENCE.indexOf(scope);
}

/**
 * The scopes that hold a PATH of their own.
 *
 * A scope that holds a PATH is the one the terminal's PATH comes from,
 * unless a more specific scope holds one too.
 */
function pathScopes(key: string, resource?: vscode.Uri): RepairScope[] {
	return SCOPE_PRECEDENCE.filter(scope => {
		const path = readScopeEnv(key, scope, resource).PATH;
		return typeof path === 'string';
	});
}

/**
 * The scope that the terminal's PATH comes from.
 *
 * This is the most specific scope that holds a PATH. A change written at
 * a less specific scope is held back by it, which is worth saying out
 * loud rather than leaving the user with a change that appears to have
 * done nothing.
 */
export function effectivePathScope(key: string, resource?: vscode.Uri): RepairScope | undefined {
	return pathScopes(key, resource)[0];
}

/**
 * Whether the editor's terminal can see a directory.
 *
 * The terminal's PATH is the editor's own terminal environment with the
 * inherited PATH resolved to the PATH this process has, so this answers
 * the question the user actually has: can a terminal run the binary.
 */
export function onTerminalPath(
	directory: string,
	platform: NodeJS.Platform = process.platform,
	resource?: vscode.Uri,
): boolean {
	const segment = platformSegment(platform);
	if (!segment) {
		return false;
	}

	const separator = pathSeparator(platform);
	const env = readTerminalEnv(terminalEnvSetting(segment), resource);

	return terminalPathHasDirectory(env, directory, separator, process.env['PATH']);
}

/**
 * What came of writing the repair.
 */
export type RepairOutcome =
	/** The change was written and the terminal's PATH now says what it should. */
	| { readonly kind: 'applied' }
	/** The change was written, but a more specific scope holds the PATH. */
	| { readonly kind: 'shadowed'; readonly by: RepairScope }
	/** The change was not written. */
	| { readonly kind: 'refused'; readonly refusal: RepairRefusal };

/**
 * Writes the repair.
 *
 * The write goes to the scope the user chose and nowhere else. A scope
 * the editor refuses is reported as a refusal rather than being quietly
 * widened to a scope the user did not choose.
 *
 * The result is checked against what the editor now says the terminal's
 * PATH is, because a more specific scope may hold the PATH and hold back
 * the change.
 */
export async function writeRepair(plan: RepairPlan, resource?: vscode.Uri): Promise<RepairOutcome> {
	const configuration = vscode.workspace.getConfiguration(undefined, resource);

	try {
		await configuration.update(plan.setting, plan.value, targetFor(plan.scope));
	} catch (error) {
		return {
			kind: 'refused',
			refusal: {
				kind: 'scope-refused',
				scope: plan.scope,
				detail: error instanceof Error ? error.message : String(error),
			},
		};
	}

	const separator = pathSeparator(process.platform);
	const effective = readTerminalEnv(plan.setting, resource);
	const present = pathHasDirectory(effective, plan.directory, separator);

	if (present === (plan.action === 'add')) {
		return { kind: 'applied' };
	}

	// The change was written, but the terminal's PATH is not what it
	// should be. A more specific scope holds the PATH and holds it back.
	const holder = effectivePathScope(plan.setting, resource);

	return holder !== undefined && holder !== plan.scope
		? { kind: 'shadowed', by: holder }
		: { kind: 'applied' };
}
