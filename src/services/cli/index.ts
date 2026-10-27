export { CliLocator } from './locator';
export { CliRunner, DEFAULT_TIMEOUT_MS, type RunOptions } from './runner';
export { findCandidate, parseVersion, type Candidate, type DiscoveryOptions } from './discovery';
export { documentedLocations, pathEntries, type DocumentedLocation } from './locations';
export { parseJson, type JsonParseResult } from './json';
export { parseUsage } from './usage';
export type {
	CliCommandUsage,
	CliDiscovery,
	CliFailureReason,
	CliFlag,
	CliLocation,
	CliResult,
} from './types';
