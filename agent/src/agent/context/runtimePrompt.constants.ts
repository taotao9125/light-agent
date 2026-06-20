import type { Prompts } from './prompts.types';

/** agent runtime 固定注入块；接入层不可覆盖。 */
export const RUNTIME_PROMPT_BLOCKS = [
	{
		tag: 'contextWindowInstructions',
		content: [
			'## 上下文窗口',
			'- 你只能看到最近几轮对话，更早的内容可能已被 Host 丢弃。',
			'- 若发现缺少 earlier 信息，用工具重新获取，不要凭空假设。',
			'',
			'## 索引化 tool 结果',
			'- 若 tool 结果以 [indexed:tool_result:<id>] 开头，正文不在上下文中。',
			'- 需要原文时，必须调用 recall_indexed(id)，不要猜测或重新读文件代替。',
			'- id 与 tool_call_id 相同，可直接从 Recall 行复制。',
			'',
			'## 会话循环',
			'- 任务完成时，用自然语言回复，不再调用工具。',
			'- 若因缺少信息无法继续，明确说明阻塞点，停止或向用户提问。',
		].join('\n'),
	},
	{
		tag: 'parallelToolUseInstructions',
		content: [
			'若同一轮可发出多个彼此独立的 action，优先并行发起，以减少等待时间。',
			'',
			'**鼓励并行**',
			'- 同时读取多个互不依赖的文件',
			'- 探索阶段：list_files_new 与 read_file 针对不同路径、且无先后依赖时',
			'',
			'**必须串行**',
			'- 后一步依赖前一步 observation（先 list 再 read、先 search 再 read 命中文件）',
			'- 同一文件的「先读后分析再引用」',
			'',
			'**限制**',
			'- 不要为同一目的重复调用相同工具与相同参数',
		].join('\n'),
	},
] as const satisfies readonly Prompts.Instruction[];
