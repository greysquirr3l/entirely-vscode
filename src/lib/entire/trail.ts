import {
	decodeArray,
	decodeRecord,
	fields,
	optionalBoolean,
	optionalNumber,
	optionalString,
	requireNumber,
	requireString,
	type DecodeResult,
} from './decode';

/**
 * How the CLI names a trail.
 *
 * A project trail and a change are numbered separately, and the CLI says
 * so: *"Project trails and changes are numbered separately: never pass
 * `<P>` where a change is expected, or `<n>` where a project trail is."*
 * The two are kept apart here so that a number can never be passed where
 * the other kind is wanted.
 */
export type TrailSelector =
	/** A project trail, by its project-wide number. */
	| { readonly kind: 'trail'; readonly number: number }
	/** A project trail, by its own id. */
	| { readonly kind: 'trail-id'; readonly id: string }
	/** A change on a trail, by the repository it is in and its number there. */
	| { readonly kind: 'change'; readonly repository: string; readonly number: number };

/**
 * The selector as the CLI's commands take it.
 *
 * A change is named `<repo>/<number>`, a project trail by its number or
 * its id. The two forms are never mixed: the CLI rejects a number where
 * a change is expected and vice versa.
 */
export function formatTrailSelector(selector: TrailSelector): string {
	switch (selector.kind) {
		case 'trail':
			return String(selector.number);
		case 'trail-id':
			return selector.id;
		case 'change':
			return `${selector.repository}/${selector.number}`;
	}
}

/**
 * A change on a trail.
 *
 * A change is one branch in one repository. It is the thing a reviewer
 * approves, comments on and merges.
 */
export interface TrailChange {
	readonly id: string;
	/** The repository the change is in, as the CLI names it. */
	readonly repository: string;
	/**
	 * The branch the change lives on.
	 *
	 * The CLI sends an empty string for a change that has no branch, such as
	 * one that was merged and whose branch is gone, so it can be empty. Use
	 * `branchLabel` to show it.
	 */
	readonly branch: string;
	/** The change's number within its repository. */
	readonly number: number;
	readonly title?: string;
	readonly status?: string;
	/** Whether the change carries code. */
	readonly hasCodeChanges?: boolean;
	readonly url?: string;
	/**
	 * Whether `trail show` reached the trail through this change.
	 *
	 * Read when present and never relied on: the CLI's help says a change
	 * selector shows the parent trail, and a payload without the flag is
	 * normal.
	 */
	readonly current?: boolean;
}

/** What a change without a branch is called. */
export const NO_BRANCH = 'no branch';

/** The branch of a change, or the words for a change that has none. */
export function branchLabel(change: { readonly branch: string }): string {
	return change.branch.trim().length > 0 ? change.branch : NO_BRANCH;
}

/** The state a trail is in. */
export type TrailStatus = 'open' | 'closed';

/**
 * A project trail.
 *
 * A trail is the unit of work: it brings together intent, code, agent
 * sessions and review evidence across the repositories it spans.
 */
export interface Trail {
	readonly id: string;
	/** The trail's number within its project. */
	readonly number: number;
	readonly title?: string;
	readonly body?: string;
	readonly status: TrailStatus;
	readonly type?: string;
	readonly priority?: string;
	readonly url?: string;
	/**
	 * The changes on the trail.
	 *
	 * The CLI only sends the changes with some of its answers, so an
	 * empty list means the trail has no changes *or* that the answer
	 * did not carry them.
	 */
	readonly changes: readonly TrailChange[];
	/**
	 * Whether the answer may have left something out.
	 *
	 * The CLI marks a trail whose details it did not fully load.
	 */
	readonly partial: boolean;
}

/** The project a trail belongs to. */
export interface TrailProject {
	readonly id: string;
	readonly name: string;
	/** The forge the project is on. */
	readonly provider: string;
	/** The project as the CLI names it, such as `gh/greysquirr3l`. */
	readonly reference: string;
}

/** One approval recorded against a change. */
export interface TrailApproval {
	readonly id: string;
	/** The forge handle of the account that gave the approval. */
	readonly author: string;
	/** What the approval was, such as `approved`. */
	readonly event: string;
	readonly body?: string;
	readonly commitSha?: string;
	readonly createdAt?: string;
}

