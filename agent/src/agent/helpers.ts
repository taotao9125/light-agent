import { EventType } from '../protocol/events';

import type { ActionsEvent, AgentEvent, AgentStopCause, Meta, ObservationsEvent } from '../protocol/events';

export type AgentViewEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'actions'; actions: ActionsEvent['actions']; meta?: Meta }
	| { type: 'observations'; observations: ObservationsEvent['observations']; meta?: Meta }
	| { type: 'agent_stop'; cause: AgentStopCause; message: string; meta?: Meta };

export type AgentViewListener = (event: AgentViewEvent) => void;

export function projectAgentView(event: AgentEvent): AgentViewEvent[] {
	switch (event.type) {
		case EventType.INPUT:
			return [{ type: 'agent_start', meta: event.meta }];

		case EventType.THOUGHT_DELTA:
			return [{ type: 'thought_delta', text: event.text, meta: event.meta }];

		case EventType.OUTPUT_DELTA:
			return [{ type: 'output_delta', text: event.text, meta: event.meta }];

		case EventType.ACTIONS:
			return [{ type: 'actions', actions: event.actions, meta: event.meta }];

		case EventType.OBSERVATIONS:
			return [{ type: 'observations', observations: event.observations, meta: event.meta }];

		case EventType.AGENT_STOP:
			return [
				{
					type: 'agent_stop',
					cause: event.cause,
					message: event.message,
					meta: event.meta,
				},
			];
		default:
			return [];
	}
}

type Task<T> = (p: T) => T;
export function pipe<T>(...tasks: Task<T>[]) {
	return (initValue: T): T => {
		return tasks.reduce((acc, task) => {
			acc = task(acc);
			return acc;
		}, initValue);
	};
}

export function stringify(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		// undefined value call String(undefined)
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
