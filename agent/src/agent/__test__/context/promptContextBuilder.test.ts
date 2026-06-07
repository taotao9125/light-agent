import { describe, expect, it } from 'vitest';
import { buildPromptContext } from '../../context/promptContextBuilder';

describe('buildPromptContext', () => {
	it('应编译 identity 并注入 runtime 块', () => {
		const prompt = buildPromptContext({
			identity: 'CLI 编程助手',
		});

		expect(prompt).toContain('<identity>');
		expect(prompt).toContain('CLI 编程助手');
		expect(prompt).toContain('<contextWindowInstructions>');
		expect(prompt).toContain('<parallelToolUseInstructions>');
	});

	it('identity 应在 runtime 之前', () => {
		const prompt = buildPromptContext({
			identity: 'test-identity',
		});

		expect(prompt.indexOf('test-identity')).toBeLessThan(prompt.indexOf('<contextWindowInstructions>'));
	});

	it('product instructions 应编译为 tag 块', () => {
		const prompt = buildPromptContext({
			identity: 'test',
			instructions: [{ tag: 'terminalInstructions', content: 'extra rule' }],
		});

		expect(prompt).toContain('<terminalInstructions>');
		expect(prompt).toContain('extra rule');
	});

	it('instruction tag 不以 Instructions 结尾时应 throw', () => {
		expect(() =>
			buildPromptContext({
				identity: 'test',
				instructions: [{ tag: 'terminalRules', content: 'bad' }],
			}),
		).toThrow(/must end with "Instructions"/);
	});

	it('有 skillIndex 时应平铺 skillIndexInstructions 与 skillUsageInstructions', () => {
		const prompt = buildPromptContext({
			identity: 'test',
			skillIndex: [
				{
					name: 'tdd',
					description: 'Test-driven development',
					path: '.agents/skills/tdd/SKILL.md',
				},
			],
		});

		expect(prompt).toContain('<skillIndexInstructions>');
		expect(prompt).toContain('<skillUsageInstructions>');
		expect(prompt).toContain('<name>tdd</name>');
		expect(prompt).not.toContain('<instructions>');
		expect(prompt).not.toContain('<skills>');
	});

	it('skillIndex 应在 skillUsage 之前', () => {
		const prompt = buildPromptContext({
			identity: 'test',
			skillIndex: [
				{
					name: 'tdd',
					description: 'Test-driven development',
					path: '.agents/skills/tdd/SKILL.md',
				},
			],
		});

		expect(prompt.indexOf('<skillIndexInstructions>')).toBeLessThan(prompt.indexOf('<skillUsageInstructions>'));
	});

	it('无 skillIndex 时不应出现 skill instructions', () => {
		const prompt = buildPromptContext({
			identity: 'test',
		});

		expect(prompt).not.toContain('<skillIndexInstructions>');
		expect(prompt).not.toContain('<skillUsageInstructions>');
	});
});
