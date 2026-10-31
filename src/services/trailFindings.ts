import {
	TRAIL_DEPTH_COMMANDS,
	choicesOf,
	describeFlag,
	findingArguments,
	findingStatus,
	planFindingApply,
	planFindingWrite,
	typedFlags,
	validateOperandId,
	type ActingLogin,
	type DepthOutcome,
	type FindingInput,
	type TrailFinding,
	type TrailSelector,
} from '../lib/entire';
import { TrailDepthReader } from './trailDepthReads';
import { failureText, readCommandHelp, type DepthDependencies } from './trailDepthSupport';
import type { TrailResult } from './trailService';

/** A change to a finding's lifecycle. */
export type FindingLifecycle = 'resolve' | 'dismiss' | 'reopen';

/** What an update may change. A field left out is not touched. */
export interface FindingFields {
	readonly body?: string;
	readonly severity?: string;
	readonly confidence?: number;
}

const COMMANDS: Readonly<Record<FindingLifecycle, string>> = {
	resolve: TRAIL_DEPTH_COMMANDS.findingResolve,
	dismiss: TRAIL_DEPTH_COMMANDS.findingDismiss,
	reopen: TRAIL_DEPTH_COMMANDS.findingReopen,
};

const STATUS: Readonly<Record<FindingLifecycle, 'resolved' | 'dismissed' | 'open'>> = {
	resolve: 'resolved',
	dismiss: 'dismissed',
	reopen: 'open',
};

/** How a check of a finding's patch came out. */
export type CheckOutcome = { readonly kind: 'applies' } | { readonly kind: 'refused'; readonly detail: string };

/** How applying a finding came out. */
export type ApplyOutcome =
	| { readonly kind: 'applied'; readonly resolved: DepthOutcome | undefined }
	| { readonly kind: 'failed'; readonly detail: string };

function sameText(left: string | undefined, right: string): boolean {
	return (left ?? '').trim() === right.trim();
}

/**
 * Works a change's findings: resolve, dismiss, reopen, update and apply.
 *
 * A write is read back through the listing of every status, so a finding
 * that was resolved or dismissed is still in it; the open-only listing
 * would drop it and make a success look like a failure. Each write runs
 * once as the confirmed login. The reason and body are typed text: they
 * are their own arguments, left out of the reported command line, and
 * what the CLI prints is withheld. Verified against a fake CLI only; the
 * text of `finding show` and the wording of a stale patch are unobserved.
 */
export class TrailFindingService {
	private readonly reader: TrailDepthReader;

	constructor(private readonly deps: DepthDependencies) {
		this.reader = new TrailDepthReader(deps);
	}

	/** The findings of a change, every status. */
	list(selector: TrailSelector, context?: string): Promise<TrailResult<readonly TrailFinding[]>> {
		return this.reader.findings(selector, 'any', context);
	}

