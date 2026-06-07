import {
	type ActionEvent,
	type AgentEvent,
	EventType,
	type ObservationEvent,
	type OutputEvent,
	type ThoughtEvent,
} from '../protocol/events';

/** 按 round / turn 分组 canonical events，供 context 裁剪与 adaptor 消息投影。 */
export namespace EventRound {
	export type Group = {
		input?: AgentEvent;
		turns: AgentEvent[][];
	};

	export type TurnParts = {
		thought?: ThoughtEvent;
		output?: OutputEvent;
		actions: ActionEvent[];
		observations: ObservationEvent[];
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
		return {
			thought: turnEvents.find((event): event is ThoughtEvent => event.type === EventType.THOUGHT),
			output: turnEvents.find((event): event is OutputEvent => event.type === EventType.OUTPUT),
			actions: turnEvents.filter((event): event is ActionEvent => event.type === EventType.ACTION),
			observations: turnEvents.filter((event): event is ObservationEvent => event.type === EventType.OBSERVATION),
		};
	}
}
