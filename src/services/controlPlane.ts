import * as fs from 'fs';
import * as path from 'path';
import {
	DELETE_WANTS,
	GRANT_WANTS,
	ORG_CREATE_WANTS,
	ORG_GET_WANTS,
	ORG_INVITE_LIST_WANTS,
	ORG_INVITE_REVOKE_WANTS,
	ORG_INVITE_SEND_WANTS,
	PROJECT_CREATE_WANTS,
	PROJECT_GET_WANTS,
	REPO_CLONE_WANTS,
	REPO_MIRROR_DETACH_WANTS,
	REPO_MIRROR_LIST_WANTS,
	REPO_MIRROR_PLACEMENT_WANTS,
	REPO_MIRROR_RESYNC_WANTS,
	REPO_PROTECTION_WANTS,
	REPO_REMOTE_ADD_WANTS,
	REPO_VISIBILITY_WANTS,
	REPO_CREATE_WANTS,
	REPO_EDIT_WANTS,
	REPO_LIST_WANTS,
	LIST_WANTS,
	cloneArguments,
	createRepositoryArguments,
	decodeAccessGrants,
	decodeControlClusters,
	decodeControlRepositories,
	decodeInvitations,
	decodeMirrors,
	decodeOrganisationDetail,
	decodeOrganisations,
	decodeProjectDetail,
	decodeProjects,
	decodeProtectionRules,
	decodeRepoVisibility,
	deleteArguments,
	describeFlag,
	readForgeValues,
	type HelpFlag,
	editVisibilityArguments,
	failureDetail,
	forgeOf,
	grantAddArguments,
	redactUrl,
	grantIsFor,
	grantListArguments,
	grantRemoveArguments,
	invitationListArguments,
	invitationRevokeArguments,
	invitationSendArguments,
	isProtectionBranch,
	isControlOperand,
	isEmailAddress,
	isGrantee,
	isRemoteName,
	isRepositoryName,
	invitationHolds,
	listArguments,
	mirrorAddArguments,
	mirrorDetachArguments,
	mirrorListArguments,
	mirrorRemoveArguments,
	mirrorResyncArguments,
	organisationCreateArguments,
	organisationGetArguments,
	pickFlags,
	projectCreateArguments,
	projectGetArguments,
	protectionAddArguments,
	protectionListArguments,
	protectionRemoveArguments,
	readChoices,
	remoteAddArguments,
	repoListArguments,
	visibilityGetArguments,
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
	type Invitation,
	type MirrorPlacement,
	type Organisation,
	type Project,
	type ProjectRef,
	type ProtectionRule,
	type RepoVisibility,
	shownTarget,
} from '../lib/entire';
import type { CliCommandUsage, CliResult, CliRunner } from './cli';

/** A listing, or the reason it could not be read. */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** Which set of values a picker needs from the CLI's help. */
export type ChoiceRequest =
	| { readonly kind: 'role'; readonly scope: GrantScope }
	| { readonly kind: 'visibility' }
	| { readonly kind: 'invite-role' }
	| { readonly kind: 'owner-type' };

