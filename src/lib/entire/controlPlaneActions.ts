import type { AccountContext } from './accountContext';
import type { GrantScope } from './controlPlaneFlags';

/** One change to the control plane, with everything needed to name it. */
export type ControlAction =
	| {
			readonly kind: 'delete-repository';
			readonly name: string;
			readonly project: string;
			/** The project's id, which the CLI is handed to read the project again. */
			readonly projectId: string;
			readonly path: string;
			/** Also delete the mirrors on other clusters. Set only after the CLI refused without it. */
			readonly cascade: boolean;
	  }
	| {
			readonly kind: 'create-repository';
			readonly name: string;
			/** The project's readable name, for the question. */
			readonly project: string;
			/** The project's id, which the CLI is handed. */
			readonly projectId: string;
			readonly visibility?: string;
	  }
	| {
			readonly kind: 'set-visibility';
			readonly name: string;
			readonly project: string;
			readonly projectId: string;
			readonly path: string;
			readonly visibility: string;
			readonly current?: string;
	  }
	| {
			readonly kind: 'delete-project';
			readonly name: string;
			readonly id: string;
			readonly repositoryCount?: number;
	  }
	| { readonly kind: 'delete-organisation'; readonly name: string; readonly id: string }
	| {
			readonly kind: 'grant';
			readonly scope: GrantScope;
			/** The CLI's operand for the object: a repository path, a project id, or an organisation name. */
			readonly target: string;
			/** What the object is called on screen, when the operand is an id. */
			readonly label?: string;
			readonly grantee: string;
			readonly role: string;
	  }
	| {
			readonly kind: 'revoke';
			readonly scope: GrantScope;
			readonly target: string;
			readonly label?: string;
			readonly grantee: string;
	  }
	| {
			readonly kind: 'create-organisation';
			readonly name: string;
			/** The jurisdiction the organisation is created in, when one was chosen. */
			readonly region?: string;
	  }
	| {
			readonly kind: 'create-project';
			readonly name: string;
			/** The owning organisation's name, or the account that owns it. */
			readonly owner: string;
			/** The kind of owner: `org` or `account`. */
			readonly ownerType?: string;
			readonly region?: string;
	  }
	| {
			readonly kind: 'invite';
			/** The organisation the invitation is for. */
			readonly org: string;
			readonly email: string;
			readonly role?: string;
	  }
	| { readonly kind: 'revoke-invitation'; readonly org: string; readonly email: string }
	| {
			readonly kind: 'add-mirror';
			/** The repository, in the form the CLI addresses it. */
			readonly repo: string;
			/** The clusters to place it on. */
			readonly clusters: readonly string[];
	  }
	| {
			readonly kind: 'detach-mirror';
			readonly repo: string;
			/** The native repository it becomes. */
			readonly into: string;
	  }
	| {
			readonly kind: 'remove-mirror';
			readonly repo: string;
			readonly clusters: readonly string[];
	  }
	| { readonly kind: 'resync-mirror'; readonly repo: string }
	| {
			readonly kind: 'add-protection';
			readonly repo: string;
			/** The branch the rule is about: `HEAD`, a branch name, or a pattern such as `release/*`. */
			readonly branch: string;
			/** Whether every direct push is refused. */
			readonly serverSideMergeOnly?: boolean;
	  }
	| {
			readonly kind: 'remove-protection';
			readonly repo: string;
			/** The branch the rule is about. */
			readonly branch: string;
	  }
	| {
			readonly kind: 'clone-repository';
			readonly repo: string;
			/** The directory it is cloned into, relative to the workspace. */
			readonly target?: string;
			/** Where that directory is on this machine, as the person saw it. */
			readonly resolved?: string;
			/** The cluster it is cloned from, when one was chosen. */
			readonly cluster?: string;
	  }
	| {
			readonly kind: 'add-remote';
			/** The name the remote is given in this checkout. */
			readonly name: string;
			/** The repository it points at, when one was named. */
			readonly repo?: string;
			/** The cluster it points at, when one was chosen. */
			readonly cluster?: string;
			/** Whether an occupied name is repointed. */
			readonly override?: boolean;
			/** The URL the name already points at, with any credentials removed. */
			readonly previous?: string;
	  };

/** What a person is asked to agree to. */
export interface ControlConfirmation {
	readonly message: string;
	readonly detail: string;
	readonly action: string;
}

