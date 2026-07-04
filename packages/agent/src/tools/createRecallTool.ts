import { EventType } from '@light-agent/protocol/events';
import { z } from 'zod';

import type { AgentEvent, ToolResultsEvent } from '@light-agent/protocol/events';
import type { Tool } from '../tool.ts';

function parseRecallId(id: string) {
	const callId = id.trim();
	if (!callId) return null;
	return { callId };
}

const recallIndexSchema = z.object({
	id: z.string().describe('从 [Indexed:tool_result:<id>] 或 Recall 行复制的 tool result id。'),
});

function createRecallIndexTool(getAgentEvents: () => AgentEvent[]): Tool.Definition<typeof recallIndexSchema> {
	return {
		name: 'recall_indexed',
		description: '召回被索引压缩的完整工具结果。仅用于历史中出现 [Indexed:tool_result:<id>] 的场景。',
		schema: recallIndexSchema,
		async execute(p, context) {
			context?.signal?.throwIfAborted();
			const parsed = parseRecallId(p.id?.trim() ?? '');
			if (!parsed) {
				return { isError: true, content: 'Invalid recall id.' };
			}

			const { callId } = parsed;
			const events = getAgentEvents();

			const toolResultEvent = events.findLast(
				(event) =>
					event.type === EventType.Tool_Results && event.tool_results.some((item) => item.id === callId),
			) as ToolResultsEvent | undefined;
			const toolResult = toolResultEvent?.tool_results.find((item) => item.id === callId);

			if (!toolResult) {
				return { isError: true, content: '' };
			}

			console.log(`<-----[召回] 成功${p.id}`);
			return {
				isError: false,
				content: toolResult.result,
			};
		},
	};
}

export default createRecallIndexTool;
