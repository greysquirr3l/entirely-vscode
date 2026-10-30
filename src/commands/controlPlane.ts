import {
	API_METHODS,
	apiConfirmation,
	confirmationFor,
	describeActingLogin,
	describeControlOutcome,
	grantHandle,
	isApiPath,
	isGrantee,
	isReadMethod,
	isRepositoryName,
	repositoryPath,
	type AccountContext,
	type ControlAction,
	type ControlConfirmation,
	type ControlOutcome,
	type GrantScope,
	type Project,
} from '../lib/entire';
import type { ControlNode } from '../providers/controlPlaneProvider';
import type { ApiSource } from '../services/controlApi';
import type { ControlPlaneSource } from '../services/controlPlane';

/** The questions and answers of the control plane commands. */
export interface ControlPlaneUi {
	/** True only when the person chose to go ahead. */
	confirm(prompt: ControlConfirmation): Promise<boolean>;
	pick(title: string, values: readonly string[]): Promise<string | undefined>;
	ask(options: {
		readonly title: string;
		readonly prompt: string;
		readonly value?: string;
		readonly validate: (value: string) => string | undefined;
	}): Promise<string | undefined>;
	pickProject(projects: readonly Project[]): Promise<Project | undefined>;
	withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
	inform(message: string): Promise<void>;
	warn(message: string): Promise<void>;
	/** Shows an API response in a read-only document of its own. */
	showApiResult(heading: string, body: string): Promise<void>;
}

/** What the commands need. */
export interface ControlPlaneDependencies {
	readonly source: ControlPlaneSource;
	readonly api: ApiSource;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
	readonly ui: ControlPlaneUi;
	/** Reads the view again. */
	readonly refresh: () => void;
	/** True while a change is running, shared so a second one is refused. */
	readonly running?: { active: boolean };
}

/** How a control plane command ended. */
export type ControlResult = 'cancelled' | 'busy' | 'no-login' | 'done' | 'unconfirmed' | 'failed';

const sharedRunning = { active: false };

const NO_LOGIN = 'No Entire login is available, so Entirely cannot say who this would be done as. Sign in first.';

async function guarded(deps: ControlPlaneDependencies, work: () => Promise<ControlResult>): Promise<ControlResult> {
	const running = deps.running ?? sharedRunning;
	if (running.active) {
		await deps.ui.inform('A control plane change is already running.');
		return 'busy';
	}
	running.active = true;
	try {
		return await work();
	} finally {
		running.active = false;
	}
}

/**
 * Confirms, makes, and reports one change.
 *
 * The login is worked out here, just before the question, and the same
 * login is handed to the change, so the question never names one login
 * while the command runs as another. Nothing runs until the person agrees;
 * a repository that has mirrors gets a second, plainer question naming them.
 */
async function change(deps: ControlPlaneDependencies, action: ControlAction): Promise<ControlResult> {
	const { ui, source } = deps;
	const acting = await deps.acting();
	if (!acting) {
		await ui.warn(NO_LOGIN);
		return 'no-login';
	}

	if (!(await ui.confirm(confirmationFor(action, acting)))) {
		return 'cancelled';
	}

	let current = action;
	let outcome = await ui.withProgress(`Working as ${acting.handle}…`, () => source.perform(current, acting));

	if (outcome.kind === 'refused-mirrors' && current.kind === 'delete-repository') {
		const cascading: ControlAction = { ...current, cascade: true };
		if (!(await ui.confirm(confirmationFor(cascading, acting)))) {
			deps.refresh();
			await ui.warn(`${current.path} was not deleted: it has mirrors on other clusters, and deleting them was declined.`);
			return 'cancelled';
		}
		current = cascading;
		outcome = await ui.withProgress(`Working as ${acting.handle}…`, () => source.perform(cascading, acting));
	}

	deps.refresh();
	return report(ui, current, outcome, acting);
}

async function report(ui: ControlPlaneUi, action: ControlAction, outcome: ControlOutcome, acting: AccountContext): Promise<ControlResult> {
	const message = describeControlOutcome(action, outcome, acting);
	if (outcome.kind === 'done') {
		await ui.inform(message);
		return 'done';
	}
	await ui.warn(message);
	return outcome.kind === 'unconfirmed' ? 'unconfirmed' : 'failed';
}

