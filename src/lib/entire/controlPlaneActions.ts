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
	| { readonly kind: 'failed'; readonly detail: string };

/** The sentence reported after a change, naming the login it was made as. */
export function describeControlOutcome(action: ControlAction, outcome: ControlOutcome, acting: Pick<AccountContext, 'handle' | 'name'>): string {
	const as = `as ${describeActingLogin(acting)}`;
	switch (outcome.kind) {
		case 'done':
			return `Done: ${describeControlAction(action)} ${as}. The Entire CLI now lists it that way.`;
		case 'unconfirmed':
			return `The Entire CLI accepted the request to ${describeControlAction(action)} ${as}, but the result could not be checked: ${outcome.detail}.`;
		case 'refused-mirrors':
		case 'failed':
			return `Could not ${describeControlAction(action)} ${as}: ${outcome.detail}.`;
	}
}

function capitalise(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