/** Where the control plane is read and changed. */
export interface ControlPlaneSource {
	organisations(): Promise<Read<readonly Organisation[]>>;
	projects(): Promise<Read<readonly Project[]>>;
	/** The project is found by its id; its name is only what the rows are labelled with. */
	repositories(project: ProjectRef): Promise<Read<readonly ControlRepository[]>>;
	/** `target` is what the CLI is handed; `label` is what the object is called, for a failure message. */
	grants(scope: GrantScope, target: string, label?: string): Promise<Read<readonly AccessGrant[]>>;
	clusters(): Promise<Read<readonly ControlCluster[]>>;
	/** One organisation, read on its own. */
	organisation(name: string): Promise<Read<Organisation>>;
	/** One project, read on its own. */
	project(name: string): Promise<Read<Project>>;
	/** A repository's visibility. */
	/** The repository is named by the reference the CLI addresses it by. */
	visibility(repo: string): Promise<Read<RepoVisibility>>;
	/** A repository's protection rules. */
	protection(repo: string): Promise<Read<readonly ProtectionRule[]>>;
	/** An organisation's invitations. */
	invitations(org: string, status?: string): Promise<Read<readonly Invitation[]>>;
	/** Where a repository is mirrored. */
	mirrors(repo: string): Promise<Read<readonly MirrorPlacement[]>>;
	/** The values the CLI's help says a flag takes, read now. */
	choices(request: ChoiceRequest): Promise<Read<readonly string[]>>;
	/** The root of the workspace, when the extension has one. */
	workspaceRoot(): string | undefined;
	/** The URL a remote of this checkout points at, with any credentials removed. */
	remoteUrl(name: string): string | undefined;
	/**
	 * The plan the CLI gives for a detach, without changing anything.
	 *
	 * The plan lists what the detach needs, and a plan whose condition is
	 * not met says so in the CLI's own words.
	 */
	detachPlan(repo: string, into: string): Promise<Read<string>>;
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

/** What a change was about, seen before the change was made. */
type Held =
	| { readonly kind: 'none' }
	| { readonly kind: 'grant'; readonly seen: boolean }
	| { readonly kind: 'placements'; readonly readable: boolean; readonly clusters: readonly string[] };

type Prepared =
	| {
			readonly ok: true;
			readonly args: readonly string[];
			readonly cascadeAvailable: boolean;
			/** Flags whose values are kept out of the invocation record. */
			readonly redactFlags?: readonly string[];
	  }
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

	organisation(name: string): Promise<Read<Organisation>> {
		return this.read('org get', ORG_GET_WANTS, flags => organisationGetArguments(flags.json, name), decodeOrganisationDetail);
	}

	project(name: string): Promise<Read<Project>> {
		return this.read('project get', PROJECT_GET_WANTS, flags => projectGetArguments(flags.json, name), decodeProjectDetail);
	}

	visibility(repo: string): Promise<Read<RepoVisibility>> {
		return this.read(
			'repo visibility get',
			REPO_VISIBILITY_WANTS,
			flags => visibilityGetArguments({ json: flags.json }, repo),
			decodeRepoVisibility,
		);
	}

	protection(repo: string): Promise<Read<readonly ProtectionRule[]>> {
		return this.read(
			'repo protection list',
			REPO_PROTECTION_WANTS,
			flags => protectionListArguments({ json: flags.json }, repo),
			decodeProtectionRules,
		);
	}

	invitations(org: string, status?: string): Promise<Read<readonly Invitation[]>> {
		return this.read(
			'org invite list',
			ORG_INVITE_LIST_WANTS,
			flags => invitationListArguments({ json: flags.json, status: flags.status }, org, status),
			decodeInvitations,
		);
	}

	workspaceRoot(): string | undefined {
		return this.options.workspaceRoot();
	}

	/**
	 * The URL a remote of this checkout points at.
	 *
	 * Any credentials in the URL are removed before it is shown, because
	 * the URL is shown to the person and written into a confirmation.
	 */
	remoteUrl(name: string): string | undefined {
		const root = this.options.workspaceRoot();
		if (root === undefined) {
			return undefined;
		}
		const config = path.join(root, '.git', 'config');
		if (!fs.existsSync(config)) {
			return undefined;
		}
		const text = fs.readFileSync(config, 'utf8');
		const section = new RegExp(`^\\[remote "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\][^\\n]*$`, 'm');
		const found = section.exec(text);
		if (!found) {
			return undefined;
		}
		const url = /^[\t ]*url\s*=\s*(.+)$/m.exec(text.slice(found.index));
		return url === null ? undefined : redactUrl(url[1].trim());
	}

