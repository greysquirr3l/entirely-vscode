import {
	DELETE_WANTS,
	GRANT_WANTS,
	REPO_CREATE_WANTS,
	REPO_EDIT_WANTS,
	REPO_LIST_WANTS,
	LIST_WANTS,
	createRepositoryArguments,
	decodeAccessGrants,
	decodeControlClusters,
	decodeControlRepositories,
	decodeOrganisations,
	decodeProjects,
	deleteArguments,
	describeFlag,
	editVisibilityArguments,
	failureDetail,
	grantAddArguments,
	grantIsFor,
	grantListArguments,
	grantRemoveArguments,
	isControlOperand,
	isGrantee,
	isRepositoryName,
	listArguments,
	pickFlags,
	readChoices,
	repoListArguments,
	unwrap,
	type AccessGrant,
	type AccountContext,
	type ControlAction,
	type ControlCluster,
	type ControlOutcome,
	type ControlRepository,
	type DecodeResult,
	type FlagWant,
	type GrantScope,
	type Organisation,
	type Project,
	type ProjectRef,
	shownTarget,
} from '../lib/entire';
import type { CliCommandUsage, CliResult, CliRunner } from './cli';

/** A listing, or the reason it could not be read. */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** Which set of values a picker needs from the CLI's help. */
export type ChoiceRequest =
	| { readonly kind: 'role'; readonly scope: GrantScope }
	| { readonly kind: 'visibility' };

/** Where the control plane is read and changed. */
export interface ControlPlaneSource {
	organisations(): Promise<Read<readonly Organisation[]>>;
	projects(): Promise<Read<readonly Project[]>>;
	/** The project is found by its id; its name is only what the rows are labelled with. */
	repositories(project: ProjectRef): Promise<Read<readonly ControlRepository[]>>;
	/** `target` is what the CLI is handed; `label` is what the object is called, for a failure message. */
	grants(scope: GrantScope, target: string, label?: string): Promise<Read<readonly AccessGrant[]>>;
	clusters(): Promise<Read<readonly ControlCluster[]>>;
	/** The values the CLI's help says a flag takes, read now. */
	choices(request: ChoiceRequest): Promise<Read<readonly string[]>>;
	/** Makes one change as the named login, then reads the result back. */
	perform(action: ControlAction, acting: AccountContext): Promise<ControlOutcome>;
}

export interface ControlPlaneOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, each CLI call may take. */
	readonly timeoutSeconds: () => number;
	/** The login reads act as. A change always names its own. */
	readonly context: () => string | undefined;
}

type Verdict = { readonly kind: 'confirmed' } | { readonly kind: 'contradicted'; readonly detail: string } | { readonly kind: 'unreadable'; readonly detail: string };

type Prepared =
	| { readonly ok: true; readonly args: readonly string[]; readonly cascadeAvailable: boolean }
	| { readonly ok: false; readonly detail: string };

const NOT_INSTALLED = 'the Entire CLI is not installed; install it to manage repositories, projects and organisations';

/**
 * Reads and changes the control plane through the Entire CLI.
 *
 * Every command's flags are read from `agent-help` for that call and never
 * kept, and a flag the help does not describe stops the call instead of
 * being guessed. A change runs as the login it was confirmed as, passed to
 * that one command, and is then checked against a fresh listing: the
 * result is what the CLI reports now, not what the exit status implied.
 */
export class ControlPlaneService implements ControlPlaneSource {
	constructor(private readonly options: ControlPlaneOptions) {}

	organisations(): Promise<Read<readonly Organisation[]>> {
		return this.list('org list', LIST_WANTS, flags => listArguments('org', flags.json), decodeOrganisations);
	}

	projects(): Promise<Read<readonly Project[]>> {
		return this.list('project list', LIST_WANTS, flags => listArguments('project', flags.json), decodeProjects);
	}

	async repositories(project: ProjectRef): Promise<Read<readonly ControlRepository[]>> {
		if (!isControlOperand(project.id)) {
			return { ok: false, detail: 'that project cannot be passed to the Entire CLI' };
		}
		const read = await this.list(
			'repo list',
			REPO_LIST_WANTS,
			flags => repoListArguments({ json: flags.json, project: flags.project, all: flags.all }, project.id),
			value => decodeControlRepositories(value, project),
		);
		return read.ok ? read : { ok: false, detail: explainRejectedProject(read.detail, project.name, project.id === project.name) };
	}

