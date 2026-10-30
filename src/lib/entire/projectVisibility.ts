/**
 * What can be seen of a project, and what to say when it cannot.
 *
 * A project is not a thing everybody can see. It belongs to the logins
 * that can see it, and who those are is the CLI's business rather than
 * the extension's. What the extension has to get right is what it says
 * when a project turns out to be invisible, because there are two
 * reasons a project can be invisible and they are remedied in
 * different places.
 *
 * - A project of Entire's own has grants. A login that owns it can
 *   grant one, and the extension can say exactly which command to run.
 * - A project that mirrors GitHub has no grants. The CLI says so
 *   itself — access is a read-only projection of GitHub, and it is
 *   managed by the source. The remedy is therefore on GitHub, and
 *   telling somebody to change a setting in the editor would be a lie:
 *   no setting makes a GitHub-side membership appear.
 *
 * So the extension classifies the project before it says anything
 * about it. This module is pure: it decides what the situation is and
 * what the words for it are, with no CLI and no editor involved.
 */

/** How a project is stored, and therefore who can be given access to it. */
export type ProjectKind =
	/** A project of Entire's own, named `et/<project>`. */
	| 'native'
	/** A mirror of a GitHub namespace, named `gh/<owner>`. */
	| 'mirror';

/** A project, and the kind of thing it is. */
export interface ProjectReference {
	/** The project as the CLI names it, such as `gh/greysquirr3l`. */
	readonly reference: string;
	/** The kind of project it is. */
	readonly kind: ProjectKind;
	/**
	 * The name the CLI's own commands take for the project.
	 *
	 * `project get` and `project grant add` want a bare name or a
	 * ULID and refuse the `gh/<owner>` or `et/<project>` form, so this
	 * is the part of the reference those commands take.
	 */
	readonly name: string;
}

/**
 * Reads a project reference the way the CLI writes one.
 *
 * The CLI writes a GitHub project `gh/<owner>` and one of its own
 * `et/<project>`. Anything else is not a reference this extension knows
 * how to talk about, and it says so rather than guessing.
 */
export function parseProjectReference(reference: string): ProjectReference | undefined {
	const trimmed = reference.trim();
	const slash = trimmed.indexOf('/');

	if (slash <= 0) {
		return undefined;
	}

	const prefix = trimmed.slice(0, slash).toLowerCase();
	const name = trimmed.slice(slash + 1);

	if (name.length === 0) {
		return undefined;
	}

	switch (prefix) {
		case 'gh':
		case 'github':
			return { reference: trimmed, kind: 'mirror', name };

		case 'et':
		case 'entire':
			return { reference: trimmed, kind: 'native', name };

		default:
			return undefined;
	}
}

/** What the extension found out about who can see a project. */
export type ProjectVisibility =
	| {
			/** The project can be seen. */
			readonly kind: 'visible';
			/** The project it is. */
			readonly project: ProjectReference;
	  }
	| {
			/**
			 * The project cannot be seen from the acting login, but
			 * another saved login can see it.
			 */
			readonly kind: 'other-login-can-see';
			/** The project it is. */
			readonly project: ProjectReference;
			/** The name of the saved login that can see it. */
			readonly context: string;
			/** The handle of that login, as a person knows it. */
			readonly handle: string;
	  }
	| {
			/**
			 * The project cannot be seen from any saved login.
			 *
			 * The remedy is then outside Entire for a mirrored
			 * project, and a grant for one of Entire's own.
			 */
			readonly kind: 'nobody-can-see';
			/** The project it is. */
			readonly project: ProjectReference;
			/**
			 * The provider-qualified account of the acting login.
			 *
			 * A grant names its grantee as `provider:handle`, so the
			 * message can name the person to grant it to.
			 */
			readonly grantee: string | undefined;
	  }
	| {
			/**
			 * The CLI could not be asked.
			 *
			 * Nothing was learned, so nothing is claimed: the CLI's
			 * own reason is passed on instead.
			 */
			readonly kind: 'unknown';
			/** Why the CLI could not be asked. */
			readonly detail: string;
	  };

