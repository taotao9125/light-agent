import { EventType } from '../protocol/events';

import type { AgentEvent, InputEvent } from '../protocol/events';

export const stringifyContent = (content: unknown): string => {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
};

type Round = {
	input: InputEvent;
	turns: Map<number, AgentEvent[]>;
};

type RoundMap = Map<string, Round>;


export function parseEventsIntoRoundMap(events: AgentEvent[]): RoundMap {
	const roundMap: RoundMap = new Map();

	for (const event of events) {
		const roundId = event.meta?.roundId;
		if (!roundId) continue;

		if (event.type === EventType.INPUT) {
			const round = roundMap.get(roundId);
			if (!round) {
				roundMap.set(roundId, { input: event, turns: new Map() });
			}
		} else {
			const round = roundMap.get(roundId);
			const turnIndex = event.meta?.turn;

			if (!round || typeof turnIndex !== 'number') continue;

			let currentTurns = round.turns.get(turnIndex);
			if (!currentTurns) {
				currentTurns = [];
				round.turns.set(turnIndex, currentTurns);
			}
			currentTurns.push(event);
		}
	}

	return roundMap;
}