/** The project a command is about: the one clicked, or one the person picks. */
async function projectOf(deps: ControlPlaneDependencies, node: ControlNode | undefined): Promise<Project | undefined> {
	if (node?.kind === 'project') {
		return node.project;
	}
	const projects = await deps.source.projects();
	if (!projects.ok) {
		await deps.ui.warn(`Cannot list the projects: ${projects.detail}.`);
		return undefined;
	}
	if (projects.value.length === 0) {
		await deps.ui.warn('This login can see no projects to put a repository in.');
		return undefined;
	}
	return deps.ui.pickProject(projects.value);
}

/** Creates a repository in a project. */
export async function createRepository(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const project = await projectOf(deps, node);
		if (!project) {
			return 'cancelled';
		}
		const name = await deps.ui.ask({
			title: `New repository in ${project.name}`,
			prompt: 'The name of the repository.',
			validate: value => (isRepositoryName(value.trim()) ? undefined : 'Use letters, digits, dots, dashes and underscores, starting with a letter or digit.'),
		});
		if (name === undefined) {
			return 'cancelled';
		}
		const choices = await deps.source.choices({ kind: 'visibility' });
		let visibility: string | undefined;
		if (choices.ok) {
			visibility = await deps.ui.pick(`Visibility of ${name.trim()}`, choices.value);
			if (visibility === undefined) {
				return 'cancelled';
			}
		}
		return change(deps, { kind: 'create-repository', name: name.trim(), project: project.name, visibility });
	});
}

/** Deletes a repository after naming it and the login. */
export async function deleteRepository(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		if (node?.kind !== 'repository') {
			await deps.ui.inform('Pick a repository in the Control Plane view to delete it.');
			return 'cancelled';
		}
		const path = repositoryPath(node.repository);
		if (path === undefined) {
			await deps.ui.inform(`${node.repository.name} is a mirror of a repository elsewhere, so Entire cannot delete it from here.`);
			return 'cancelled';
		}
		return change(deps, { kind: 'delete-repository', name: node.repository.name, project: node.repository.project, path, cascade: false });
	});
}

/** Makes a repository public or private. */
export async function setRepositoryVisibility(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		if (node?.kind !== 'repository') {
			await deps.ui.inform('Pick a repository in the Control Plane view to change its visibility.');
			return 'cancelled';
		}
		const path = repositoryPath(node.repository);
		if (path === undefined) {
			await deps.ui.inform(`${node.repository.name} is a mirror; its visibility follows the repository it mirrors.`);
			return 'cancelled';
		}
		const choices = await deps.source.choices({ kind: 'visibility' });
		if (!choices.ok) {
			await deps.ui.warn(`Cannot change the visibility: ${choices.detail}.`);
			return 'failed';
		}
		const others = choices.value.filter(value => value !== node.repository.visibility);
		const visibility = await deps.ui.pick(`Visibility of ${path}`, others);
		if (visibility === undefined) {
			return 'cancelled';
		}
		return change(deps, {
			kind: 'set-visibility',
			name: node.repository.name,
			project: node.repository.project,
			path,
			visibility,
			current: node.repository.visibility,
		});
	});
}

/** Deletes a project. */
export async function deleteProject(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		if (node?.kind !== 'project') {
			await deps.ui.inform('Pick a project in the Control Plane view to delete it.');
			return 'cancelled';
		}
		const { project } = node;
		return change(deps, { kind: 'delete-project', name: project.name, id: project.id, repositoryCount: project.repositoryCount });
	});
}

/** Deletes an organisation. */
export async function deleteOrganisation(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		if (node?.kind !== 'organisation') {
			await deps.ui.inform('Pick an organisation in the Control Plane view to delete it.');
			return 'cancelled';
		}
		return change(deps, { kind: 'delete-organisation', name: node.organisation.name, id: node.organisation.id });
	});
}

/** What a grant or an access node is about, as the CLI addresses it. */
function accessTarget(node: ControlNode | undefined): { readonly scope: GrantScope; readonly target: string } | undefined {
	switch (node?.kind) {
		case 'project':
			return { scope: 'project', target: node.project.name };
		case 'organisation':
			return { scope: 'org', target: node.organisation.name };
		case 'repository': {
			const path = repositoryPath(node.repository);
			return path === undefined ? undefined : { scope: 'repo', target: path };
		}
		case 'access':
		case 'grant':
			return { scope: node.scope, target: node.target };
		default:
			return undefined;
	}
}

