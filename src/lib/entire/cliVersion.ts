/**
 * The version of the Entire CLI this extension reads its payloads from.
 *
 * The extension reads fields that the CLI adds over time, so a CLI older
 * than this may not report them. The extension still works with an older
 * CLI: it says what it could not read rather than pretending the field
 * was never there, and it names the version it expected so that the
 * report can be acted on.
 *
 * Raise this when the extension starts reading a field the CLI added,
 * and lower it when it turns out an older CLI reports the field too.
 */
export const DEFAULT_MINIMUM_CLI_VERSION = '0.12.2';

/** A version, split into its parts. */
export interface CliVersion {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

/**
 * Reads a version out of text.
 *
 * The shape of the CLI's version output is the CLI's business, so this is
 * tolerant: the first version-looking run of characters wins, and text
 * that holds no version at all is not a version.
 */
export function parseCliVersion(text: string | undefined): CliVersion | undefined {
	if (!text) {
		return undefined;
	}

	const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(text);
	if (!match) {
		return undefined;
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

/** Compares two versions: negative when the first is the older one. */
export function compareCliVersions(a: CliVersion, b: CliVersion): number {
	if (a.major !== b.major) {
		return a.major - b.major;
	}

	if (a.minor !== b.minor) {
		return a.minor - b.minor;
	}

	return a.patch - b.patch;
}

/** Whether a version is at least as new as a minimum. */
export function isAtLeast(version: CliVersion, minimum: CliVersion): boolean {
	return compareCliVersions(version, minimum) >= 0;
}

/**
 * What to say when the CLI is older than the extension expects.
 *
 * There is nothing to say when the CLI is new enough, so the caller can
 * print the line only when there is something to print.
 */
export function describeUnsupportedCli(
	installed: string | undefined,
	minimum: string,
): string | undefined {
	const version = parseCliVersion(installed);
	const required = parseCliVersion(minimum);

	if (!version || !required || isAtLeast(version, required)) {
		return undefined;
	}

	return `The Entire CLI (${installed}) is older than this extension expects (${minimum}), so some information will be missing. Update the CLI, or set \`entirely.minimumCliVersion\` if this version reports everything.`;
}

/**
 * What to say when the CLI's payload is not one the extension knows.
 *
 * The version is part of the sentence because the first question about a
 * payload the extension cannot read is which CLI produced it.
 */
export function describeUnexpectedPayload(installed: string | undefined): string {
	const version = installed ? ` (${installed})` : '';
	return `The Entire CLI${version} reported something this extension does not understand.`;
}