/** One discussion on a change. */
export interface TrailComment {
	readonly id: string;
	readonly title?: string;
	/** Whether the discussion has been resolved. */
	readonly resolved: boolean;
	/** The forge handle of the last person to write in it. */
	readonly lastMessageAuthor?: string;
	readonly lastMessageAt?: string;
	readonly createdAt?: string;
	/** How many messages the discussion holds. */
	readonly messageCount?: number;
}

/** One finding recorded against a change. */
export interface TrailFinding {
	readonly id: string;
	readonly title?: string;
	readonly body?: string;
	readonly state?: string;
	readonly severity?: string;
	readonly file?: string;
	readonly line?: number;
	readonly createdAt?: string;
}

/**
 * What a merge would do.
 *
 * This is the CLI's own answer to `trail merge --dry-run`: it says what
 * would be merged, whether it can be, and what stands in the way.
 */
export interface TrailMergePlan {
	/** The change that would be merged. */
	readonly change: string;
	/** The trail the change belongs to. */
	readonly trail?: number;
	/** The project the trail belongs to. */
	readonly project?: string;
	/** The branch that would be merged. */
	readonly branch?: string;
	/** The branch it would be merged into. */
	readonly base?: string;
	/** The commit that would be merged. */
	readonly headSha?: string;
	/** Whether the merge can go ahead. */
	readonly mergeable: boolean;
	/** How the two branches relate, such as `clean` or `conflict`. */
	readonly conflictStatus?: string;
	/** What stands in the way, when something does. */
	readonly blockers: readonly string[];
	/** The CLI's own reasons, in its words. */
	readonly reasons: readonly string[];
	/** Whether a gate would be bypassed by merging anyway. */
	readonly wouldBypass: boolean;
	/**
	 * Whether the CLI says the merge happened, when it says anything.
	 *
	 * Absent when the payload has no `merged` key: the documentation does
	 * not show the success payload, so absence is not the same as false.
	 */
	readonly merged?: boolean;
}

/** The list of trails the CLI returned. */
export interface TrailList {
	readonly items: readonly Trail[];
	/** The cursor for the next page, when there is one. */
	readonly nextPageToken?: string;
}

/**
 * The state of the gate on a change.
 *
 * The gate is what an approval opens. Whether it is open is the CLI's to
 * say, so it is read from the CLI's own merge check rather than counted
 * from approvals. See `readTrailGate`.
 */
export type TrailGate =
	| {
			/** The CLI says every gate is satisfied. */
			readonly kind: 'open';
			/** The approvals recorded against the change. */
			readonly approvals: number;
	  }
	| {
			/** The CLI names the approval gate among the blockers. */
			readonly kind: 'awaiting-approval';
			readonly approvals: number;
			/** The blockers, in the CLI's words. */
			readonly blockers: readonly string[];
	  }
	| {
			/** Another gate blocks the change, such as CI or a conflict. */
			readonly kind: 'blocked';
			readonly approvals: number;
			readonly blockers: readonly string[];
	  }
	| {
			/** The CLI could not be asked, so nothing is claimed. */
			readonly kind: 'unknown';
			readonly detail: string;
	  };

/** Reads the state of a string array, leaving out what is not a string. */
function decodeStringArray(value: unknown, path: string): readonly string[] {
	if (value === undefined || value === null) {
		return [];
	}

	const rows = decodeArray(value, path);
	if (!rows.ok) {
		return [];
	}

	const read: string[] = [];
	for (const row of rows.value) {
		if (typeof row === 'string') {
			read.push(row);
		}
	}

	return read;
}

/**
 * Reads the changes on a trail.
 *
 * A change the CLI has added a field to is left out rather than failing
 * the whole trail: one unrecognised change must not hide every other
 * one on the trail.
 */
function decodeChanges(value: unknown, path: string): readonly TrailChange[] {
	if (value === undefined || value === null) {
		return [];
	}

	const rows = decodeArray(value, path);
	if (!rows.ok) {
		return [];
	}

	const changes: TrailChange[] = [];
	for (const [index, row] of rows.value.entries()) {
		const change = decodeTrailChange(row, `${path}[${index}]`);
		if (change.ok) {
			changes.push(change.value);
		}
	}

	return changes;
}

