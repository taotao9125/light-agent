import { RUNTIME_PROMPT_BLOCKS } from './runtimePrompt.constants';

import type { Prompts } from './prompts.types';

function wrapTag(tag: string, content: string): string {
	return `<${tag}>\n${content}\n</${tag}>`;
}

function assertInstructionTag(tag: string): void {
	if (!tag.endsWith('Instructions')) {
		throw new Error(`Instruction tag must end with "Instructions": ${tag}`);
	}
}

function formatSkillIndexInstructions(entries: Prompts.SkillIndexEntry[]): string {
	const body = entries
		.map((entry) =>
			[
				'<skill>',
				`<name>${entry.name}</name>`,
				`<description>${entry.description}</description>`,
				`<file>${entry.path}</file>`,
				'</skill>',
			].join('\n'),
		)
		.join('\n\n');

	return wrapTag('skillIndexInstructions', body);
}

const SKILL_USAGE_INSTRUCTIONS = [
	'当用户任务明显落在某个 skill 的领域内时：',
	'1. 先用 read_file 读取对应 SKILL.md 的完整说明',
	'2. 按 skill 中的流程与约束执行任务',
	'3. skill 内的领域规则以 SKILL 为准，但不违背 identity 与上述 instructions',
	'',
	'不要假设 skill 内容；未 read_file 前不要声称已遵循某 skill。',
].join('\n');

/**
 * Prompts.Source → system prompt 字符串（单条文本，传给 adaptor 的 system role）。
 *
 * 角色与指导手册分离：`<identity>` 排第一；其余块均为 `*Instructions` tag，平铺、无外层包裹。
 * 段与段之间用 `\n\n` 分隔。组装顺序固定：
 *
 * ```text
 * <identity>
 * {prompts.identity}
 * </identity>
 *
 * <{product}Instructions>     ← prompts.instructions[]，tag 必须以 Instructions 结尾
 * …
 * </{product}Instructions>
 *
 * <contextWindowInstructions>   ← runtime，接入层不可改
 * …
 * </contextWindowInstructions>
 *
 * <parallelToolUseInstructions>
 * …
 * </parallelToolUseInstructions>
 *
 * <skillIndexInstructions>      ← 仅当 prompts.skillIndex 非空（索引，非 SKILL 正文）
 * <skill>
 * <name>tdd</name>
 * …
 * </skill>
 * </skillIndexInstructions>
 *
 * <skillUsageInstructions>
 * …
 * </skillUsageInstructions>
 * ```
 */
export function buildPromptContext(prompts: Prompts.Source): string {
	const skillIndexEntries = prompts.skillIndex ?? [];

	const identity = wrapTag('identity', prompts.identity);
	const productInstructions = (prompts.instructions ?? []).map((entry) => {
		assertInstructionTag(entry.tag);
		return wrapTag(entry.tag, entry.content);
	});
	const runtime = RUNTIME_PROMPT_BLOCKS.map((block) => wrapTag(block.tag, block.content));
	const skillIndex = skillIndexEntries.length > 0 ? formatSkillIndexInstructions(skillIndexEntries) : undefined;
	const skillUsage =
		skillIndexEntries.length > 0 ? wrapTag('skillUsageInstructions', SKILL_USAGE_INSTRUCTIONS) : undefined;

	// 组装顺序：identity → product instructions → runtime → skill index → skill usage
	return [identity, ...productInstructions, ...runtime, skillIndex, skillUsage].filter(Boolean).join('\n\n');
}
