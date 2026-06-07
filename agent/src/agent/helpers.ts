import type { AgentEvent, AgentStopCause, Meta } from '../protocol/events';
import { EventType } from '../protocol/events';

export type SessionEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'action_call'; id: string; name: string; args: Record<string, unknown>; meta?: Meta }
	| { type: 'action_result'; id: string; name: string; result: unknown; isError: boolean; meta?: Meta }
	| { type: 'agent_stop'; cause: AgentStopCause; message: string; meta?: Meta };

export type AgentEventListener = (event: SessionEvent) => void;

export function projectAgentEvents(event: AgentEvent): SessionEvent[] {
	switch (event.type) {
		case EventType.INPUT:
			return [{ type: 'agent_start', meta: event.meta }];

		case EventType.THOUGHT_DELTA:
			return [{ type: 'thought_delta', text: event.text, meta: event.meta }];

		case EventType.OUTPUT_DELTA:
			return [{ type: 'output_delta', text: event.text, meta: event.meta }];

		case EventType.ACTION:
			return [
				{
					type: 'action_call',
					id: event.id,
					name: event.name,
					args: event.args,
					meta: event.meta,
				},
			];

		case EventType.OBSERVATION:
			return [
				{
					type: 'action_result',
					id: event.id,
					name: event.name,
					result: event.result,
					isError: event.isError,
					meta: event.meta,
				},
			];

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

export function truncateText(text: string, maxLength: number) {
	if (text.length <= maxLength) return text;
	const placeHolder = '\n\n...[truncated]...\n\n';

	if (maxLength <= placeHolder.length) return text.slice(0, maxLength);

	const budgetLength = maxLength - placeHolder.length;

	const headLength = Math.floor(budgetLength * 0.7);
	const tailLength = budgetLength - headLength;

	return text.slice(0, headLength) + placeHolder + text.slice(-tailLength);
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
