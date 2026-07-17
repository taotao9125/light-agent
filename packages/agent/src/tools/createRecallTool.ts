import { EventType } from '@light-agent/protocol/events';
import { z } from 'zod';

import type { AgentEvent } from '@light-agent/protocol/events';
import type { Tool } from '../tool.ts';

function parseRecallId(id: string) {
	const callId = id.trim();
	if (!callId) return null;
	return { callId };
}

const recallIndexSchema = z.object({
	id: z.string().describe('从 [what]: indexed_tool_result ... 中的 id=<id> 复制的 tool result id。'),
});

function findToolResult(events: AgentEvent[], callId: string) {
	const toolResultEvent = events.findLast(
		(event) => event.type === EventType.Tool_Result && event.tool_result.id === callId,
	);
	return toolResultEvent?.type === EventType.Tool_Result ? toolResultEvent.tool_result : undefined;
}

function createRecallIndexTool(
	getAgentEvents: () => AgentEvent[],
	loadSessionEvents?: () => Promise<AgentEvent[]>,
): Tool.Definition<typeof recallIndexSchema> {
	return {
		name: 'recall_indexed',
		description: [
			'[what] 召回已从当前上下文移出、但保存在历史索引中的完整 tool result 正文。',
			'[when] 仅当上下文中出现 [what]: indexed_tool_result ...，并且当前判断必须依赖完整原文时使用；如果占位符提供的 tool、intent 线索已经足够，不要调用。',
			'[how] 传入占位符里的 id，例如 recall_indexed({ id: "call_1" })。工具会先查最近内存事件；若未命中，再从 session 历史中查找。',
		].join('\n'),
		schema: recallIndexSchema,
		async execute(p, context) {
			context?.signal?.throwIfAborted();
			const parsed = parseRecallId(p.id?.trim() ?? '');
			if (!parsed) {
				return { isError: true, content: 'Invalid recall id.' };
			}

			const { callId } = parsed;
			const events = getAgentEvents();
			const inMemoryToolResult = findToolResult(events, callId);

			if (inMemoryToolResult) {
				return {
					isError: false,
					content: inMemoryToolResult.result,
				};
			}

			const sessionEvents = loadSessionEvents ? await loadSessionEvents() : [];
			const sessionToolResult = findToolResult(sessionEvents, callId);

			if (!sessionToolResult) {
				return { isError: true, content: '' };
			}

			return {
				isError: false,
				content: sessionToolResult.result,
			};
		},
	};
}

export default createRecallIndexTool;