	async grants(scope: GrantScope, target: string, label?: string): Promise<Read<readonly AccessGrant[]>> {
		if (!isControlOperand(target)) {
			return { ok: false, detail: 'that name cannot be passed to the Entire CLI' };
		}
		const read = await this.list(`${scope} grant list`, LIST_WANTS, flags => grantListArguments(scope, flags.json, target), decodeAccessGrants);
		if (read.ok || scope !== 'project') {
			return read;
		}
		return { ok: false, detail: explainRejectedProject(read.detail, label ?? target, label === undefined || label === target) };
	}

	clusters(): Promise<Read<readonly ControlCluster[]>> {
		return this.list('cluster list', LIST_WANTS, flags => listArguments('cluster', flags.json), decodeControlClusters);
	}

	async choices(request: ChoiceRequest): Promise<Read<readonly string[]>> {
		const command = request.kind === 'role' ? `${request.scope} grant add` : 'repo edit';
		const wants = request.kind === 'role' ? GRANT_WANTS : REPO_EDIT_WANTS;
		const help = await this.help(command);
		if (!help.ok) {
			return help;
		}
		const picked = pickFlags(command, help.value.raw, help.value.flags, wants as Record<string, FlagWant>);
		if (!picked.ok) {
			return picked;
		}
		const flag = request.kind === 'role' ? picked.flags.role : picked.flags.visibility;
		const values = readChoices(describeFlag(picked.table, flag));
		return values.length > 0
			? { ok: true, value: values }
			: { ok: false, detail: `the help for '${command}' does not list the values its ${request.kind} flag takes` };
	}

	async perform(action: ControlAction, acting: AccountContext): Promise<ControlOutcome> {
		const bound = new ControlPlaneService({ ...this.options, context: () => acting.name });
		return bound.change(action);
	}

	private async change(action: ControlAction): Promise<ControlOutcome> {
		const prepared = await this.prepare(action);
		if (!prepared.ok) {
			return { kind: 'failed', detail: prepared.detail };
		}
		// A revoke can only be confirmed against a direct grant seen before it.
		const held = action.kind === 'revoke' ? await this.directGrantSeen(action) : undefined;

		const result = await this.options.runner.run(prepared.args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: this.options.context(),
			withholdBodies: true,
		});

		if (!result.ok) {
			const detail = explain(result);
			// A cascade delete can outlast the timeout and still finish.
			if (result.reason === 'timeout') {
				const verdict = await this.verify(action, held);
				return verdict.kind === 'confirmed'
					? { kind: 'done', summary: '' }
					: { kind: 'failed', detail: `${detail}; the change is not listed yet, so it may still be running` };
			}
			if (action.kind === 'delete-repository' && !action.cascade && prepared.cascadeAvailable && /mirror/i.test(`${result.stderr}\n${result.stdout}`)) {
				return { kind: 'refused-mirrors', detail };
			}
			return { kind: 'failed', detail };
		}

