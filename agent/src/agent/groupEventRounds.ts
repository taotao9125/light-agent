import { EventType } from '../protocol/events';

import type { ActionsEvent, AgentEvent, ObservationsEvent, OutputEvent, ThoughtEvent } from '../protocol/events';

/** 按 round / turn 分组 canonical events，供 context 裁剪与 adaptor 消息投影。 */
export namespace EventRound {
	export type Group = {
		input?: AgentEvent;
		turns: AgentEvent[][];
	};

	export type TurnParts = {
		thought?: ThoughtEvent;
		output?: OutputEvent;
		actions: ActionsEvent['actions'];
		observations: ObservationsEvent['observations'];
	};

	export function groupByRoundId(events: AgentEvent[]): Map<string, AgentEvent[]> {
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

	function groupByTurn(roundEvents: AgentEvent[]): Map<number, AgentEvent[]> {
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

	export function splitIntoRounds(events: AgentEvent[]): Group[] {
		return [...groupByRoundId(events).values()].map((roundEvents) => ({
			input: roundEvents.find((event) => event.type === EventType.INPUT),
			turns: [...groupByTurn(roundEvents).values()],
		}));
	}

	export function parseTurn(turnEvents: AgentEvent[]): TurnParts {
		const actionsEvent = turnEvents.find((event): event is ActionsEvent => event.type === EventType.ACTIONS);
		const observationsEvent = turnEvents.find(
			(event): event is ObservationsEvent => event.type === EventType.OBSERVATIONS,
		);

		return {
			thought: turnEvents.find((event): event is ThoughtEvent => event.type === EventType.THOUGHT),
			output: turnEvents.find((event): event is OutputEvent => event.type === EventType.OUTPUT),
			actions: actionsEvent?.actions ?? [],
			observations: observationsEvent?.observations ?? [],
		};
	}
}
