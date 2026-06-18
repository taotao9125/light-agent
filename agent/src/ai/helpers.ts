import type { AgentEvent } from '../protocol/events';

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
