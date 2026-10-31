import {
	TRAIL_DEPTH_COMMANDS,
	anyStatusValue,
	decodeDiscussion,
	decodeTrailFindings,
	describeFlag,
	discussionArguments,
	findingArguments,
	planFindingList,
	planJsonRead,
	unwrap,
	validateOperandId,
	type DiscussionView,
	type TrailComment,
	type TrailFinding,
	type TrailSelector,
} from '../lib/entire';
import { readCommandHelp, type DepthDependencies } from './trailDepthSupport';
import type { TrailResult } from './trailService';

/** How a finding listing is scoped. */
export type FindingScope = 'any' | 'open';

/** The reads the depth flows are checked against. Each is a fresh call, as the login it is given. */
export class TrailDepthReader {
	constructor(private readonly deps: DepthDependencies) {}

	/** The discussions of a change. */
	discussions(selector: TrailSelector, context?: string): Promise<TrailResult<readonly TrailComment[]>> {
		return this.deps.trails.comments(selector, context);
	}

	/**
	 * One discussion and its messages.
	 *
	 * The answer's shape was not observed, so it is decoded tolerantly:
	 * an answer that holds no readable messages comes back with
	 * `messages` undefined rather than failing. Bodies stay in memory.
	 */
	async discussion(selector: TrailSelector, id: string, context?: string): Promise<TrailResult<DiscussionView>> {
		const problem = validateOperandId(id);
		if (problem) {
			return { kind: 'failed', detail: problem };
		}
		const command = TRAIL_DEPTH_COMMANDS.commentShow;
		const cwd = this.deps.workspaceRoot();
		const help = await readCommandHelp(this.deps.runner, command, cwd);
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planJsonRead(command, help.raw);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const args = await this.deps.trails.selectorArgs(command, selector, discussionArguments(picked.flags, { kind: 'show', id }));
		const result = await this.deps.runner.runJson(args, decodeDiscussion, {
			...this.deps.trails.actionOptions([], context),
		});
		return result.ok
			? { kind: 'ok', value: result.value }
			: { kind: 'failed', detail: result.stderr.trim().length > 0 ? result.stderr : result.detail };
	}

	/**
	 * The findings of a change.
	 *
	 * `any` lists every status, dismissed ones included, so a finding that
	 * was resolved or dismissed stays in the list and a write can be read
	 * back. The value for it is read from the status flag's own help line.
	 */
	async findings(selector: TrailSelector, scope: FindingScope, context?: string): Promise<TrailResult<readonly TrailFinding[]>> {
		const command = TRAIL_DEPTH_COMMANDS.findingList;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planFindingList(help.raw);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const any = scope === 'any';
		if (any && !picked.flags.status) {
			return {
				kind: 'failed',
				detail: "this version of the Entire CLI does not describe the status flag of 'trail finding list'; update the CLI",
			};
		}
		const anyValue = anyStatusValue(describeFlag(picked.table, picked.flags.status));
		const args = await this.deps.trails.selectorArgs(
			command,
			selector,
			findingArguments(picked.flags, { kind: 'list', any }, anyValue),
		);
		const result = await this.deps.runner.runJson(args, value => unwrap(decodeTrailFindings(value)), {
			...this.deps.trails.actionOptions([], context),
		});
		return result.ok
			? { kind: 'ok', value: result.value }
			: { kind: 'failed', detail: result.stderr.trim().length > 0 ? result.stderr : result.detail };
	}
}