/** Who the extension acts as, in words the person recognises. */
export function describeActingLogin(acting: Pick<AccountContext, 'handle' | 'name'>): string {
	return acting.handle === acting.name ? acting.handle : `${acting.handle} (login ${acting.name})`;
}

const SCOPE_WORDS: Record<GrantScope, string> = {
	repo: 'repository',
	project: 'project',
	org: 'organisation',
};

/** The noun for a grant scope. */
export function scopeWord(scope: GrantScope): string {
	return SCOPE_WORDS[scope];
}

/** What a grant or revoke calls its object when it is shown: the readable label, else the operand. */
export function shownTarget(action: Extract<ControlAction, { kind: 'grant' | 'revoke' }>): string {
	return action.label ?? action.target;
}

/** What the change is, as a short phrase naming what it affects. */
export function describeControlAction(action: ControlAction): string {
	switch (action.kind) {
		case 'delete-repository':
			return `delete the repository ${action.path}${action.cascade ? ' and its mirrors' : ''}`;
		case 'create-repository':
			return `create the repository ${action.name} in project ${action.project}`;
		case 'set-visibility':
			return `make the repository ${action.path} ${action.visibility}`;
		case 'delete-project':
			return `delete the project ${action.name}`;
		case 'delete-organisation':
			return `delete the organisation ${action.name}`;
		case 'grant':
			return `give ${action.grantee} the ${action.role} role on the ${scopeWord(action.scope)} ${shownTarget(action)}`;
		case 'revoke':
			return `remove ${action.grantee}'s access to the ${scopeWord(action.scope)} ${shownTarget(action)}`;
		case 'create-organisation':
			return `create the organisation ${action.name}`;
		case 'create-project':
			return `create the project ${action.name} under ${action.owner}`;
		case 'invite':
			return `invite ${action.email} to the organisation ${action.org}`;
		case 'revoke-invitation':
			return `revoke the invitation to ${action.email} in the organisation ${action.org}`;
		case 'add-mirror':
			return `mirror ${action.repo} onto ${action.clusters.length === 1 ? action.clusters[0] : action.clusters.join(', ')}`;
		case 'detach-mirror':
			return `detach ${action.repo} into ${action.into}`;
		case 'remove-mirror':
			return `remove the mirror of ${action.repo} from ${action.clusters.length === 1 ? action.clusters[0] : action.clusters.join(', ')}`;
		case 'resync-mirror':
			return `resync the mirror of ${action.repo}`;
		case 'add-protection':
			return action.serverSideMergeOnly === false
				? `lower the protection on ${action.branch} of ${action.repo}`
				: `refuse every direct push to ${action.branch} of ${action.repo}`;
		case 'remove-protection':
			return `remove the protection on ${action.branch} of ${action.repo}`;
		case 'clone-repository':
			return `clone ${action.repo}`;
		case 'add-remote':
			return action.repo === undefined
				? `add the remote ${action.name} to this checkout`
				: `add the remote ${action.name} for ${action.repo} to this checkout`;
	}
}

/**
 * The question asked before a change.
 *
 * Every question names what it affects and the login it will act as, and
 * says the change happens on Entire's servers, not in the workspace.
 */
