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

	test('the question names the file that would be replaced', () => {
		const question = confirmAgentSkillOverwrite('/repo/.github/skills/entire/SKILL.md');
		assert.match(question.message, /Replace/);
		assert.ok(question.detail.includes('/repo/.github/skills/entire/SKILL.md'));
	});
});
