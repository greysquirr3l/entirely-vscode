import {
	decodeRepoIdentity,
	decodeTrailApprovals,
	decodeTrailComments,
	decodeTrailDetail,
	decodeTrailFindings,
	decodeTrailList,
	decodeTrailMergePlan,
	describeUnseenProject,
	describeTrailFailure,
	formatTrailSelector,
	isProjectInvisible,
	parseForgeRef,
	refusesCommentFromAgentSession,
	unwrap,
	type Trail,
	type TrailApproval,
	type TrailComment,
	type TrailFinding,
	type TrailList,
	type TrailMergePlan,
	type TrailSelector,
} from '../lib/entire';
import type { CliRunner, RunOptions } from './cli';

/**
 * The outcome of a trail command.
 *
 * Every result is a value: the CLI may be missing, the network may be
 * down, and the trail may not be there. None of those throw.
 */
export type TrailResult<T> =
	| { readonly kind: 'ok'; readonly value: T }
	| { readonly kind: 'failed'; readonly detail: string };

/** A trail and the project it belongs to. */
export interface TrailDetail {
	readonly trail: Trail;
	/** The project the trail belongs to, as the CLI names it. */
	readonly project: string;
}

/**
 * What a note on a change turned out to be.
 *
 * A note is a discussion when the CLI accepted a comment, and a finding
 * when the CLI refused a comment from an agent session and the finding
 * was posted instead. The extension says which, because a reviewer
 * reading the trail should know what to expect to find there.
 */
export type TrailNote =
	| { readonly kind: 'comment'; readonly comments: readonly TrailComment[] }
	| { readonly kind: 'finding'; readonly findings: readonly TrailFinding[] };

/**
 * The workspace as the CLI sees it.
 *
 * The project is the namespace the trails of this repository live in,
 * and the repository is the one the commands are about. Both come from
 * the CLI, because the CLI is the one that knows which forge the
 * repository is on and which project it belongs to.
 */
export interface TrailWorkspace {
	/** The project as the CLI names it, such as `gh/greysquirr3l`. */
	readonly project: string;
	/** The repository as the CLI names it, such as `gh/greysquirr3l/app`. */
	readonly repository: string;
	/** The repository's own name, which a change is numbered within. */
	readonly name: string;
}

/** What the service needs to do its job. */
export interface TrailServiceOptions {
	readonly runner: CliRunner;
	/** The root of the workspace, when there is one. */
	readonly workspaceRoot: () => string | undefined;
	/**
	 * The forge handle of the login the extension is acting as.
	 *
	 * Used to attribute an approval or a comment to the acting login.
	 */
	readonly actingHandle: () => string | undefined;
	/**
	 * How long, in milliseconds, a command that changes something may run.
	 *
	 * A check out may fetch and a merge talks to the forge, so they get
	 * longer than a read. Defaults to a minute.
	 */
	readonly actionTimeoutMs?: () => number;
}

/** How long a command that changes something may run unless told otherwise. */
export const DEFAULT_ACTION_TIMEOUT_MS = 60_000;

/**
 * Whether a command's usage text mentions the `--trail` flag.
 *
 * The usage text is read as the CLI writes it, and the flag is looked
 * for as a whole word so that a command that mentions `--trails` or
 * `--trail-id` is not mistaken for one that takes `--trail`.
 */
export function hasTrailFlag(usage: string): boolean {
	return /(^|\s)--trail(\s|$)/m.test(usage);
}

/**
 * How a trail command takes the trail it is about.
 *
 * The CLI's commands do not agree on this: some take the trail as a
 * positional argument and some as a `--trail` flag. The form is read
 * from the CLI's own usage at runtime rather than written down here,
 * because the CLI is the source of truth for how it takes its arguments.
 */
type SelectorForm = 'positional' | 'flag';

/**
 * The usage of the CLI's commands, kept as it is read.
 *
 * The usage is read once per command and kept, because reading it costs
 * a process and the answer does not change while the extension runs.
 */
export class TrailUsage {
	private readonly cache = new Map<string, SelectorForm>();

	constructor(private readonly runner: CliRunner) {}

