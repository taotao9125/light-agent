import { EventType } from '../../protocol/events';
import { EventRound } from '../groupEventRounds';
import { pipe, stringify, truncateText } from '../helpers';
import { buildPromptContext } from './promptContextBuilder';

import type { AgentEvent } from '../../protocol/events';
import type { Prompts } from './prompts.types';

export type { Prompts } from './prompts.types';

/** Context builder：prompts + strategy + canonical events → 模型可见 view。 */
export namespace Context {
	/** events 裁剪策略（caller 可配）。 */
	export type Strategy = {
		maxSingleObservationToken?: number;
		keepRecentRounds?: number;
	};

	/** Agent 构造时传入的 context 配置。 */
	export type Config = {
		prompts: Prompts.Source;
		strategy: Strategy;
	};

	export type BuildResult = {
		events: AgentEvent[];
		systemPrompt: string;
	};
}

const CHAR_LENGTH_PER_TOKEN = 4;

function keepRecentRounds(maxRecentRounds: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		const eventRounds = [...EventRound.groupByRoundId(events).values()];
		if (eventRounds.length <= maxRecentRounds) return eventRounds.flat();
		return eventRounds.slice(-maxRecentRounds).flat();
	};
}

function truncateObservation(maxSingleObservationToken: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		return events.map((event) => {
			if (event.type !== EventType.OBSERVATION) return event;

			const result = typeof event.result === 'string' ? event.result : stringify(event.result);

			return {
				...event,
				result: truncateText(result, maxSingleObservationToken * CHAR_LENGTH_PER_TOKEN),
			};
		});
	};
}

function cleanEvents(eventType: string) {
	return (events: AgentEvent[]) => events.filter((event) => event.type !== eventType);
}

function rebuildEvents(strategy: Context.Strategy) {
	return pipe<AgentEvent[]>(
		cleanEvents(EventType.AGENT_STOP),
		keepRecentRounds(strategy.keepRecentRounds ?? Infinity),
		truncateObservation(strategy.maxSingleObservationToken ?? Infinity),
	);
}

export default function contextBuilder(input: Context.Config & { events: AgentEvent[] }): Context.BuildResult {
	const { prompts, strategy, events } = input;

	return {
		systemPrompt: buildPromptContext(prompts),
		events: rebuildEvents(strategy)(events),
	};
}
