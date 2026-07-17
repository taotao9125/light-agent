import { EventType } from '@light-agent/protocol/events';

import type { AgentEvent, ToolResultEvent } from '@light-agent/protocol/events';

export const stringifyContent = (content: unknown): string => {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
};

type RoundMap = Map<string, Map<number, AgentEvent[]>>;

export function parseEventsIntoRoundMap(events: AgentEvent[]): RoundMap {
	const roundMap: RoundMap = new Map();

	for (const event of events) {
		const roundId = event.meta?.roundId;
		const turnIndex = event.meta?.turn;

		if (!roundId || typeof turnIndex !== 'number') continue;

		if (!roundMap.get(roundId)) {
			roundMap.set(roundId, new Map());
		}

		if (!roundMap.get(roundId)?.get(turnIndex)) {
			roundMap.get(roundId)?.set(turnIndex, []);
		}

		const currentTurn = roundMap.get(roundId)?.get(turnIndex);

		currentTurn?.push(event);
	}

	return roundMap;
}

export function collectToolResultsForTurn(
	events: AgentEvent[],
	toolCallIds: string[],
): Array<ToolResultEvent['tool_result']> {
	const resultsById = new Map<string, ToolResultEvent['tool_result']>();

	for (const event of events) {
		if (event.type === EventType.Tool_Result) {
			resultsById.set(event.tool_result.id, event.tool_result);
		}
	}

	const results: Array<ToolResultEvent['tool_result']> = [];

	for (const id of toolCallIds) {
		const result = resultsById.get(id);
		if (result) {
			results.push(result);
		}
	}

	return results;
}