/** Reads one change on a trail. */
export function decodeTrailChange(value: unknown, path: string): DecodeResult<TrailChange> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const repository = requireString(read, 'repository');
	if (!repository.ok) {
		return repository;
	}

	// An empty branch is a real answer, and a missing one is read the same
	// way: a change without a branch must not drop out of its trail.
	const branch = optionalString(read, 'branch');
	if (!branch.ok) {
		return branch;
	}

	const number = requireNumber(read, 'number');
	if (!number.ok) {
		return number;
	}

	const title = optionalString(read, 'title');
	if (!title.ok) {
		return title;
	}

	const status = optionalString(read, 'status');
	if (!status.ok) {
		return status;
	}

	const url = optionalString(read, 'url');
	if (!url.ok) {
		return url;
	}

	const hasCodeChanges = optionalBoolean(read, 'hasCodeChanges');
	const current = optionalBoolean(read, 'current');

	return {
		ok: true,
		value: {
			id: id.value,
			repository: repository.value,
			branch: branch.value ?? '',
			number: number.value,
			title: title.value,
			status: status.value,
			hasCodeChanges,
			url: url.value,
			...(current === undefined ? {} : { current }),
		},
	};
}

/** Reads the status of a trail, treating an unknown status as open. */
function decodeStatus(value: string | undefined): TrailStatus {
	return value === 'closed' ? 'closed' : 'open';
}

/** Reads one trail. */
export function decodeTrail(value: unknown, path: string): DecodeResult<Trail> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const number = requireNumber(read, 'number');
	if (!number.ok) {
		return number;
	}

	const title = optionalString(read, 'title');
	if (!title.ok) {
		return title;
	}

	const body = optionalString(read, 'body');
	if (!body.ok) {
		return body;
	}

	const status = optionalString(read, 'status');
	if (!status.ok) {
		return status;
	}

	const type = optionalString(read, 'type');
	if (!type.ok) {
		return type;
	}

	const priority = optionalString(read, 'priority');
	if (!priority.ok) {
		return priority;
	}

	const url = optionalString(read, 'url');
	if (!url.ok) {
		return url;
	}

	const partial = optionalBoolean(read, 'isPossiblyPartial');

	return {
		ok: true,
		value: {
			id: id.value,
			number: number.value,
			title: title.value,
			body: body.value,
			status: decodeStatus(status.value),
			type: type.value,
			priority: priority.value,
			url: url.value,
			changes: decodeChanges(read.record.changes, `${path}.changes`),
			partial: partial ?? false,
		},
	};
}

/**
 * Reads the list of trails.
 *
 * A trail the CLI has added a field to is left out rather than failing
 * the whole list, for the same reason a change is.
 */
export function decodeTrailList(value: unknown): DecodeResult<TrailList> {
	const record = decodeRecord(value, 'trails');
	if (!record.ok) {
		return record;
	}

	const rows = decodeArray(record.value.items, 'trails.items');
	if (!rows.ok) {
		return rows;
	}

	const items: Trail[] = [];
	for (const [index, row] of rows.value.entries()) {
		const trail = decodeTrail(row, `trails.items[${index}]`);
		if (trail.ok) {
			items.push(trail.value);
		}
	}

	const nextPageToken = optionalString(fields(record.value, 'trails'), 'nextPageToken');
	if (!nextPageToken.ok) {
		return nextPageToken;
	}

	return { ok: true, value: { items, nextPageToken: nextPageToken.value } };
}

/** Reads the project a trail belongs to. */
export function decodeTrailProject(value: unknown, path: string): DecodeResult<TrailProject> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const name = requireString(read, 'name');
	if (!name.ok) {
		return name;
	}

	const provider = optionalString(read, 'provider');
	if (!provider.ok) {
		return provider;
	}

	const reference = decodeRecord(read.record.reference, `${path}.reference`);
	if (!reference.ok) {
		return reference;
	}

	const referenceFields = fields(reference.value, `${path}.reference`);
	const forge = requireString(referenceFields, 'forge');
	if (!forge.ok) {
		return forge;
	}

	const project = requireString(referenceFields, 'project');
	if (!project.ok) {
		return project;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			name: name.value,
			provider: provider.value ?? forge.value,
			reference: `${forge.value}/${project.value}`,
		},
	};
}

