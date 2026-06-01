import type { AgentEvent, Meta } from '../protocol/events';
import { EventType } from '../protocol/events';


export type SessionEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'agent_done'; meta?: Meta }
	| { type: 'agent_aborted'; reason?: unknown; meta?: Meta }
	| { type: 'agent_error'; message: string; meta?: Meta }
	| { type: 'input'; text: string; source?: 'user' | 'system'; meta?: Meta }
	| { type: 'thought_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'thought_done'; text: string; meta?: Meta }
	| { type: 'action_start'; id: string; name: string; args: Record<string, any>; meta?: Meta }
	| { type: 'action_done'; id: string; result: any; name: string; meta?: Meta }
	| { type: 'output_start'; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'output_done'; text: string; meta?: Meta }
	| { type: 'interrupt'; reason: string; meta?: Meta };


function getTurnKey(event: AgentEvent) {
	const { roundId, turn } = event.meta ?? {};
	if (!roundId || turn == null) return undefined;
	return `${roundId}:${turn}`;
}

export function createAgentEventProjector() {
	const activeThoughtTurns = new Set<string>();
	const activeOutputTurns = new Set<string>();
	return function projectAgentEvents(event: AgentEvent): SessionEvent[] {
		switch (event.type) {
			case EventType.INPUT:
				return [
					{ type: 'agent_start', meta: event.meta },
					{ type: 'input', text: event.text, source: event.source, meta: event.meta },
				];

			case EventType.THOUGHT_DELTA: {
				const key = getTurnKey(event);
				if (!key || activeThoughtTurns.has(key)) {
					return [{ type: 'thought_delta', text: event.text, meta: event.meta }];
				}

				activeThoughtTurns.add(key);
				return [
					{ type: 'thought_start', meta: event.meta },
					{ type: 'thought_delta', text: event.text, meta: event.meta },
				];
			}

			case EventType.THOUGHT: {
				const key = getTurnKey(event);
				if (key) activeThoughtTurns.delete(key);

				return [{ type: 'thought_done', text: event.text, meta: event.meta }];
			}

			case EventType.OUTPUT_DELTA: {
				const key = getTurnKey(event);
				if (!key || activeOutputTurns.has(key)) {
					return [{ type: 'output_delta', text: event.text, meta: event.meta }];
				}

				activeOutputTurns.add(key);

				return [
					{ type: 'output_start', meta: event.meta },
					{ type: 'output_delta', text: event.text, meta: event.meta },
				];
			}

			case EventType.OUTPUT: {
				const key = getTurnKey(event);
				if (key) activeOutputTurns.delete(key);

				return [{ type: 'output_done', text: event.text, meta: event.meta }];
			}

			case EventType.ACTION:
				return [
					{
						type: 'action_start',
						id: event.id,
						name: event.name,
						args: event.args,
						meta: event.meta,
					},
				];

			case EventType.OBSERVATION:
				return [
					{
						type: 'action_done',
						id: event.id,
						result: event.result,
						name: event.name,
						meta: event.meta,
					},
				];

			case EventType.AGENT_ERROR:
				activeThoughtTurns.clear();
				activeOutputTurns.clear();
				return [
					{
						type: 'agent_error',
						message: event.message,
						meta: event.meta,
					},
				];

			case EventType.INTERRUPT:
				activeThoughtTurns.clear();
				activeOutputTurns.clear();
				return [
					{
						type: 'interrupt',
						reason: event.reason,
						meta: event.meta,
					},
				];

			default:
				return [];
		}
	}
}



type Task<T> = (p: T) => T;
export function pipe<T>(...tasks: Task<T>[]) {
	return (initValue: T): T => {
		return tasks.reduce((acc, task) => {
			acc = task(acc);
			return acc;
		}, initValue)
	}
}



export function toRoundMap(events: AgentEvent[]) {
	const map = new Map<string, AgentEvent[]>();
	for (const event of events) {
		const roundId = event.meta?.roundId;
		if (!roundId) continue;

		if (!map.has(roundId)) {
			map.set(roundId, []);
		}
		map.get(roundId)?.push(event);
	}
	return map;
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