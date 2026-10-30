import { cleanCliText } from './sessionLifecycle';
import { oneLine } from './text';

/** One thing `entire doctor` printed at the top level of its output. */
export interface DoctorCheck {
	/** Whether the CLI marked the check as passing. */
	readonly ok: boolean;
	/** The check's own headline, cut to one short line. */
	readonly title: string;
	/** The few detail lines that say why and what to do, never the rest. */
	readonly notes: readonly string[];
}

/** What the CLI's own doctor said, or why it could not say anything. */
export type CliDoctorReading =
	/** Every check passed. */
	| { readonly kind: 'healthy'; readonly checks: readonly DoctorCheck[] }
	/** At least one check reported a problem. */
	| {
			readonly kind: 'problems';
			readonly passed: number;
			readonly findings: readonly DoctorCheck[];
			readonly omitted: number;
	  }
	/** The command ran and failed, so nothing it said can be trusted as healthy. */
	| { readonly kind: 'failed'; readonly reason: string; readonly detail: string }
	/** This CLI has no doctor command to ask. */
	| { readonly kind: 'unsupported'; readonly detail: string }
	/** There is no usable CLI to ask. */
	| { readonly kind: 'no-cli'; readonly detail: string };

/** The most findings the report lists. */
export const MAX_DOCTOR_FINDINGS = 20;
/** The most detail lines kept per finding. */
const MAX_NOTES = 3;
const MAX_LINE = 200;

const PASS_MARK = /^[✓✔]\s*/u;
const FAIL_MARK = /^(?:[✗✘×⚠!]|x\s)\s*/iu;
/** Top-level lines that say nothing is wrong without a pass mark. */
const ALL_CLEAR = /^(?:no\s+(?:issues?|problems?|stuck\s+sessions?)|all\s+(?:checks|good|clear)|nothing\s+to\s+fix)\b/i;
/** Detail lines worth keeping: the reason a check failed and the way out. */
const USEFUL_NOTE = /^(?:reason|fix|problem|error|warning|run|file|path|hint)\b/i;

interface Draft {
	ok: boolean;
	title: string;
	notes: string[];
}

/**
 * Reads the text `entire doctor` prints.
 *
 * The CLI has no machine-readable form for it, so this reads the shape
 * every check shares: a top-level line, marked with a tick when it
 * passed, followed by indented detail. A top-level line without a tick is
 * a problem unless it plainly says everything is fine. Detail is cut to
 * the lines that give a reason or a fix, because the rest can name files
 * and sessions and does not belong in a report that is pasted into an
 * issue. The text is never kept.
 */
export function parseDoctorOutput(text: string): readonly DoctorCheck[] {
	const checks: Draft[] = [];
	let current: Draft | undefined;

	for (const raw of cleanCliText(text, 1_000_000).split('\n')) {
		if (raw.trim().length === 0) {
			continue;
		}

		if (/^\s/.test(raw)) {
			const note = raw.trim();
			if (current && !current.ok && current.notes.length < MAX_NOTES && USEFUL_NOTE.test(note)) {
				current.notes.push(oneLine(note, MAX_LINE));
			}
			continue;
		}

		const line = raw.trim();
		const passed = PASS_MARK.test(line);
		const clear = passed || ALL_CLEAR.test(line);
		const title = line.replace(PASS_MARK, '').replace(FAIL_MARK, '').trim();
		current = { ok: clear, title: oneLine(title, MAX_LINE), notes: [] };
		checks.push(current);
	}

	return checks;
}

/** Builds the reading from the text of a doctor run that exited normally. */
export function readDoctorOutput(text: string): CliDoctorReading {
	const checks = parseDoctorOutput(text);
	const findings = checks.filter(check => !check.ok);

	if (findings.length === 0) {
		return { kind: 'healthy', checks };
	}

	return {
		kind: 'problems',
		passed: checks.length - findings.length,
		findings: findings.slice(0, MAX_DOCTOR_FINDINGS),
		omitted: Math.max(0, findings.length - MAX_DOCTOR_FINDINGS),
	};
}

/** The report lines for the CLI's own diagnostics. */
export function describeCliDoctor(reading: CliDoctorReading | undefined): readonly string[] {
	if (!reading) {
		return ['- (not run)'];
	}

	switch (reading.kind) {
		case 'healthy':
			return [
				reading.checks.length > 0
					? `- Result: healthy (${reading.checks.length} check${reading.checks.length === 1 ? '' : 's'} passed)`
					: '- Result: healthy (the CLI reported no problems)',
			];
		case 'problems': {
			const lines = [
				`- Result: ${reading.findings.length + reading.omitted} problem${
					reading.findings.length + reading.omitted === 1 ? '' : 's'
				} found (${reading.passed} check${reading.passed === 1 ? '' : 's'} passed)`,
			];
			for (const finding of reading.findings) {
				lines.push(`- Finding: ${oneLine(finding.title, MAX_LINE)}`);
				for (const note of finding.notes) {
					lines.push(`  - ${oneLine(note, MAX_LINE)}`);
				}
			}
			if (reading.omitted > 0) {
				lines.push(`- ${reading.omitted} more not listed`);
			}
			return lines;
		}
		case 'failed':
			return [
				`- Result: the CLI's doctor did not complete (${oneLine(reading.reason)})`,
				`- Finding: ${oneLine(reading.detail, MAX_LINE)}`,
			];
		case 'unsupported':
			return [`- Result: not available (${oneLine(reading.detail, MAX_LINE)})`];
		case 'no-cli':
			return [`- Result: not run (${oneLine(reading.detail, MAX_LINE)})`];
	}
}
