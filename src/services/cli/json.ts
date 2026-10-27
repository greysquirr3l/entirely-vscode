/** The result of extracting a JSON value from command output. */
export type JsonParseResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly detail: string };

/**
 * Finds the end of the JSON value that starts at `start`.
 *
 * Returns the offset just past the closing bracket, or -1 when the value is
 * unbalanced. Strings are tracked so a brace inside a string literal does
 * not confuse the count.
 */
function findValueEnd(text: string, start: number): number {
	const closers: string[] = [];
	let inString = false;
	let escaped = false;

	for (let index = start; index < text.length; index++) {
		const char = text[index];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === '{' || char === '[') {
			closers.push(char === '{' ? '}' : ']');
			continue;
		}
		if (char === '}' || char === ']') {
			if (closers.pop() !== char) {
				return -1;
			}
			if (closers.length === 0) {
				return index + 1;
			}
		}
	}

	return -1;
}

/** A short, safe excerpt of output for an error message. */
function excerpt(text: string): string {
	const collapsed = text.replace(/\s+/g, ' ').trim();
	return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

/**
 * Extracts a JSON value from command output.
 *
 * The CLI prints its payload on stdout, but a warning can precede it — a
 * deprecation notice, a proxy message, anything the CLI decides to print
 * unprompted. Rather than fail on that, this finds the first offset from
 * which the remainder parses as JSON, and ignores anything around it.
 */
export function parseJson(text: string): JsonParseResult {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return { ok: false, detail: 'the command produced no output' };
	}

	try {
		return { ok: true, value: JSON.parse(trimmed) as unknown };
	} catch {
		// Fall through: the output may be surrounded by non-JSON text.
	}

	for (let index = 0; index < trimmed.length; index++) {
		const char = trimmed[index];
		if (char !== '{' && char !== '[') {
			continue;
		}

		const end = findValueEnd(trimmed, index);
		if (end === -1) {
			continue;
		}

		try {
			return { ok: true, value: JSON.parse(trimmed.slice(index, end)) as unknown };
		} catch {
			// This brace was not the start of the payload. Try the next one.
		}
	}

	return { ok: false, detail: `the output was not JSON: ${excerpt(trimmed)}` };
}
