/**
 * The page the device flow sends a person to.
 *
 * The CLI prints the address and a code. In a remote window the
 * extension opens the address on the person's own machine, so it only
 * opens one that belongs to Entire. Anything else the CLI prints stays
 * in the panel, where the person can read it.
 */

/** The domains Entire serves from. */
const ENTIRE_DOMAINS = ['entire.io', 'entire.com'];

/** An https address, up to the whitespace that ends it. */
const ADDRESS = /https:\/\/[^\s<>"'`]+(?=\s)/g;

/** Whether the address is https and on an Entire host. */
export function isEntireUrl(address: string): boolean {
	let parsed: URL;

	try {
		parsed = new URL(address);
	} catch {
		return false;
	}

	if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
		return false;
	}

	const host = parsed.hostname.toLowerCase();

	return ENTIRE_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/**
 * The first Entire address in the CLI's output.
 *
 * An address counts only once whitespace follows it, so an address cut
 * in two by the way the output arrives is not opened half-read.
 */
export function findVerificationUrl(output: string): string | undefined {
	for (const match of output.matchAll(ADDRESS)) {
		const address = match[0].replace(/[.,;:)\]]+$/, '');

		if (isEntireUrl(address)) {
			return address;
		}
	}

	return undefined;
}