export function confirmationFor(action: ControlAction, acting: Pick<AccountContext, 'handle' | 'name'>): ControlConfirmation {
	const as = `Acting as ${describeActingLogin(acting)}.`;
	const remote = 'The change is made on Entire for everyone who uses it, not only in this workspace.';
	switch (action.kind) {
		case 'delete-repository':
			return {
				message: `Delete the repository ${action.path}?`,
				detail:
					`${as} This deletes ${action.path} from project ${action.project}, with its history on Entire. ` +
					(action.cascade
						? 'Every mirror of it on other clusters is deleted too. '
						: 'The CLI refuses if it has mirrors on other clusters. ') +
					`${remote} It cannot be undone from the editor.`,
				action: action.cascade ? 'Delete Repository and Mirrors' : 'Delete Repository',
			};
		case 'create-repository':
			return {
				message: `Create the repository ${action.name} in project ${action.project}?`,
				detail:
					`${as} The repository is created on Entire${action.visibility ? ` as ${action.visibility}` : ' with the CLI\'s default visibility'}. ` +
					remote,
				action: 'Create Repository',
			};
		case 'set-visibility':
			return {
				message: `Make ${action.path} ${action.visibility}?`,
				detail:
					`${as} ${action.path} is ${action.current ?? 'not known to be anything else'} now. ` +
					(action.visibility === 'public'
						? 'Every authenticated Entire user will be able to read it. '
						: 'Only people granted access will be able to read it. ') +
					remote,
				action: `Make ${capitalise(action.visibility)}`,
			};
		case 'delete-project': {
			const holds = action.repositoryCount === undefined ? '' : ` It holds ${action.repositoryCount} ${action.repositoryCount === 1 ? 'repository' : 'repositories'}.`;
			return {
				message: `Delete the project ${action.name}?`,
				detail: `${as} This deletes the project ${action.name} on Entire.${holds} ${remote} It cannot be undone from the editor.`,
				action: 'Delete Project',
			};
		}
		case 'delete-organisation':
			return {
				message: `Delete the organisation ${action.name}?`,
				detail: `${as} This deletes the organisation ${action.name} on Entire, and its members lose the access it gave them. ${remote} It cannot be undone from the editor.`,
				action: 'Delete Organisation',
			};
		case 'grant':
			return {
				message: `Give ${action.grantee} the ${action.role} role on ${shownTarget(action)}?`,
				detail: `${as} ${action.grantee} will be able to use the ${scopeWord(action.scope)} ${shownTarget(action)} as ${action.role}. ${remote}`,
				action: 'Grant Access',
			};
		case 'revoke':
			return {
				message: `Remove ${action.grantee}'s access to ${shownTarget(action)}?`,
				detail: `${as} ${action.grantee} loses the access they hold directly on the ${scopeWord(action.scope)} ${shownTarget(action)}. Access they inherit from elsewhere is not affected. ${remote}`,
				action: 'Revoke Access',
			};
		case 'create-organisation':
			return {
				message: `Create the organisation ${action.name}?`,
				detail: `${as} The organisation is created on Entire${action.region ? ` in the ${action.region} jurisdiction` : ''}. ${remote} It cannot be undone from the editor.`,
				action: 'Create Organisation',
			};
		case 'create-project':
			return {
				message: `Create the project ${action.name} under ${action.owner}?`,
				detail: `${as} The project is created on Entire${action.ownerType ? ` and is owned by ${action.ownerType === 'account' ? 'the account' : 'the organisation'} ${action.owner}` : ` under ${action.owner}`}${action.region ? `, in the ${action.region} jurisdiction` : ''}. ${remote} It cannot be undone from the editor.`,
				action: 'Create Project',
			};
		case 'invite':
			return {
				message: `Invite ${action.email} to ${action.org}?`,
				detail:
					`${as} An invitation is sent to ${action.email}${action.role ? ` with the ${action.role} role` : ''}. ` +
					'Entire sends it by email to that address, and it can be revoked afterwards. ' +
					'An invitation already open for that address is mailed again at the role it was opened with, not the one chosen here. ' +
					remote,
				action: 'Send Invitation',
			};
		case 'revoke-invitation':
			return {
				message: `Revoke the invitation to ${action.email}?`,
				detail: `${as} The open invitation to ${action.email} in the organisation ${action.org} is revoked. The address keeps whatever access it already had. ${remote}`,
				action: 'Revoke Invitation',
			};
		case 'add-mirror':
			return {
				message: `Mirror ${action.repo} onto ${action.clusters.join(', ')}?`,
				detail: `${as} A copy of ${action.repo} is placed on ${action.clusters.join(', ')}, and the whole history is copied there. ${remote} It cannot be undone from the editor.`,
				action: 'Add Mirror',
			};
		case 'detach-mirror':
			return {
				message: `Detach ${action.repo} into ${action.into}?`,
				detail:
					`${as} ${action.repo} stops being a mirror and becomes the native repository ${action.into}. ` +
					'It stops taking anything from GitHub, so the access GitHub gave it is lost, and it never syncs with GitHub again. ' +
					'The remote history is rewritten, and the mirrors on other clusters are left alone. ' +
					`${remote} It cannot be undone from the editor.`,
				action: 'Detach Mirror',
			};
		case 'remove-mirror':
			return {
				message: `Remove the mirror of ${action.repo} from ${action.clusters.join(', ')}?`,
				detail: `${as} The copy of ${action.repo} on ${action.clusters.join(', ')} is torn down, and the history that is only there is lost. ${remote} It cannot be undone from the editor.`,
				action: 'Remove Mirror',
			};
		case 'resync-mirror':
			return {
				message: `Resync the mirror of ${action.repo}?`,
				detail: `${as} The mirror of ${action.repo} is fetched again and brought up to date with its source. Nothing is deleted. ${remote}`,
				action: 'Resync Mirror',
			};
		case 'add-protection':
			return {
				message:
					action.serverSideMergeOnly === false
						? `Lower the protection on ${action.branch}?`
						: `Refuse every direct push to ${action.branch}?`,
				detail:
					`${as} ` +
					(action.serverSideMergeOnly === false
						? `The rule on ${action.branch} of ${action.repo} is lowered, so direct pushes are allowed again. `
						: `Every direct push to ${action.branch} of ${action.repo} is refused, and the branch moves only through a merge Entire performs. `) +
					remote,
				action: action.serverSideMergeOnly === false ? 'Lower Protection' : 'Add Protection',
			};
		case 'remove-protection':
			return {
				message: `Remove the protection on ${action.branch}?`,
				detail: `${as} The rule on ${action.branch} of ${action.repo} is removed, and direct pushes are allowed again. ${remote} It cannot be undone from the editor.`,
				action: 'Remove Protection',
			};
		case 'clone-repository':
			return {
				message: `Clone ${action.repo}?`,
				detail:
					`${as} The repository is cloned to this machine, into ${action.resolved ?? action.target ?? 'the workspace'}` +
					`${action.cluster ? `, from the cluster ${action.cluster}` : ''}. Nothing is changed on Entire.`,
				action: 'Clone Repository',
			};
		case 'add-remote':
			return {
				message: action.repo === undefined ? `Add the remote ${action.name}?` : `Add the remote ${action.name} for ${action.repo}?`,
				detail:
					`${as} The remote ${action.name} is added to this checkout's git configuration` +
					(action.repo === undefined ? ', pointing at the repository this checkout is on' : `, pointing at ${action.repo}`) +
					(action.cluster ? ` on the cluster ${action.cluster}` : '') +
					(action.override ? `. The name is already taken, so it is repointed from ${action.previous ?? 'where it points now'}` : '') +
					'. Nothing is changed on Entire.',
				action: 'Add Remote',
			};
	}
}