	/** How the given command takes its trail. */
	async form(command: string): Promise<SelectorForm> {
		const known = this.cache.get(command);
		if (known) {
			return known;
		}

		const result = await this.runner.usage(command);

		// A CLI that could not be asked is a CLI that could not run the
		// command either, so the form does not matter yet. The flag is
		// the guess, and it is not kept: a lookup that failed once says
		// nothing about the CLI that answers the next one.
		if (!result.ok) {
			return 'flag';
		}

		const form: SelectorForm = hasTrailFlag(result.value.raw) ? 'flag' : 'positional';

		this.cache.set(command, form);

		return form;
	}
}

/**
 * The project and repository the workspace is on.
 *
 * The CLI names a GitHub project `gh/<owner>` and one of its own
 * `et/<project>`, and the namespace of the repository gives both. The
 * repository is read from the CLI rather than worked out from the git
 * remote, because the CLI is the one that knows which forge the
 * repository is on.
 */
export async function readTrailWorkspace(
	runner: CliRunner,
	cwd: string | undefined,
): Promise<TrailResult<TrailWorkspace>> {
	const result = await runner.runJson(['repo', 'view', '--json'], value =>
		unwrap(decodeRepoIdentity(value)),
		{ cwd },
	);

	if (!result.ok) {
		return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	const path = result.value.ref.path;
	const ref = parseForgeRef(path);
	if (!ref) {
		return {
			kind: 'failed',
			detail: `the CLI named the repository "${path}", which is not a forge reference`,
		};
	}

	// The project namespace follows the forge the repository is on: a
	// GitHub repository lives in the project of its owner, and one of
	// Entire's own lives in the project of its own name.
	const project =
		ref.forge === 'entire'
			? `et/${ref.namespace}`
			: ref.forge === 'github'
				? `gh/${ref.namespace}`
				: undefined;

	if (!project) {
		return {
			kind: 'failed',
			detail: `the repository is on ${ref.forge}, which has no trails`,
		};
	}

	return {
		kind: 'ok',
		value: {
			project,
			repository: `${path.replace(/^\//, '')}`,
			name: ref.name,
		},
	};
}

/**
 * Talks to the CLI about trails.
 *
 * The extension never re-implements a trail: every question is put to
 * the CLI's own commands, and every answer is read from the CLI's own
 * JSON. What this service adds is the ability to say which form a
 * command takes and what went wrong.
 */
export class TrailService {
	private readonly usage: TrailUsage;

	constructor(private readonly options: TrailServiceOptions) {
		this.usage = new TrailUsage(options.runner);
	}

	/** The project and repository the workspace is on. */
	async workspace(): Promise<TrailResult<TrailWorkspace>> {
		return readTrailWorkspace(this.options.runner, this.options.workspaceRoot());
	}

	/** Lists the trails of a project. */
	async list(project: string, repo?: string): Promise<TrailResult<TrailList>> {
		const args = ['trail', 'list', '--project', project, '--json'];

		if (repo) {
			args.push('--repo', repo);
		}

		const result = await this.options.runner.runJson(args, value => unwrap(decodeTrailList(value)), {
			cwd: this.options.workspaceRoot(),
		});

		if (result.ok) {
			return { kind: 'ok', value: result.value };
		}

		// A project belongs to the logins that can see it. When the
		// acting login cannot see it, the CLI says so in a form that
		// names a JSON schema rather than a cause, so the cause is
		// named here instead.
		if (isProjectInvisible(result.stderr)) {
			return { kind: 'failed', detail: describeUnseenProject(project) };
		}

		return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/** Reads one trail and the project it belongs to. */
	async show(selector: TrailSelector): Promise<TrailResult<TrailDetail>> {
		const args = await this.selectorArgs('trail show', selector, ['--json']);

		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeTrailDetail(value)),
			{ cwd: this.options.workspaceRoot() },
		);

		if (!result.ok) {
			return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
		}

		return {
			kind: 'ok',
			value: { trail: result.value.trail, project: result.value.project.reference },
		};
	}

	/** Reads the approvals recorded against a change. */
	async approvals(selector: TrailSelector): Promise<TrailResult<readonly TrailApproval[]>> {
		const args = await this.selectorArgs('trail approvals', selector, ['--json']);

		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeTrailApprovals(value)),
			{ cwd: this.options.workspaceRoot() },
		);

		return result.ok
			? { kind: 'ok', value: result.value }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/** Reads the discussions on a change. */
	async comments(selector: TrailSelector): Promise<TrailResult<readonly TrailComment[]>> {
		const args = await this.selectorArgs('trail comment list', selector, ['--json']);

		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeTrailComments(value)),
			{ cwd: this.options.workspaceRoot() },
		);

		return result.ok
			? { kind: 'ok', value: result.value }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/** Reads the findings recorded against a change. */
	async findings(selector: TrailSelector): Promise<TrailResult<readonly TrailFinding[]>> {
		const args = await this.selectorArgs('trail finding list', selector, ['--json']);

		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeTrailFindings(value)),
			{ cwd: this.options.workspaceRoot() },
		);

		return result.ok
			? { kind: 'ok', value: result.value }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/**
	 * Approves a change.
	 *
	 * The CLI attributes the approval to the login it is acting as, so
	 * the approval is read back afterwards: the extension says who
	 * approved only once the CLI has said so.
	 */
	async approve(
		selector: TrailSelector,
		message: string | undefined,
	): Promise<TrailResult<readonly TrailApproval[]>> {
		const args = await this.selectorArgs('trail approve', selector);

		if (message && message.length > 0) {
			args.push('--message', message);
		}

		const result = await this.options.runner.run(args, this.actionOptions(['--message']));

		if (!result.ok) {
			return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
		}

		return this.approvals(selector);
	}

	/**
	 * Records a comment on a change.
	 *
	 * The CLI attributes a comment to the login it is acting as, and
	 * the comment is read back afterwards so that the extension can say
	 * whose comment it is rather than assuming.
	 *
	 * The CLI refuses a comment from an agent session and points at its
	 * finding command instead. The extension running inside an agent
	 * session inherits that refusal, so the finding is posted in its
	 * place: the review reaches the trail either way, and the caller
	 * is told which form it took.
	 */
	async comment(
		selector: TrailSelector,
		body: string,
		title: string | undefined,
	): Promise<TrailResult<TrailNote>> {
		const args = await this.selectorArgs('trail comment add', selector);

		args.push('--body', body);

		if (title && title.length > 0) {
			args.push('--title', title);
		}

		const result = await this.options.runner.run(args, this.actionOptions(['--body', '--title']));

		if (!result.ok) {
			if (!refusesCommentFromAgentSession(result.stderr)) {
				return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
			}

			const finding = await this.finding(selector, body, title);

			return finding.kind === 'ok'
				? { kind: 'ok', value: { kind: 'finding', findings: finding.value } }
				: finding;
		}

		const comments = await this.comments(selector);

		return comments.kind === 'ok'
			? { kind: 'ok', value: { kind: 'comment', comments: comments.value } }
			: comments;
	}

	/**
	 * Records a finding against a change.
	 *
	 * A finding is what an agent posts: the CLI refuses a comment from
	 * an agent session and points at this command instead.
	 *
	 * A finding carries its text in the body and has no separate title,
	 * so a title is folded into the body rather than passed as a flag
	 * the CLI does not take.
	 */
	async finding(
		selector: TrailSelector,
		body: string,
		title: string | undefined,
	): Promise<TrailResult<readonly TrailFinding[]>> {
		const args = await this.selectorArgs('trail finding add', selector);

		args.push('--body', title && title.length > 0 ? `${title}\n\n${body}` : body);

		const result = await this.options.runner.run(args, this.actionOptions(['--body']));

		if (!result.ok) {
			return { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
		}

		return this.findings(selector);
	}

	/**
	 * Asks what a merge would do, without doing it.
	 *
	 * The CLI's dry run is what names the branch, the base and the
	 * blockers, so the confirmation says what the CLI said.
	 */
	async mergePlan(selector: TrailSelector): Promise<TrailResult<TrailMergePlan>> {
		const args = await this.selectorArgs('trail merge', selector, ['--dry-run', '--json']);

		const result = await this.options.runner.run(args, {
			cwd: this.options.workspaceRoot(),
		});

		// A dry run that says the merge cannot happen still answers the
		// question: it says why. The CLI exits non-zero for that, and
		// the answer is in its output rather than in its status.
		const payload = this.readJson(result.stdout);
		if (!payload) {
			return { kind: 'failed', detail: result.ok ? result.stdout : result.detail };
		}

		const decoded = decodeTrailMergePlan(payload);
		if (!decoded.ok) {
			return { kind: 'failed', detail: decoded.issue.detail };
		}

		return { kind: 'ok', value: decoded.value };
	}

	/**
	 * Merges a change.
	 *
	 * The merge is only ever run after the user has confirmed it, so
	 * this is called from the command that confirmed it and from nowhere
	 * else.
	 */
	async merge(selector: TrailSelector): Promise<TrailResult<TrailMergePlan>> {
		const args = await this.selectorArgs('trail merge', selector, ['--json']);

		const result = await this.options.runner.run(args, this.actionOptions());

		// The CLI exits non-zero for a refused merge, and its payload
		// says whether the merge happened. Both have to agree before the
		// extension reports a merge.
		if (!result.ok) {
			const payload = this.readJson(result.stdout);
			const refused = payload ? decodeTrailMergePlan(payload) : undefined;
			const why = refused?.ok ? [...refused.value.blockers, ...refused.value.reasons].join('; ') : '';

			return {
				kind: 'failed',
				detail: why.length > 0 ? why : describeTrailFailure(result.detail, result.stderr),
			};
		}

		const payload = this.readJson(result.stdout);
		if (!payload) {
			return { kind: 'failed', detail: 'the CLI did not report whether the merge happened' };
		}

		const decoded = decodeTrailMergePlan(payload);
		if (!decoded.ok) {
			return { kind: 'failed', detail: decoded.issue.detail };
		}

		if (!decoded.value.merged) {
			const why = [...decoded.value.blockers, ...decoded.value.reasons].join('; ');

			return {
				kind: 'failed',
				detail: why.length > 0 ? why : 'the CLI did not merge the change',
			};
		}

		return { kind: 'ok', value: decoded.value };
	}

	/**
	 * Checks out the branch of a change.
	 *
	 * A checkout moves the working tree, so the caller checks the editor
	 * for unsaved work before asking for this.
	 */
	async checkout(selector: TrailSelector, branch: string | undefined): Promise<TrailResult<string>> {
		const args = await this.selectorArgs('trail checkout', selector);

		if (branch && branch.length > 0) {
			args.push('--branch', branch);
		}

		const result = await this.options.runner.run(args, this.actionOptions());

		return result.ok
			? { kind: 'ok', value: result.stdout.trim() }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/**
	 * Links a branch to a trail.
	 *
	 * The CLI links a branch to a *project* trail, so a change is
	 * resolved to its parent trail before the branch is linked.
	 */
	async link(selector: TrailSelector, branch: string): Promise<TrailResult<string>> {
		const args = await this.selectorArgs('trail link', selector);

		args.push('--branch', branch);

		const result = await this.options.runner.run(args, this.actionOptions());

		return result.ok
			? { kind: 'ok', value: result.stdout.trim() }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/**
	 * Removes a branch from a trail.
	 *
	 * The CLI keeps the branch, its code, reviews and sessions; only the
	 * link between the branch and the trail goes.
	 */
	async unlink(selector: TrailSelector, branch: string): Promise<TrailResult<string>> {
		const args = await this.selectorArgs('trail unlink', selector);

		args.push('--branch', branch);

		const result = await this.options.runner.run(args, this.actionOptions());

		return result.ok
			? { kind: 'ok', value: result.stdout.trim() }
			: { kind: 'failed', detail: describeTrailFailure(result.detail, result.stderr) };
	}

	/**
	 * Builds the arguments that name a trail.
	 *
	 * The form is the CLI's, read from its own usage, so the extension
	 * follows the CLI rather than assuming which way round it is.
	 */
	private async selectorArgs(
		command: string,
		selector: TrailSelector,
		trailing: readonly string[] = [],
	): Promise<string[]> {
		const form = await this.usage.form(command);
		const name = formatTrailSelector(selector);

		// A command is a path of words, and the CLI takes each word as
		// its own argument: `entire trail approve <change>`.
		const words = command.trim().split(/\s+/).filter(word => word.length > 0);

		const args = form === 'flag' ? [...words, '--trail', name] : [...words, name];

		return [...args, ...trailing];
	}

	/**
	 * The options for a command that changes something.
	 *
	 * The flags named here have their values left out of the reported
	 * command line, because review text does not go to the output channel.
	 */
	private actionOptions(redactFlags: readonly string[] = []): RunOptions {
		return {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.actionTimeoutMs?.() ?? DEFAULT_ACTION_TIMEOUT_MS,
			redactFlags,
		};
	}

	/** Reads the JSON out of a command's output, when it is JSON. */
	private readJson(stdout: string): unknown {
		const trimmed = stdout.trim();
		if (trimmed.length === 0) {
			return undefined;
		}

		try {
			return JSON.parse(trimmed);
		} catch {
			return undefined;
		}
	}
}
