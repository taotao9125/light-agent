import { type AgentEvent, EventType } from '../protocol/events';

export const stringifyContent = (content: unknown): string => {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
};

export function splitEventsToGroups(events: AgentEvent[]): AgentEvent[][] {
	const groups = new Map<string, AgentEvent[]>();
	for(const event of events) {
		const roundId = event.meta!.roundId;
		if (!groups.has(roundId)) {
			groups.set(roundId, []);
		}
		groups.get(roundId)!.push(event);
	}

	return [...groups.values()]; 
}

export function parseEventGroup(group: AgentEvent[]) {
	const input = group.find((event) => event.type === EventType.INPUT);
	const thought = group.find((event) => event.type === EventType.THOUGHT);
	const output = group.find((event) => event.type === EventType.OUTPUT);
	const actions = group.filter((event) => event.type === EventType.ACTION);
	const observations = group.filter((event) => event.type === EventType.OBSERVATION);
	return {
		input,
		thought,
		output,
		actions,
		observations,
	};
}