		const summary = failureDetail('', result.stdout || result.stderr, '');
		const verdict = await this.verify(action, held);
		switch (verdict.kind) {
			case 'confirmed':
				return { kind: 'done', summary };
			case 'contradicted':
				return { kind: 'failed', detail: `the Entire CLI reported success but ${verdict.detail}` };
			case 'unreadable':
				return { kind: 'unconfirmed', summary, detail: verdict.detail };
		}
	}

	private async prepare(action: ControlAction): Promise<Prepared> {
		switch (action.kind) {
			case 'delete-repository':
				return this.prepareDelete('repo', action.path, action.cascade);
			case 'delete-project':
				return this.prepareDelete('project', action.id, false);
			case 'delete-organisation':
				return this.prepareDelete('org', action.name, false);

			case 'create-repository': {
				if (!isRepositoryName(action.name) || !isControlOperand(action.project)) {
					return { ok: false, detail: 'that repository or project name cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo create');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo create', help.value.raw, help.value.flags, REPO_CREATE_WANTS);
				if (!picked.ok || !picked.flags.project) {
					return { ok: false, detail: picked.ok ? 'the project flag is missing' : picked.detail };
				}
				if (action.visibility !== undefined) {
					const known = this.checkChoice(picked.table, picked.flags.visibility, action.visibility, 'visibility', 'repo create');
					if (known) {
						return { ok: false, detail: known };
					}
				}
				return {
					ok: true,
					cascadeAvailable: false,
					// `repo create --project` is described as taking a name, so the name is what it is given.
					args: createRepositoryArguments({ project: picked.flags.project, visibility: picked.flags.visibility }, action.project, action.name, action.visibility),
				};
			}

			case 'set-visibility': {
				if (!isControlOperand(action.path)) {
					return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo edit');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo edit', help.value.raw, help.value.flags, REPO_EDIT_WANTS);
				if (!picked.ok || !picked.flags.visibility) {
					return { ok: false, detail: picked.ok ? 'the visibility flag is missing' : picked.detail };
				}
				const known = this.checkChoice(picked.table, picked.flags.visibility, action.visibility, 'visibility', 'repo edit');
				if (known) {
					return { ok: false, detail: known };
				}
				return { ok: true, cascadeAvailable: false, args: editVisibilityArguments(picked.flags.visibility, action.visibility, action.path) };
			}

			case 'grant': {
				if (!isGrantee(action.grantee) || !isControlOperand(action.target)) {
					return { ok: false, detail: 'that name cannot be passed to the Entire CLI; a grantee looks like github:alice' };
				}
				const command = `${action.scope} grant add`;
				const help = await this.help(command);
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags(command, help.value.raw, help.value.flags, GRANT_WANTS);
				if (!picked.ok || !picked.flags.role) {
					return { ok: false, detail: picked.ok ? 'the role flag is missing' : picked.detail };
				}
				const known = this.checkChoice(picked.table, picked.flags.role, action.role, 'role', command);
				if (known) {
					return { ok: false, detail: known };
				}
				return { ok: true, cascadeAvailable: false, args: grantAddArguments(action.scope, picked.flags.role, action.role, action.target, action.grantee) };
			}

			case 'revoke': {
				if (!isGrantee(action.grantee) || !isControlOperand(action.target)) {
					return { ok: false, detail: 'that name cannot be passed to the Entire CLI; a grantee looks like github:alice' };
				}
				const command = `${action.scope} grant remove`;
				const help = await this.help(command);
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				return { ok: true, cascadeAvailable: false, args: grantRemoveArguments(action.scope, action.target, action.grantee) };
			}
		}
	}

	private async prepareDelete(group: GrantScope, target: string, cascade: boolean): Promise<Prepared> {
		if (!isControlOperand(target)) {
			return { ok: false, detail: 'that name cannot be passed to the Entire CLI' };
		}
		const command = `${group} delete`;
		const help = await this.help(command);
		if (!help.ok) {
			return { ok: false, detail: help.detail };
		}
		const picked = pickFlags(command, help.value.raw, help.value.flags, DELETE_WANTS);
		if (!picked.ok || !picked.flags.skipPrompt) {
			return { ok: false, detail: picked.ok ? 'the flag that skips the CLI\'s prompt is missing' : picked.detail };
		}
		if (cascade && !picked.flags.cascade) {
			return { ok: false, detail: `this version of the Entire CLI does not describe a way to delete mirrors together with the ${group}; update the CLI` };
		}
		return {
			ok: true,
			cascadeAvailable: picked.flags.cascade !== undefined,
			args: deleteArguments(group, picked.flags.skipPrompt, cascade ? picked.flags.cascade : undefined, target),
		};
	}

	/** Why a value cannot be sent for a flag, when the help lists the values and this is not one. */
	private checkChoice(
		table: readonly { readonly name: string; readonly description: string }[],
		flag: string | undefined,
		value: string,
		what: string,
		command: string,
	): string | undefined {
		if (flag === undefined) {
			return `this version of the Entire CLI does not describe a ${what} flag for '${command}'; update the CLI`;
		}
		const values = readChoices(describeFlag(table, flag));
		if (values.length === 0) {
			return `the help for '${command}' does not list the values its ${what} flag takes`;
		}
		return values.includes(value) ? undefined : `'${value}' is not a ${what} the CLI offers (${values.join(', ')})`;
	}

	/** Reads the object back and says whether it matches what was asked for. */
	private async verify(action: ControlAction, heldBefore: boolean | undefined): Promise<Verdict> {
		switch (action.kind) {
			case 'delete-repository': {
				const read = await this.repositories({ id: action.projectId, name: action.project });
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(repository => repository.name === action.name)
					? { kind: 'contradicted', detail: `still lists ${action.path}` }
					: { kind: 'confirmed' };
			}
			case 'create-repository': {
				const read = await this.repositories({ id: action.projectId, name: action.project });
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(repository => repository.name === action.name)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `does not list ${action.name} in ${action.project}` };
			}
			case 'set-visibility': {
				const read = await this.repositories({ id: action.projectId, name: action.project });
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				const now = read.value.find(repository => repository.name === action.name);
				if (!now) {
					return { kind: 'contradicted', detail: `no longer lists ${action.path}` };
				}
				if (now.visibility === undefined) {
					return { kind: 'unreadable', detail: 'the listing does not say what the visibility is' };
				}
				return now.visibility === action.visibility
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `lists ${action.path} as ${now.visibility}` };
			}
			case 'delete-project': {
				const read = await this.projects();
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(project => project.id === action.id)
					? { kind: 'contradicted', detail: `still lists the project ${action.name}` }
					: { kind: 'confirmed' };
			}
			case 'delete-organisation': {
				const read = await this.organisations();
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(organisation => organisation.id === action.id)
					? { kind: 'contradicted', detail: `still lists the organisation ${action.name}` }
					: { kind: 'confirmed' };
			}
			case 'grant': {
				const read = await this.grants(action.scope, action.target, action.label);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				const held = read.value.filter(grant => grantIsFor(grant, action.grantee));
				if (held.length === 0) {
					return { kind: 'contradicted', detail: `does not list ${action.grantee} on ${shownTarget(action)}` };
				}
				return held.some(grant => grant.role === action.role)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `lists ${action.grantee} as ${held[0].role}, not ${action.role}` };
			}
			case 'revoke': {
				if (heldBefore !== true) {
					return {
						kind: 'unreadable',
						detail: `the extension could not confirm the access was removed, because ${action.grantee} was not matched to a direct grant on ${shownTarget(action)} before the request`,
					};
				}
				const read = await this.grants(action.scope, action.target, action.label);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				// An inherited grant stays after a direct one is removed.
				const direct = read.value.filter(grant => grantIsFor(grant, action.grantee) && !/inherit/i.test(grant.source ?? ''));
				return direct.length > 0
					? { kind: 'contradicted', detail: `still lists ${action.grantee} on ${shownTarget(action)}` }
					: { kind: 'confirmed' };
			}
		}
	}

	/** Whether a listing read now holds a direct grant for the person a revoke names. */
	private async directGrantSeen(action: Extract<ControlAction, { kind: 'revoke' }>): Promise<boolean> {
		const read = await this.grants(action.scope, action.target, action.label);
		return read.ok && read.value.some(grant => grantIsFor(grant, action.grantee) && !/inherit/i.test(grant.source ?? ''));
	}

	/** Reads `agent-help` for one command, now. A failed lookup is never kept. */
	private async help(command: string): Promise<Read<CliCommandUsage>> {
		const usage = await this.options.runner.usage(command, {
			cwd: this.options.workspaceRoot(),
			context: this.options.context(),
		});
		if (usage.ok) {
			return { ok: true, value: usage.value };
		}
		if (usage.reason === 'absent') {
			return { ok: false, detail: NOT_INSTALLED };
		}
		if (usage.reason === 'exit-code') {
			return { ok: false, detail: `this version of the Entire CLI has no '${command}' command; update the CLI` };
		}
		return { ok: false, detail: usage.detail };
	}

	private async list<T, K extends string>(
		command: string,
		wants: Readonly<Record<K, FlagWant>>,
		argumentsFor: (flags: Record<K, string>) => readonly string[],
		decode: (value: unknown) => DecodeResult<T>,
	): Promise<Read<T>> {
		const help = await this.help(command);
		if (!help.ok) {
			return help;
		}
		const picked = pickFlags(command, help.value.raw, help.value.flags, wants);
		if (!picked.ok) {
			return picked;
		}
		const flags = picked.flags as Record<K, string>;
		const result = await this.options.runner.runJson(argumentsFor(flags), value => unwrap(decode(value)), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: this.options.context(),
			withholdBodies: true,
		});
		return result.ok ? { ok: true, value: result.value } : { ok: false, detail: explain(result) };
	}
}

/**
 * What a read of a project says when the CLI could not find it.
 *
 * "invalid project name" alone does not say which project or what to do,
 * so it is named, the CLI's own words are kept, and when the listing gave
 * no id (so the name had to be used instead) that is said too.
 */
export function explainRejectedProject(detail: string, project: string, usedName: boolean): string {
	if (!/invalid project name/i.test(detail)) {
		return detail;
	}
	return (
		`the Entire CLI did not accept the project ${project}` +
		(usedName ? ' (its listing gave no id, so the name was sent instead)' : '') +
		`; refresh the Control Plane view to read it again (the CLI said: ${detail})`
	);
}

/** The words a failed call is reported in. */
export function explain(result: CliResult): string {
	if (result.ok) {
		return '';
	}
	if (result.reason === 'absent') {
		return NOT_INSTALLED;
	}
	if (result.reason !== 'exit-code') {
		return result.detail;
	}
	// The CLI announces the login it acts as on stderr before anything else.
	const withoutAnnouncement = (text: string): string =>
		text
			.split('\n')
			.filter(line => !/^Using context\b/.test(line))
			.join('\n');
	return failureDetail(withoutAnnouncement(result.stderr), withoutAnnouncement(result.stdout), result.detail);
}
