import { type AgentEvent, EventType } from '../protocol/events';

export const stringifyContent = (content: unknown): string => {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
};

export function splitEventsByOutputEvent(events: AgentEvent[]): AgentEvent[][] {
	const eventGroups: AgentEvent[][] = [];
	let currentGroup: AgentEvent[] = [];

	for (const event of events) {
		currentGroup.push(event);
		if (event.type === EventType.OUTPUT) {
			eventGroups.push(currentGroup);
			currentGroup = [];
		}
	}

	if (currentGroup.length) {
		eventGroups.push(currentGroup);
	}

	return eventGroups;
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
