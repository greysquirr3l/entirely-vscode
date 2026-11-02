import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	AGENT_SKILL_DESCRIPTION,
	AGENT_SKILL_NAME,
	AGENT_SKILL_RELATIVE_PATH,
	agentSkillDocument,
	agentSkillPath,
	confirmAgentSkillOverwrite,
	type ControlConfirmation,
} from '../lib/entire';
import { installAgentSkill, type AgentSkillUi } from '../commands/agentSkill';
import { makeTempDir, removeTempDir } from './support/tempDir';

interface FakeUi extends AgentSkillUi {
	readonly questions: ControlConfirmation[];
	readonly messages: string[];
	readonly warnings: string[];
	/** Whether the next question is answered yes. */
	answer: boolean;
}

function fakeUi(answer = true): FakeUi {
	const questions: ControlConfirmation[] = [];
	const messages: string[] = [];
	const warnings: string[] = [];
	return {
		questions,
		messages,
		warnings,
		answer,
		async confirm(prompt: ControlConfirmation): Promise<boolean> {
			questions.push(prompt);
			return this.answer;
		},
		async inform(message: string): Promise<void> {
			messages.push(message);
		},
		async warn(message: string): Promise<void> {
			warnings.push(message);
		},
	};
}

suite("Entire's agent skill", () => {
	test('the skill says what it is for, in words an agent can search for', () => {
		const document = agentSkillDocument();
		assert.match(document, /^---\nname: entire\ndescription: '/);
		assert.ok(document.includes(AGENT_SKILL_DESCRIPTION), 'the description is not in the document');
		for (const word of ['why', 'search', 'checkpoint', 'session', 'agent-help']) {
			assert.ok(AGENT_SKILL_DESCRIPTION.includes(word) || document.includes(word), `the skill does not mention ${word}`);
		}
	});

	test('the skill lives in a folder named after it', () => {
		assert.strictEqual(AGENT_SKILL_RELATIVE_PATH, '.github/skills/entire/SKILL.md');
		assert.ok(AGENT_SKILL_RELATIVE_PATH.includes(`/${AGENT_SKILL_NAME}/`), 'the folder does not match the name');
	});

	test('the skill is written into the repository', async () => {
		const root = makeTempDir('entire-skill-');
		try {
			const ui = fakeUi();
			const result = await installAgentSkill({ ui, repositoryRoot: () => root });
			assert.strictEqual(result, 'installed');
			const target = agentSkillPath(root);
			assert.strictEqual(fs.readFileSync(target, 'utf8'), agentSkillDocument());
			assert.strictEqual(ui.questions.length, 0, 'nothing was written without a question');
		} finally {
			removeTempDir(root);
		}
	});

	test('a skill that is already there and is the same is left alone', async () => {
		const root = makeTempDir('entire-skill-');
		try {
			const target = agentSkillPath(root);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, agentSkillDocument(), 'utf8');
			const ui = fakeUi();
			assert.strictEqual(await installAgentSkill({ ui, repositoryRoot: () => root }), 'present');
			assert.strictEqual(ui.questions.length, 0);
		} finally {
			removeTempDir(root);
		}
	});

	test('a skill of the person\'s own is replaced only when they say so', async () => {
		const root = makeTempDir('entire-skill-');
		try {
			const target = agentSkillPath(root);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, 'mine\n', 'utf8');

			const declined = fakeUi(false);
			assert.strictEqual(await installAgentSkill({ ui: declined, repositoryRoot: () => root }), 'cancelled');
			assert.strictEqual(fs.readFileSync(target, 'utf8'), 'mine\n');
			assert.strictEqual(declined.questions.length, 1);
			assert.match(declined.questions[0].detail, /overwrites that file and nothing else/);

			const accepted = fakeUi(true);
			assert.strictEqual(await installAgentSkill({ ui: accepted, repositoryRoot: () => root }), 'installed');
			assert.strictEqual(fs.readFileSync(target, 'utf8'), agentSkillDocument());
		} finally {
			removeTempDir(root);
		}
	});

	test('with no repository open, it says so and writes nothing', async () => {
		const ui = fakeUi();
		assert.strictEqual(await installAgentSkill({ ui, repositoryRoot: () => undefined }), 'failed');
		assert.match(ui.warnings[0], /Open the repository/);
	});

	test('a link at the file\'s place is refused, and nothing is written through it', async () => {
		const root = makeTempDir('entire-skill-');
		try {
			const outside = path.join(root, 'outside.md');
			fs.writeFileSync(outside, 'mine\n', 'utf8');
			const target = agentSkillPath(root);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.symlinkSync(outside, target);

			const ui = fakeUi();
			assert.strictEqual(await installAgentSkill({ ui, repositoryRoot: () => root }), 'failed');
			assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'mine\n', 'the link was followed');
			assert.match(ui.warnings[0], /link/);
		} finally {
			removeTempDir(root);
		}
	});

	test('a folder that leads out of the repository is refused', async () => {
		for (const linked of ['.github', path.join('.github', 'skills')]) {
			const root = makeTempDir('entire-skill-');
			const outside = makeTempDir('entire-outside-');
			try {
				const link = path.join(root, linked);
				fs.mkdirSync(path.dirname(link), { recursive: true });
				fs.symlinkSync(outside, link);

				const ui = fakeUi();
				assert.strictEqual(await installAgentSkill({ ui, repositoryRoot: () => root }), 'failed');
				assert.deepStrictEqual(fs.readdirSync(outside), [], 'a folder was created outside the repository');
				assert.match(ui.warnings[0], /outside the repository/);
			} finally {
				removeTempDir(root);
				removeTempDir(outside);
			}
		}
	});

	test('the skill in this repository is the one this extension writes', () => {
		const dogfooded = path.resolve(__dirname, '..', '..', '.github', 'skills', AGENT_SKILL_NAME, 'SKILL.md');
		if (!fs.existsSync(dogfooded)) {
			return;
		}
		assert.strictEqual(
			fs.readFileSync(dogfooded, 'utf8'),
			agentSkillDocument(),
			'the skill in this repository is out of date; run the install command again',
		);
	});

	test('the question names the file that would be replaced', () => {
		const question = confirmAgentSkillOverwrite('/repo/.github/skills/entire/SKILL.md');
		assert.match(question.message, /Replace/);
		assert.ok(question.detail.includes('/repo/.github/skills/entire/SKILL.md'));
		assert.match(question.detail, /overwrites that file and nothing else/);
	});

	test('the question claims nothing about where the file came from', () => {
		const question = confirmAgentSkillOverwrite('/repo/.github/skills/entire/SKILL.md');
		assert.doesNotMatch(question.detail, /already holds an Entire agent skill/);
	});

	test('the skill leaves the list of changing commands to the CLI', () => {
		const document = agentSkillDocument();
		assert.ok(document.includes('entire agent-help'), 'the skill does not point at the CLI');
		for (const command of ['org', 'repo', 'project', 'plugin', 'clean', 'disable', 'enable', 'login']) {
			assert.ok(
				!document.includes(`\`${command}\``),
				`the skill lists ${command} as the person's to run, and the list will go stale`,
			);
		}
	});
});
