import { EventType } from '@light-agent/protocol/events';

import type { AgentEvent, ToolCallsEvent, ToolResultsEvent } from '@light-agent/protocol/events';
import type { Tool } from '../tool.ts';

function parseRecallId(id: string) {
	const splitedParts = id.split('_round_id_');
	if (splitedParts.length !== 2) return null;

	const callId = splitedParts[0];
	const [roundIdStr, turnIndex] = splitedParts[1].split('_');
	const roundId = `round_id_${roundIdStr}`;
	const turn = Number(turnIndex);

	if (!callId || !roundIdStr || Number.isNaN(turn)) return null;

	return { callId, roundId, turn };
}

function createRecallIndexTool(getAgentEvents: () => AgentEvent[]): Tool.Definition {
	return {
		name: 'recall_indexed',
		description:
			'Recall full indexed tool args and/or tool result. Use when history shows [Indexed:tool_arg:...] or [Indexed:tool_result:...].',
		schema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'Index id from the placeholder, e.g. call_1_round_id_xxx_3.',
				},
			},
			required: ['id'],
			additionalProperties: false,
		},
		async execute(p: { id: string }, context) {
			context.signal?.throwIfAborted();
			const parsed = parseRecallId(p.id?.trim() ?? '');
			if (!parsed) {
				return { isError: true, content: 'Invalid recall id.' };
			}

			const { callId, roundId, turn } = parsed;
			const events = getAgentEvents();

			const toolCallsEvent = events.find(
				(event) =>
					event.type === EventType.Tool_Calls && event.meta?.roundId === roundId && event.meta?.turn === turn,
			) as ToolCallsEvent | undefined;
			const action = toolCallsEvent?.tool_calls.find((item) => item.id === callId);

			const obsEvent = events.find(
				(event) =>
					event.type === EventType.Tool_Results &&
					event.meta?.roundId === roundId &&
					event.meta?.turn === turn,
			) as ToolResultsEvent | undefined;
			const obs = obsEvent?.tool_results.find((item) => item.id === callId);

			const parts: string[] = [];
			if (action) {
				parts.push(`tool_args:\n${JSON.stringify(action.args, null, 2)}`);
			}
			if (obs) {
				parts.push(`tool_result:\n${obs.result}`);
			}

			if (!parts.length) {
				return { isError: true, content: '' };
			}

			console.log(`<-----[召回] 成功${p.id}`);
			return {
				isError: false,
				content: parts.join('\n\n'),
			};
		},
	};
}

export default createRecallIndexTool;