/** Gives a person a role on a repository, project or organisation. */
export async function grantAccess(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		const where = accessTarget(node);
		if (!where) {
			await deps.ui.inform('Pick a repository, project or organisation in the Control Plane view to share it.');
			return 'cancelled';
		}
		const grantee = await deps.ui.ask({
			title: `Give access to ${where.target}`,
			prompt: 'Who gets access, as provider:handle, for example github:alice.',
			validate: value => (isGrantee(value.trim()) ? undefined : 'Write the provider, a colon and the handle, for example github:alice.'),
		});
		if (grantee === undefined) {
			return 'cancelled';
		}
		const roles = await deps.source.choices({ kind: 'role', scope: where.scope });
		if (!roles.ok) {
			await deps.ui.warn(`Cannot grant access: ${roles.detail}.`);
			return 'failed';
		}
		const role = await deps.ui.pick(`Role for ${grantee.trim()}`, roles.value);
		if (role === undefined) {
			return 'cancelled';
		}
		return change(deps, { kind: 'grant', scope: where.scope, target: where.target, grantee: grantee.trim(), role });
	});
}

/** Takes a person's direct access away. */
export async function revokeAccess(deps: ControlPlaneDependencies, node?: ControlNode): Promise<ControlResult> {
	return guarded(deps, async () => {
		if (node?.kind !== 'grant') {
			await deps.ui.inform('Pick a person under Access in the Control Plane view to remove their access.');
			return 'cancelled';
		}
		let grantee = grantHandle(node.grant);
		if (grantee === undefined) {
			// The CLI's revoke wants a provider-qualified handle and the listing
			// did not give one, so the person says who is meant.
			const typed = await deps.ui.ask({
				title: `Remove access to ${node.target}`,
				prompt: 'The listing does not give a provider-qualified handle. Write it, for example github:alice.',
				validate: value => (isGrantee(value.trim()) ? undefined : 'Write the provider, a colon and the handle.'),
			});
			if (typed === undefined) {
				return 'cancelled';
			}
			grantee = typed.trim();
		}
		return change(deps, { kind: 'revoke', scope: node.scope, target: node.target, grantee });
	});
}

/** Pretty-prints a JSON response and leaves anything else as it came. */
export function formatApiBody(body: string): string {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

/**
 * Makes one call to the control plane's API and shows the response.
 *
 * The call is made once. A read goes ahead as typed; any other method is
 * confirmed first, naming the method, the path and the login. The
 * response opens in a document and is not written to the output channel.
 */
export async function runApiCall(deps: ControlPlaneDependencies): Promise<ControlResult> {
	return guarded(deps, async () => {
		const { ui } = deps;
		const acting = await deps.acting();
		if (!acting) {
			await ui.warn(NO_LOGIN);
			return 'no-login';
		}

		const path = await ui.ask({
			title: 'Call the Entire API',
			prompt: `A path on the API, such as /api/v1/clusters. This runs as ${describeActingLogin(acting)}.`,
			validate: value => (isApiPath(value.trim()) ? undefined : 'Start with a single slash and use no spaces.'),
		});
		if (path === undefined) {
			return 'cancelled';
		}
		const method = await ui.pick('HTTP method', API_METHODS);
		if (method === undefined) {
			return 'cancelled';
		}

		let backend: string | undefined;
		const backends = await deps.api.backends();
		if (backends.ok && backends.value.length > 1) {
			backend = await ui.pick('Which backend', backends.value);
			if (backend === undefined) {
				return 'cancelled';
			}
		}

		const call = { method, path: path.trim(), backend };
		if (!isReadMethod(method) && !(await ui.confirm(apiConfirmation(call, acting)))) {
			return 'cancelled';
		}

		const outcome = await ui.withProgress(`${method} ${call.path}…`, () => deps.api.call(call, acting));
		if (outcome.kind === 'failed') {
			await ui.warn(`The ${method} ${call.path} call as ${describeActingLogin(acting)} failed: ${outcome.detail}.`);
			return 'failed';
		}
		await ui.showApiResult(`${method} ${call.path} as ${describeActingLogin(acting)}`, formatApiBody(outcome.body));
		return 'done';
	});
}