	/**
	 * The plan the CLI gives for a detach.
	 *
	 * The dry run is asked for by the same flags the detach itself would
	 * use, so the plan is the plan for this detach and not another one.
	 */
	async detachPlan(repo: string, into: string): Promise<Read<string>> {
		if (!isControlOperand(repo) || !isControlOperand(into)) {
			return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
		}
		const help = await this.help('repo mirror detach');
		if (!help.ok) {
			return help;
		}
		const picked = pickFlags('repo mirror detach', help.value.raw, help.value.flags, REPO_MIRROR_DETACH_WANTS);
		if (!picked.ok || !picked.flags.into) {
			return { ok: false, detail: picked.ok ? 'the flag that names the native repository is missing' : picked.detail };
		}
		const args = mirrorDetachArguments(
			{ into: picked.flags.into, json: picked.flags.json, dryRun: picked.flags.dryRun },
			repo,
			into,
		);
		const result = await this.options.runner.run(args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: this.options.context(),
			withholdBodies: true,
		});
		if (!result.ok) {
			return { ok: false, detail: explain(result) };
		}
		return { ok: true, value: result.stdout || result.stderr || '' };
	}

	mirrors(repo: string): Promise<Read<readonly MirrorPlacement[]>> {
		return this.read(
			'repo mirror list',
			REPO_MIRROR_LIST_WANTS,
			(flags, table) =>
				mirrorListArguments(
					{ json: flags.json, forge: flags.forge, name: flags.name },
					repo,
					forgeValue(describeFlag(table, flags.forge), forgeOf(repo) ?? ''),
				),
			decodeMirrors,
		);
	}

	async choices(request: ChoiceRequest): Promise<Read<readonly string[]>> {
		const { command, wants, flag } = choiceWants(request);
		const help = await this.help(command);
		if (!help.ok) {
			return help;
		}
		const picked = pickFlags(command, help.value.raw, help.value.flags, wants as Record<string, FlagWant>);
		if (!picked.ok) {
			return picked;
		}
		const values = readChoices(describeFlag(picked.table, flag(picked.flags)));
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
		// A revoke can only be confirmed against a direct grant seen before it,
		// and a removal only against a placement that was there before it.
		const held = await this.heldBefore(action);

		const result = await this.options.runner.run(prepared.args, {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: this.options.context(),
			withholdBodies: true,
			redactFlags: prepared.redactFlags,
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
			// The CLI refuses a change to something GitHub owns, and says so.
			if (/read-only projection|managed by the source/i.test(`${result.stderr}\n${result.stdout}\n${detail}`)) {
				return { kind: 'refused-github', detail };
			}
			// A clone that fails part way leaves what it made, and the path is
			// named so it can be looked at.
			if (action.kind === 'clone-repository') {
				return { kind: 'failed', detail: `${detail}; what was written into ${action.resolved ?? action.target ?? 'the workspace'} is left as it is` };
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

			case 'create-organisation': {
				if (!isControlOperand(action.name)) {
					return { ok: false, detail: 'that organisation name cannot be passed to the Entire CLI' };
				}
				const help = await this.help('org create');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('org create', help.value.raw, help.value.flags, ORG_CREATE_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: organisationCreateArguments({ json: picked.flags.json, region: picked.flags.region }, action.name, action.region),
				};
			}

			case 'create-project': {
				if (!isControlOperand(action.name) || !isControlOperand(action.owner)) {
					return { ok: false, detail: 'that project or owner name cannot be passed to the Entire CLI' };
				}
				const help = await this.help('project create');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('project create', help.value.raw, help.value.flags, PROJECT_CREATE_WANTS);
				if (!picked.ok || !picked.flags.owner) {
					return { ok: false, detail: picked.ok ? 'the owner flag is missing' : picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: projectCreateArguments(
						{
							owner: picked.flags.owner,
							ownerType: picked.flags.ownerType,
							region: picked.flags.region,
							json: picked.flags.json,
						},
						action.name,
						action.owner,
						action.ownerType,
						action.region,
					),
				};
			}

			case 'invite': {
				if (!isControlOperand(action.org) || !isEmailAddress(action.email)) {
					return { ok: false, detail: 'that organisation name or email address cannot be passed to the Entire CLI' };
				}
				const help = await this.help('org invite send');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('org invite send', help.value.raw, help.value.flags, ORG_INVITE_SEND_WANTS);
				if (!picked.ok || !picked.flags.email) {
					return { ok: false, detail: picked.ok ? 'the email flag is missing' : picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					// The address is the invitee's own, and it is not written to the log.
					redactFlags: [picked.flags.email],
					args: invitationSendArguments(
						{ email: picked.flags.email, role: picked.flags.role, json: picked.flags.json },
						action.org,
						action.email,
						action.role,
					),
				};
			}

			case 'revoke-invitation': {
				if (!isControlOperand(action.org) || !isEmailAddress(action.email)) {
					return { ok: false, detail: 'that organisation name or email address cannot be passed to the Entire CLI' };
				}
				const help = await this.help('org invite revoke');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('org invite revoke', help.value.raw, help.value.flags, ORG_INVITE_REVOKE_WANTS);
				if (!picked.ok || !picked.flags.email) {
					return { ok: false, detail: picked.ok ? 'the email flag is missing' : picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					// The address is the invitee's own, and it is not written to the log.
					redactFlags: [picked.flags.email],
					args: invitationRevokeArguments({ email: picked.flags.email }, action.org, action.email),
				};
			}

			case 'add-mirror':
				return this.preparePlacement('repo mirror add', REPO_MIRROR_PLACEMENT_WANTS, action.repo, action.clusters);

			case 'remove-mirror':
				return this.preparePlacement('repo mirror remove', REPO_MIRROR_PLACEMENT_WANTS, action.repo, action.clusters);

			case 'detach-mirror': {
				if (!isControlOperand(action.repo) || !isControlOperand(action.into)) {
					return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo mirror detach');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo mirror detach', help.value.raw, help.value.flags, REPO_MIRROR_DETACH_WANTS);
				if (!picked.ok || !picked.flags.into) {
					return { ok: false, detail: picked.ok ? 'the flag that names the native repository is missing' : picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: mirrorDetachArguments(
						{
							into: picked.flags.into,
							json: picked.flags.json,
							noWait: picked.flags.noWait,
							// The person confirmed in the editor, so the CLI is not asked again.
							yes: picked.flags.yes,
						},
						action.repo,
						action.into,
					),
				};
			}

			case 'resync-mirror': {
				if (!isControlOperand(action.repo)) {
					return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo mirror resync');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo mirror resync', help.value.raw, help.value.flags, REPO_MIRROR_RESYNC_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				return { ok: true, cascadeAvailable: false, args: mirrorResyncArguments({ json: picked.flags.json }, action.repo) };
			}

			case 'add-protection': {
				if (!isControlOperand(action.repo) || !isProtectionBranch(action.branch)) {
					return { ok: false, detail: 'that repository path or branch cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo protection add');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo protection add', help.value.raw, help.value.flags, REPO_PROTECTION_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				if (action.serverSideMergeOnly !== undefined && picked.flags.serverSideMergeOnly === undefined) {
					return {
						ok: false,
						detail: 'this version of the Entire CLI does not describe a way to set the protection level; update the CLI',
					};
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: protectionAddArguments(
						{ json: picked.flags.json, serverSideMergeOnly: picked.flags.serverSideMergeOnly },
						action.repo,
						action.branch,
						action.serverSideMergeOnly,
					),
				};
			}

			case 'remove-protection': {
				if (!isControlOperand(action.repo) || !isProtectionBranch(action.branch)) {
					return { ok: false, detail: 'that repository path or branch cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo protection remove');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo protection remove', help.value.raw, help.value.flags, REPO_PROTECTION_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: protectionRemoveArguments({ json: picked.flags.json }, action.repo, action.branch),
				};
			}

			case 'clone-repository': {
				if (!isControlOperand(action.repo)) {
					return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo clone');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo clone', help.value.raw, help.value.flags, REPO_CLONE_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: cloneArguments(
						{ cluster: picked.flags.cluster, nearest: picked.flags.nearest },
						action.repo,
						action.target,
						action.cluster,
					),
				};
			}

			case 'add-remote': {
				if (!isRemoteName(action.name) || (action.repo !== undefined && !isControlOperand(action.repo))) {
					return { ok: false, detail: 'that remote name or repository path cannot be passed to the Entire CLI' };
				}
				const help = await this.help('repo remote add');
				if (!help.ok) {
					return { ok: false, detail: help.detail };
				}
				const picked = pickFlags('repo remote add', help.value.raw, help.value.flags, REPO_REMOTE_ADD_WANTS);
				if (!picked.ok) {
					return { ok: false, detail: picked.detail };
				}
				return {
					ok: true,
					cascadeAvailable: false,
					args: remoteAddArguments(
						{ cluster: picked.flags.cluster, override: picked.flags.override },
						action.name,
						action.repo,
						action.cluster,
					),
				};
			}
		}
	}

	/** A mirror placement: the repository, and the clusters to put it on or take it off. */
	private async preparePlacement(
		command: string,
		wants: Readonly<Record<'cluster' | 'noWait' | 'timeout', FlagWant>>,
		repo: string,
		clusters: readonly string[],
	): Promise<Prepared> {
		if (!isControlOperand(repo)) {
			return { ok: false, detail: 'that repository path cannot be passed to the Entire CLI' };
		}
		const help = await this.help(command);
		if (!help.ok) {
			return { ok: false, detail: help.detail };
		}
		const picked = pickFlags(command, help.value.raw, help.value.flags, wants);
		if (!picked.ok) {
			return { ok: false, detail: picked.detail };
		}
		const args =
			command === 'repo mirror add'
				? mirrorAddArguments({ cluster: picked.flags.cluster, noWait: picked.flags.noWait, timeout: picked.flags.timeout }, repo, clusters)
				: mirrorRemoveArguments({ cluster: picked.flags.cluster, noWait: picked.flags.noWait, timeout: picked.flags.timeout }, repo, clusters);
		return { ok: true, cascadeAvailable: false, args };
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

	/**
	 * What the change was about, seen before the change was made.
	 *
	 * A change that takes something away can only be confirmed against the
	 * thing that was there, so it is read first.
	 */
	private async heldBefore(action: ControlAction): Promise<Held> {
		switch (action.kind) {
			case 'revoke':
				return { kind: 'grant', seen: await this.directGrantSeen(action) };
			case 'remove-mirror': {
				const read = await this.mirrors(action.repo);
				if (!read.ok) {
					return { kind: 'placements', clusters: [], readable: false };
				}
				return {
					kind: 'placements',
					readable: true,
					clusters: read.value
						.filter(placement => placement.repo === action.repo)
						.map(placement => placement.cluster ?? placement.clusterSlug)
						.filter((cluster): cluster is string => cluster !== undefined),
				};
			}
			default:
				return { kind: 'none' };
		}
	}

	/** Reads the object back and says whether it matches what was asked for. */
	private async verify(action: ControlAction, heldBefore: Held): Promise<Verdict> {
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
				if (heldBefore.kind !== 'grant' || heldBefore.seen !== true) {
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

			case 'create-organisation': {
				const read = await this.organisations();
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(organisation => organisation.name === action.name)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the listing holds no organisation named ${action.name}` };
			}

			case 'create-project': {
				const read = await this.projects();
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(project => project.name === action.name)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the listing holds no project named ${action.name}` };
			}

			case 'invite': {
				const read = await this.invitations(action.org);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(invitation => invitationHolds(invitation, action.email))
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the invitations of ${action.org} hold none for ${action.email}` };
			}

			case 'revoke-invitation': {
				const read = await this.invitations(action.org);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(invitation => invitationHolds(invitation, action.email))
					? { kind: 'contradicted', detail: `the invitations of ${action.org} still hold one for ${action.email}` }
					: { kind: 'confirmed' };
			}

			case 'add-mirror': {
				const read = await this.mirrors(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				const placed = read.value.filter(placement => placement.repo === action.repo);
				const missing = action.clusters.filter(cluster => !placed.some(placement => placement.cluster === cluster));
				return missing.length === 0
					? { kind: 'confirmed' }
					: {
							kind: 'contradicted',
							detail: `the listing holds no placement of ${action.repo} on ${missing.join(', ')}`,
					  };
			}

			case 'remove-mirror': {
				if (heldBefore.kind !== 'placements' || heldBefore.readable !== true) {
					return {
						kind: 'unreadable',
						detail: `the extension could not confirm the mirror was removed, because it could not read where ${action.repo} was placed before the request`,
					};
				}
				const read = await this.mirrors(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				const placed = read.value.filter(placement => placement.repo === action.repo);
				const left = action.clusters.filter(cluster => placed.some(placement => placement.cluster === cluster));
				return left.length === 0
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the listing still holds a placement of ${action.repo} on ${left.join(', ')}` };
			}

			case 'detach-mirror': {
				const read = await this.mirrors(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(placement => placement.repo === action.repo)
					? { kind: 'contradicted', detail: `the listing still holds ${action.repo} as a mirror` }
					: { kind: 'confirmed' };
			}

			case 'resync-mirror': {
				const read = await this.mirrors(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.some(placement => placement.repo === action.repo)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the listing holds no mirror of ${action.repo}` };
			}

			case 'add-protection': {
				const read = await this.protection(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.length > 0
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the listing holds no protection rule for ${action.repo}` };
			}

			case 'remove-protection': {
				const read = await this.protection(action.repo);
				if (!read.ok) {
					return { kind: 'unreadable', detail: read.detail };
				}
				return read.value.length > 0
					? { kind: 'contradicted', detail: `the listing still holds a protection rule for ${action.repo}` }
					: { kind: 'confirmed' };
			}

			case 'clone-repository': {
				const root = this.options.workspaceRoot();
				if (root === undefined) {
					return { kind: 'unreadable', detail: 'the workspace has no folder to clone into' };
				}
				const target = action.target ?? path.basename(action.repo);
				const folder = path.resolve(root, target);
				if (!fs.existsSync(folder)) {
					return { kind: 'contradicted', detail: `no folder named ${target} was created` };
				}
				// A clone is done when it left a work tree behind, not when the
				// folder happens to exist.
				return fs.existsSync(path.join(folder, '.git'))
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the folder ${folder} holds no git work tree` };
			}

			case 'add-remote': {
				const root = this.options.workspaceRoot();
				if (root === undefined) {
					return { kind: 'unreadable', detail: 'the workspace has no checkout to add a remote to' };
				}
				const config = path.join(root, '.git', 'config');
				if (!fs.existsSync(config)) {
					return { kind: 'unreadable', detail: 'this workspace has no git configuration to read' };
				}
				const held = fs.readFileSync(config, 'utf8');
				const section = new RegExp(`\\[remote "${action.name}"\\][^\\[]*url`, 'm');
				return section.test(held)
					? { kind: 'confirmed' }
					: { kind: 'contradicted', detail: `the git configuration holds no remote named ${action.name} with an address` };
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
		argumentsFor: (flags: Record<K, string>, table: readonly HelpFlag[]) => readonly string[],
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
		const result = await this.options.runner.runJson(argumentsFor(flags, picked.table), value => unwrap(decode(value)), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.timeoutSeconds() * 1000,
			context: this.options.context(),
			withholdBodies: true,
		});
		return result.ok ? { ok: true, value: result.value } : { ok: false, detail: explain(result) };
	}

	/** The same, for a command that answers with one object rather than a list. */
	private async read<T, K extends string>(
		command: string,
		wants: Readonly<Record<K, FlagWant>>,
		argumentsFor: (flags: Record<K, string>, table: readonly HelpFlag[]) => readonly string[],
		decode: (value: unknown) => DecodeResult<T>,
	): Promise<Read<T>> {
		return this.list(command, wants, argumentsFor, decode);
	}
}

/**
 * The forge to ask the CLI for, from the values its help line names.
 *
 * The reference says which forge the repository belongs to, and the
 * help says which word the CLI calls that forge. When the two do not
 * meet, no forge is named and the CLI's own default applies.
 */
function forgeValue(description: string, forge: string): string | undefined {
	const values = readForgeValues(description);
	return values.includes(forge) ? forge : undefined;
}

/**
 * The command a set of values is read from, and the flag they are the
 * values of.
 *
 * Every set of values comes from the CLI's own help, so a CLI that
 * renames a flag or drops a value is followed rather than guessed at.
 */
function choiceWants(request: ChoiceRequest): {
	readonly command: string;
	readonly wants: Readonly<Record<string, FlagWant>>;
	readonly flag: (flags: Readonly<Partial<Record<string, string>>>) => string | undefined;
} {
	switch (request.kind) {
		case 'role':
			return { command: `${request.scope} grant add`, wants: GRANT_WANTS, flag: flags => flags.role };
		case 'invite-role':
			return { command: 'org invite send', wants: ORG_INVITE_SEND_WANTS, flag: flags => flags.role };
		case 'owner-type':
			return { command: 'project create', wants: PROJECT_CREATE_WANTS, flag: flags => flags.ownerType };
		case 'visibility':
			return { command: 'repo edit', wants: REPO_EDIT_WANTS, flag: flags => flags.visibility };
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