/** The confirmation for a call to the control plane's API. */
export function apiConfirmation(
	call: { readonly method: string; readonly path: string; readonly backend?: string },
	acting: Pick<AccountContext, 'handle' | 'name'>,
): ControlConfirmation {
	const method = call.method.toUpperCase();
	return {
		message: `Send ${method} ${call.path}?`,
		detail:
			`Acting as ${describeActingLogin(acting)}. This sends one ${method} request to ${call.backend ? `the ${call.backend} backend of ` : ''}Entire's API. ` +
			'A request that is not a read can change or delete things on Entire, and the extension cannot tell what this one does.',
		action: `Send ${method}`,
	};
}

/** How a change ended. */
export type ControlOutcome =
	| { readonly kind: 'done'; readonly summary: string }
	| { readonly kind: 'unconfirmed'; readonly summary: string; readonly detail: string }
	| { readonly kind: 'refused-mirrors'; readonly detail: string }
	| { readonly kind: 'refused-github'; readonly detail: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** The sentence reported after a change, naming the login it was made as. */
export function describeControlOutcome(action: ControlAction, outcome: ControlOutcome, acting: Pick<AccountContext, 'handle' | 'name'>): string {
	const as = `as ${describeActingLogin(acting)}`;
	switch (outcome.kind) {
		case 'done':
			return `Done: ${describeControlAction(action)} ${as}. The Entire CLI now lists it that way.`;
		case 'unconfirmed':
			return `The Entire CLI accepted the request to ${describeControlAction(action)} ${as}, but the result could not be checked: ${outcome.detail}.`;
		case 'refused-github':
			return `Could not ${describeControlAction(action)} ${as}: ${outcome.detail}. It belongs to GitHub, and is changed there.`;
		case 'refused-mirrors':
		case 'failed':
			return `Could not ${describeControlAction(action)} ${as}: ${outcome.detail}.`;
	}
}

function capitalise(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