/**
 * The command that grants a login access to a project of Entire's own.
 *
 * The CLI addresses a project by its bare name and a person by their
 * provider-qualified handle, so the message gives the command in that
 * form rather than in the form the trail commands use.
 *
 * The grantee is provider-qualified — `github:alice` — because the
 * CLI takes it that way. A bare handle would be refused.
 */
export function describeGrantCommand(
	project: ProjectReference,
	grantee: string | undefined,
): string | undefined {
	if (project.kind !== 'native' || !grantee) {
		return undefined;
	}

	return `entire project grant add ${project.name} ${grantee} --role reader`;
}

/**
 * What the extension says when a project cannot be seen.
 *
 * The three cases are told apart, because the remedy differs and only
 * one of them is fixed from the editor:
 *
 * - Another saved login can see it, so the reviewer is offered the
 *   switch and the review carries on under the other login.
 * - No saved login can see it and the project is Entire's own, so the
 *   grant that would fix it is given.
 * - No saved login can see it and the project mirrors GitHub, so the
 *   truth is that the access is decided on GitHub and cannot be
 *   granted from here.
 */
export function describeInvisibleProject(visibility: ProjectVisibility): string {
	switch (visibility.kind) {
		case 'other-login-can-see':
			return `The project ${visibility.project.reference} is not visible from the login Entirely is acting as, but ${visibility.handle} can see it. Entirely can continue the review as ${visibility.handle}.`;

		case 'nobody-can-see': {
			const project = visibility.project;

			if (project.kind === 'mirror') {
				return `The project ${project.reference} is not visible from any login Entirely has saved. A GitHub-mirrored project's access is a read-only projection of GitHub, so it is managed on GitHub rather than from Entire — ask ${project.name} on GitHub to add the account to the project, and it will appear here.`;
			}

			const grant = describeGrantCommand(project, visibility.grantee);

			if (!grant) {
				return `The project ${project.reference} is not visible from any login Entirely has saved. A project of Entire's own is shared by granting it: run \`entire project grant add ${project.name} <provider>:<handle> --role reader\` as a login that can see it.`;
			}

			return `The project ${project.reference} is not visible from any login Entirely has saved. A project of Entire's own is shared by granting it, so run \`${grant}\` as a login that can see it.`;
		}

		case 'unknown':
			return visibility.detail;

		case 'visible':
			return `The project ${visibility.project.reference} is visible.`;
	}
}

/**
 * What the extension says when the CLI reports a project as not found
 * and nothing more is known about who could see it.
 *
 * The CLI answers "not found" for a project that does not exist and for
 * one the acting login cannot see, so the message names both and points
 * at the setting that changes the login.
 */
export function describeUnseenProject(reference: string): string {
	return `The project ${reference} is not visible from the login Entirely is acting as. Check that the project exists, or set entirely.cliContext to a saved login that can see it (entire auth contexts lists them).`;
}

/** One of the choices the extension offers when a project is invisible. */
export interface VisibilityChoice {
	/** The text on the choice. */
	readonly label: string;
	/** The longer explanation of it. */
	readonly description: string;
	/**
	 * The saved login to continue as.
	 *
	 * This is the name the CLI's `--context` takes, not the handle a
	 * person knows the account by.
	 */
	readonly context: string;
}

/**
 * The choices the extension offers when another login can see the
 * project.
 *
 * The choice is the other login, and nothing else: continuing as
 * another account is a deliberate act, and the person making it has to
 * know which account they are acting as.
 */
export function describeVisibilityChoices(
	visibility: ProjectVisibility,
): readonly VisibilityChoice[] {
	if (visibility.kind !== 'other-login-can-see') {
		return [];
	}

	return [
		{
			label: `Continue as ${visibility.handle}`,
			description: `The project ${visibility.project.reference} is visible from this login.`,
			context: visibility.context,
		},
	];
}
