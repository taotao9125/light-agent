import { type AgentEvent, EventType } from './events';

export type EventRoundGroup = {
	input?: AgentEvent;
	turns: AgentEvent[][];
};

export function toRoundMap(events: AgentEvent[]): Map<string, AgentEvent[]> {
	const map = new Map<string, AgentEvent[]>();
	for (const event of events) {
		const roundId = event.meta?.roundId;
		if (!roundId) continue;

		if (!map.has(roundId)) {
			map.set(roundId, []);
		}
		map.get(roundId)!.push(event);
	}
	return map;
}

export function toTurnEventMap(roundEvents: AgentEvent[]): Map<number, AgentEvent[]> {
	const turnEventMap = new Map<number, AgentEvent[]>();
	for (const event of roundEvents) {
		if (event.type === EventType.INPUT) continue;

		const turn = event.meta?.turn;
		if (turn == null) continue;

		if (!turnEventMap.has(turn)) {
			turnEventMap.set(turn, []);
		}
		turnEventMap.get(turn)!.push(event);
	}
	return turnEventMap;
}

/**
 * Input:
 * [
 *   input(round=r1),
 *   thought(round=r1, turn=1), action(round=r1, turn=1), observation(round=r1, turn=1), output(round=r1, turn=1),
 *   thought(round=r1, turn=2), output(round=r1, turn=2),
 *   input(round=r2),
 *   thought(round=r2, turn=1), output(round=r2, turn=1),
 * ]
 *
 * Output:
 * [
 *   { input: input(r1), turns: [[thought1, action1, observation1, output1], [thought2, output2]] },
 *   { input: input(r2), turns: [[thought1, output1]] },
 * ]
 */
export function splitEventsToRoundGroups(events: AgentEvent[]): EventRoundGroup[] {
	return [...toRoundMap(events).values()].map((roundEvents) => ({
		input: roundEvents.find((event) => event.type === EventType.INPUT),
		turns: [...toTurnEventMap(roundEvents).values()],
	}));
}

export function parseTurnEventGroup(turnEvents: AgentEvent[]) {
	const thought = turnEvents.find((event) => event.type === EventType.THOUGHT);
	const output = turnEvents.find((event) => event.type === EventType.OUTPUT);
	const actions = turnEvents.filter((event) => event.type === EventType.ACTION);
	const observations = turnEvents.filter((event) => event.type === EventType.OBSERVATION);
	return {
		thought,
		output,
		actions,
		observations,
	};
}