	/** What `finding update` offers, from its help: which fields it lists and the severities it names. */
	async updateOptions(): Promise<
		| { readonly ok: true; readonly fields: readonly ('body' | 'severity' | 'confidence')[]; readonly severities: readonly string[] }
		| { readonly ok: false; readonly detail: string }
	> {
		const command = TRAIL_DEPTH_COMMANDS.findingUpdate;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return help;
		}
		const picked = planFindingWrite(command, help.raw, []);
		if (!picked.ok) {
			return picked;
		}
		const fields = (['body', 'severity', 'confidence'] as const).filter(key => picked.flags[key] !== undefined);
		if (fields.length === 0) {
			return { ok: false, detail: "this version of the Entire CLI does not describe any field to change in 'trail finding update'; update the CLI" };
		}
		return { ok: true, fields, severities: choicesOf(describeFlag(picked.table, picked.flags.severity)) };
	}

	/** The CLI's own text for a finding. It has no JSON form, so it is shown as printed and kept in memory only. */
	async show(selector: TrailSelector, id: string, acting?: ActingLogin): Promise<TrailResult<string>> {
		const problem = validateOperandId(id);
		if (problem) {
			return { kind: 'failed', detail: `${problem}.` };
		}
		const command = TRAIL_DEPTH_COMMANDS.findingShow;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const args = await this.deps.trails.selectorArgs(command, selector, findingArguments({}, { kind: 'show', id }));
		const result = await this.deps.runner.run(args, this.deps.trails.actionOptions([], acting?.name));
		return result.ok
			? { kind: 'ok', value: result.stdout }
			: { kind: 'failed', detail: await failureText(this.deps, result, acting) };
	}

	/** Resolves, dismisses or reopens a finding, with an optional reason. */
	async setStatus(
		selector: TrailSelector,
		id: string,
		change: FindingLifecycle,
		reason: string | undefined,
		acting: ActingLogin,
	): Promise<DepthOutcome> {
		const problem = validateOperandId(id);
		if (problem) {
			return { kind: 'failed', detail: `${problem}.` };
		}
		const command = COMMANDS[change];
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const wantsReason = reason !== undefined && reason.length > 0;
		const picked = planFindingWrite(command, help.raw, wantsReason ? ['reason'] : []);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const args = await this.deps.trails.selectorArgs(
			command,
			selector,
			findingArguments(picked.flags, { kind: change, id, reason: wantsReason ? reason : undefined }),
		);
		const result = await this.deps.runner.run(args, this.deps.trails.actionOptions(typedFlags(picked.flags, ['reason']), acting.name));
		if (!result.ok) {
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}
		return this.confirmStatus(selector, id, STATUS[change], acting);
	}

	/** Changes a finding's body, severity or confidence. */
	async update(selector: TrailSelector, id: string, fields: FindingFields, acting: ActingLogin): Promise<DepthOutcome> {
		const problem = validateOperandId(id);
		if (problem) {
			return { kind: 'failed', detail: `${problem}.` };
		}
		const needs = [
			...(fields.body !== undefined ? (['body'] as const) : []),
			...(fields.severity !== undefined ? (['severity'] as const) : []),
			...(fields.confidence !== undefined ? (['confidence'] as const) : []),
		];
		if (needs.length === 0) {
			return { kind: 'failed', detail: 'there is nothing to change.' };
		}
		const command = TRAIL_DEPTH_COMMANDS.findingUpdate;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planFindingWrite(command, help.raw, needs);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const input: FindingInput = { kind: 'update', id, ...fields };
		const args = await this.deps.trails.selectorArgs(command, selector, findingArguments(picked.flags, input));
		const result = await this.deps.runner.run(args, this.deps.trails.actionOptions(typedFlags(picked.flags, ['body']), acting.name));
		if (!result.ok) {
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}

		const found = await this.found(selector, id, acting);
		if (!found) {
			return { kind: 'unconfirmed', detail: 'The finding is not in the fresh listing.' };
		}
		const wrong: string[] = [];
		if (fields.body !== undefined && !sameText(found.body, fields.body)) {
			wrong.push('body');
		}
		if (fields.severity !== undefined && found.severity?.trim().toLowerCase() !== fields.severity.trim().toLowerCase()) {
			wrong.push('severity');
		}
		if (fields.confidence !== undefined && found.confidence !== fields.confidence) {
			wrong.push('confidence');
		}
		return wrong.length === 0
			? { kind: 'done' }
			: { kind: 'unconfirmed', detail: `The fresh listing does not show the new ${wrong.join(', ')}.` };
	}

	/** Asks the CLI whether a finding's patch applies, without touching a file. */
	async check(selector: TrailSelector, id: string, acting: ActingLogin): Promise<CheckOutcome> {
		const prepared = await this.prepareApply(selector, id, false, true);
		if (prepared.kind === 'failed') {
			return { kind: 'refused', detail: prepared.detail };
		}
		const result = await this.deps.runner.run(prepared.args, this.deps.trails.actionOptions([], acting.name));
		return result.ok ? { kind: 'applies' } : { kind: 'refused', detail: await failureText(this.deps, result, acting) };
	}

	/**
	 * Applies a finding's patch to the working tree, once.
	 *
	 * The caller has checked for unsaved work, run the check and asked.
	 * The file change is reported as the CLI's own word, because the
	 * extension reads no diff; the status is read back only when the
	 * apply was asked to resolve the finding.
	 */
	async apply(selector: TrailSelector, id: string, options: { readonly resolve: boolean }, acting: ActingLogin): Promise<ApplyOutcome> {
		const prepared = await this.prepareApply(selector, id, options.resolve, false);
		if (prepared.kind === 'failed') {
			return prepared;
		}
		const result = await this.deps.runner.run(prepared.args, this.deps.trails.actionOptions([], acting.name));
		if (!result.ok) {
			return { kind: 'failed', detail: await failureText(this.deps, result, acting) };
		}
		return { kind: 'applied', resolved: options.resolve ? await this.confirmStatus(selector, id, 'resolved', acting) : undefined };
	}

	private async prepareApply(
		selector: TrailSelector,
		id: string,
		resolve: boolean,
		check: boolean,
	): Promise<{ readonly kind: 'ready'; readonly args: readonly string[] } | { readonly kind: 'failed'; readonly detail: string }> {
		const problem = validateOperandId(id);
		if (problem) {
			return { kind: 'failed', detail: `${problem}.` };
		}
		const command = TRAIL_DEPTH_COMMANDS.findingApply;
		const help = await readCommandHelp(this.deps.runner, command, this.deps.workspaceRoot());
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = planFindingApply(help.raw, resolve);
		if (!picked.ok) {
			return { kind: 'failed', detail: picked.detail };
		}
		const args = await this.deps.trails.selectorArgs(command, selector, findingArguments(picked.flags, { kind: 'apply', id, check, resolve }));
		return { kind: 'ready', args };
	}

	private async found(selector: TrailSelector, id: string, acting: ActingLogin): Promise<TrailFinding | undefined> {
		const listed = await this.reader.findings(selector, 'any', acting.name);
		return listed.kind === 'ok' ? listed.value.find(item => item.id === id) : undefined;
	}

	private async confirmStatus(
		selector: TrailSelector,
		id: string,
		expected: 'resolved' | 'dismissed' | 'open',
		acting: ActingLogin,
	): Promise<DepthOutcome> {
		const found = await this.found(selector, id, acting);
		if (!found) {
			return { kind: 'unconfirmed', detail: 'The finding is not in the fresh listing.' };
		}
		return findingStatus(found) === expected
			? { kind: 'done' }
			: { kind: 'unconfirmed', detail: `The fresh listing still shows the finding as ${findingStatus(found)}.` };
	}
}