/**
 * Reads one trail with its project.
 *
 * The CLI answers `trail show` with the trail and the project it belongs
 * to, and the two are read together because a trail without its project
 * cannot be placed.
 */
export function decodeTrailDetail(
	value: unknown,
): DecodeResult<{ readonly trail: Trail; readonly project: TrailProject }> {
	const record = decodeRecord(value, 'trail');
	if (!record.ok) {
		return record;
	}

	const trail = decodeTrail(record.value, 'trail');
	if (!trail.ok) {
		return trail;
	}

	const project = decodeTrailProject(record.value.project, 'trail.project');
	if (!project.ok) {
		return project;
	}

	return { ok: true, value: { trail: trail.value, project: project.value } };
}

/** Reads the approvals recorded against a change. */
export function decodeTrailApprovals(value: unknown): DecodeResult<readonly TrailApproval[]> {
	const record = decodeRecord(value, 'approvals');
	if (!record.ok) {
		return record;
	}

	const rows = decodeArray(record.value.approvals, 'approvals.approvals');
	if (!rows.ok) {
		return rows;
	}

	const approvals: TrailApproval[] = [];
	for (const [index, row] of rows.value.entries()) {
		const approval = decodeTrailApproval(row, `approvals.approvals[${index}]`);
		if (approval.ok) {
			approvals.push(approval.value);
		}
	}

	return { ok: true, value: approvals };
}

/** Reads one approval. */
export function decodeTrailApproval(value: unknown, path: string): DecodeResult<TrailApproval> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const author = requireString(read, 'author');
	if (!author.ok) {
		return author;
	}

	const event = requireString(read, 'event');
	if (!event.ok) {
		return event;
	}

	const body = optionalString(read, 'body');
	if (!body.ok) {
		return body;
	}

	const commitSha = optionalString(read, 'commitSha');
	if (!commitSha.ok) {
		return commitSha;
	}

	const createdAt = optionalString(read, 'createdAt');
	if (!createdAt.ok) {
		return createdAt;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			author: author.value,
			event: event.value,
			body: body.value,
			commitSha: commitSha.value,
			createdAt: createdAt.value,
		},
	};
}

/** Reads the discussions on a change. */
export function decodeTrailComments(value: unknown): DecodeResult<readonly TrailComment[]> {
	const record = decodeRecord(value, 'comments');
	if (!record.ok) {
		return record;
	}

	const rows = decodeArray(record.value.items, 'comments.items');
	if (!rows.ok) {
		return rows;
	}

	const comments: TrailComment[] = [];
	for (const [index, row] of rows.value.entries()) {
		const comment = decodeTrailComment(row, `comments.items[${index}]`);
		if (comment.ok) {
			comments.push(comment.value);
		}
	}

	return { ok: true, value: comments };
}

/** Reads one discussion. */
export function decodeTrailComment(value: unknown, path: string): DecodeResult<TrailComment> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const title = optionalString(read, 'title');
	if (!title.ok) {
		return title;
	}

	const lastMessageAuthor = optionalString(read, 'lastMessageAuthor');
	if (!lastMessageAuthor.ok) {
		return lastMessageAuthor;
	}

	const lastMessageAt = optionalString(read, 'lastMessageAt');
	if (!lastMessageAt.ok) {
		return lastMessageAt;
	}

	const createdAt = optionalString(read, 'createdAt');
	if (!createdAt.ok) {
		return createdAt;
	}

	const messageCount = optionalNumber(read, 'messageCount');
	if (!messageCount.ok) {
		return messageCount;
	}

	const resolved = optionalBoolean(read, 'resolved');

	return {
		ok: true,
		value: {
			id: id.value,
			title: title.value,
			resolved: resolved ?? false,
			lastMessageAuthor: lastMessageAuthor.value,
			lastMessageAt: lastMessageAt.value,
			createdAt: createdAt.value,
			messageCount: messageCount.value,
		},
	};
}

