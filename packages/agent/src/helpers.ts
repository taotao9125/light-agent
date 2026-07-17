import { EventType } from '@light-agent/protocol/events';

import type { AgentEvent, AgentStopCause, Meta, ToolCallsEvent, ToolResultEvent } from '@light-agent/protocol/events';

export type AgentViewEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'tool_calls'; tool_calls: ToolCallsEvent['tool_calls']; meta?: Meta }
	| { type: 'tool_results'; tool_results: Array<ToolResultEvent['tool_result']>; meta?: Meta }
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

		case EventType.Tool_Calls:
			return [{ type: 'tool_calls', tool_calls: event.tool_calls, meta: event.meta }];

		case EventType.Tool_Result:
			return [{ type: 'tool_results', tool_results: [event.tool_result], meta: event.meta }];

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
