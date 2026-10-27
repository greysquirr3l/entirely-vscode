import type { Timestamp } from './types';

/** What went wrong when a payload could not be read. */
export type DecodeIssueKind =
	/** The payload was not an object where an object was expected. */
	| 'not-an-object'
	/** The payload was not an array where an array was expected. */
	| 'not-an-array'
	/** A field the payload must have was absent or null. */
	| 'missing'
	/** A field was present but was not the kind of value it must be. */
	| 'wrong-type';

/** A description of one decoding failure. */
export interface DecodeIssue {
	readonly kind: DecodeIssueKind;
	/** The path of the field the problem is at, for the message. */
	readonly path: string;
	/** A human-readable explanation. */
	readonly detail: string;
}

/**
 * The result of decoding a payload.
 *
 * A discriminated result rather than an exception, so "the payload said
 * no" and "the payload could not be read" stay distinguishable.
 */
export type DecodeResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issue: DecodeIssue };

/** A payload being read, and where it came from. */
export interface Fields {
	readonly record: Record<string, unknown>;
	readonly path: string;
}

/** A short description of a value, for an error message. */
function describe(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return 'an array';
	}
	return `a ${typeof value}`;
}

/** Joins a path and a field name. */
function join(path: string, key: string): string {
	return path.length === 0 ? key : `${path}.${key}`;
}

function missing(path: string, detail: string): DecodeResult<never> {
	return { ok: false, issue: { kind: 'missing', path, detail } };
}

function wrongType(path: string, detail: string): DecodeResult<never> {
	return { ok: false, issue: { kind: 'wrong-type', path, detail } };
}

/** Reads a payload that must be an object. */
export function decodeRecord(value: unknown, path: string): DecodeResult<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return {
			ok: false,
			issue: { kind: 'not-an-object', path, detail: `expected an object, got ${describe(value)}` },
		};
	}
	return { ok: true, value: value as Record<string, unknown> };
}

/** Reads a payload that must be an array. */
export function decodeArray(value: unknown, path: string): DecodeResult<unknown[]> {
	if (!Array.isArray(value)) {
		return {
			ok: false,
			issue: { kind: 'not-an-array', path, detail: `expected an array, got ${describe(value)}` },
		};
	}
	return { ok: true, value };
}

/** Reads a field that must be present and a string. */
export function requireString(fields: Fields, key: string): DecodeResult<string> {
	const value = fields.record[key];
	const path = join(fields.path, key);

	if (value === undefined || value === null) {
		return missing(path, 'the field is missing');
	}
	if (typeof value !== 'string') {
		return wrongType(path, `expected a string, got ${describe(value)}`);
	}
	return { ok: true, value };
}

/**
 * Reads a field that may be absent or null.
 *
 * Absence and null are the same thing here — the CLI sends null for
 * "nothing" — so both read back as undefined. A field that is present but
 * of the wrong kind is still an error: that means the shape changed.
 */
export function optionalString(fields: Fields, key: string): DecodeResult<string | undefined> {
	const value = fields.record[key];
	const path = join(fields.path, key);

	if (value === undefined || value === null) {
		return { ok: true, value: undefined };
	}
	if (typeof value !== 'string') {
		return wrongType(path, `expected a string, got ${describe(value)}`);
	}
	return { ok: true, value };
}

/** Reads a field that may be absent or null and must be a number. */
export function optionalNumber(fields: Fields, key: string): DecodeResult<number | undefined> {
	const value = fields.record[key];
	const path = join(fields.path, key);

	if (value === undefined || value === null) {
		return { ok: true, value: undefined };
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return wrongType(path, `expected a number, got ${describe(value)}`);
	}
	return { ok: true, value };
}

/** Reads a field that may be absent or null and must be an array of strings. */
export function optionalStringArray(
	fields: Fields,
	key: string,
): DecodeResult<readonly string[] | undefined> {
	const value = fields.record[key];
	const path = join(fields.path, key);

	if (value === undefined || value === null) {
		return { ok: true, value: undefined };
	}

	const array = decodeArray(value, path);
	if (!array.ok) {
		return array;
	}

	const values: string[] = [];
	for (let index = 0; index < array.value.length; index++) {
		const entry = array.value[index];
		if (typeof entry !== 'string') {
			return wrongType(`${path}[${index}]`, `expected a string, got ${describe(entry)}`);
		}
		values.push(entry);
	}

	return { ok: true, value: values };
}

/**
 * Reads a field that may be absent or null and must be a boolean.
 *
 * A field of the wrong kind is not an error here. The extension is reading
 * a flag the CLI may grow or reshape, and a flag it cannot read is simply
 * a flag the extension does not know about.
 */
export function optionalBoolean(fields: Fields, key: string): boolean | undefined {
	const value = fields.record[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	return typeof value === 'boolean' ? value : undefined;
}

/**
 * Reads a field that may be absent or null, without insisting on its kind.
 *
 * Used for the fields the extension carries through untouched.
 */
export function optionalRaw(fields: Fields, key: string): unknown {
	const value = fields.record[key];
	return value === undefined || value === null ? undefined : value;
}

/** Reads a field that must be present and an array of strings. */
export function requireStringArray(fields: Fields, key: string): DecodeResult<readonly string[]> {
	const path = join(fields.path, key);
	const array = decodeArray(fields.record[key], path);
	if (!array.ok) {
		return array;
	}

	const values: string[] = [];
	for (let index = 0; index < array.value.length; index++) {
		const entry = array.value[index];
		if (typeof entry !== 'string') {
			return wrongType(`${path}[${index}]`, `expected a string, got ${describe(entry)}`);
		}
		values.push(entry);
	}

	return { ok: true, value: values };
}

/**
 * Reads a field that may be absent or null and must be an RFC 3339
 * timestamp.
 *
 * The CLI sends nanosecond precision, which `Date` cannot represent. The
 * parsed instant is kept for ordering and comparison, and the original text
 * is kept so it can be shown as the CLI wrote it.
 */
export function optionalTimestamp(fields: Fields, key: string): DecodeResult<Timestamp | undefined> {
	const value = fields.record[key];
	const path = join(fields.path, key);

	if (value === undefined || value === null) {
		return { ok: true, value: undefined };
	}
	if (typeof value !== 'string') {
		return wrongType(path, `expected a timestamp string, got ${describe(value)}`);
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return wrongType(path, `the timestamp '${value}' could not be parsed`);
	}

	return { ok: true, value: { date, raw: value } };
}

/** Builds the field reader for a record. */
export function fields(record: Record<string, unknown>, path: string): Fields {
	return { record, path };
}

/**
 * Turns a decode result into the value it carries, throwing when the
 * payload could not be read.
 *
 * This is the adapter for callers that already handle a failure as a value:
 * the CLI runner catches the throw and reports it as invalid output, so a
 * change in the CLI's shape surfaces as a diagnosable failure instead of an
 * exception escaping into the extension host.
 */
export function unwrap<T>(result: DecodeResult<T>): T {
	if (result.ok) {
		return result.value;
	}
	throw new Error(`${result.issue.path}: ${result.issue.detail}`);
}