/** Reads the findings recorded against a change. */
export function decodeTrailFindings(value: unknown): DecodeResult<readonly TrailFinding[]> {
	const record = decodeRecord(value, 'findings');
	if (!record.ok) {
		return record;
	}

	const rows = decodeArray(record.value.findings, 'findings.findings');
	if (!rows.ok) {
		return rows;
	}

	const findings: TrailFinding[] = [];
	for (const [index, row] of rows.value.entries()) {
		const finding = decodeTrailFinding(row, `findings.findings[${index}]`);
		if (finding.ok) {
			findings.push(finding.value);
		}
	}

	return { ok: true, value: findings };
}

/** Reads one finding. */
export function decodeTrailFinding(value: unknown, path: string): DecodeResult<TrailFinding> {
	const record = decodeRecord(value, path);
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, path);

	const id = requireString(read, 'id');
	if (!id.ok) {
		return id;
	}

	const title = optionalString(read, 'title');
	if (!title.ok) {
		return title;
	}

	const body = optionalString(read, 'body');
	if (!body.ok) {
		return body;
	}

	const state = optionalString(read, 'status');
	if (!state.ok) {
		return state;
	}

	const severity = optionalString(read, 'severity');
	if (!severity.ok) {
		return severity;
	}

	// A finding says where it is about through a location rather than
	// through fields of its own, and the location is absent when the
	// finding is about the change as a whole.
	const raw = read.record.location;
	const location =
		raw === undefined || raw === null
			? undefined
			: decodeRecord(raw, `${path}.location`);

	if (location && !location.ok) {
		return location;
	}

	const locationFields = location
		? fields(location.value, `${path}.location`)
		: { record: {}, path: `${path}.location` };

	const file = optionalString(locationFields, 'filePath');
	if (!file.ok) {
		return file;
	}

	const line = optionalNumber(locationFields, 'startLine');
	if (!line.ok) {
		return line;
	}

	const createdAt = optionalString(read, 'createdAt');
	if (!createdAt.ok) {
		return createdAt;
	}

	return {
		ok: true,
		value: {
			id: id.value,
			title: title.value,
			body: body.value,
			state: state.value,
			severity: severity.value,
			file: file.value,
			line: line.value,
			createdAt: createdAt.value,
		},
	};
}

/** Reads what a merge would do. */
export function decodeTrailMergePlan(value: unknown): DecodeResult<TrailMergePlan> {
	const record = decodeRecord(value, 'merge');
	if (!record.ok) {
		return record;
	}

	const read = fields(record.value, 'merge');

	const change = requireString(read, 'change');
	if (!change.ok) {
		return change;
	}

	const trail = optionalNumber(read, 'trail');
	if (!trail.ok) {
		return trail;
	}

	const project = optionalString(read, 'project');
	if (!project.ok) {
		return project;
	}

	const branch = optionalString(read, 'branch');
	if (!branch.ok) {
		return branch;
	}

	const base = optionalString(read, 'base');
	if (!base.ok) {
		return base;
	}

	const headSha = optionalString(read, 'headSha');
	if (!headSha.ok) {
		return headSha;
	}

	const conflictStatus = optionalString(read, 'conflictStatus');
	if (!conflictStatus.ok) {
		return conflictStatus;
	}

	const bypassPolicy = optionalString(read, 'bypassPolicy');
	if (!bypassPolicy.ok) {
		return bypassPolicy;
	}

	const mergeable = optionalBoolean(read, 'mergeable');
	const wouldBypass = optionalBoolean(read, 'wouldBypass');
	const merged = optionalBoolean(read, 'merged');

	return {
		ok: true,
		value: {
			change: change.value,
			trail: trail.value,
			project: project.value,
			branch: branch.value,
			base: base.value,
			headSha: headSha.value,
			mergeable: mergeable ?? false,
			conflictStatus: conflictStatus.value,
			blockers: decodeStringArray(read.record.blockers, 'merge.blockers'),
			reasons: decodeStringArray(read.record.reasons, 'merge.reasons'),
			wouldBypass: wouldBypass ?? false,
			merged,
		},
	};
}
