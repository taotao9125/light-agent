import { EventRound } from './groupEventRounds';
import type { AgentEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import { pipe, stringify, truncateText } from './helpers';

/** Context compiler: feed rules/skills in, model-visible view out. */
export namespace Context {
	export type RuleLayer = 'runtime' | 'product' | 'project';

	export type Rule = {
		layer: RuleLayer;
		content: string;
		name: string;
		path?: string;
	};

	export type SkillIndex = {
		name: string;
		description: string;
		path: string;
	};

	export type BuildStrategy = {
		maxSingleObservationToken?: number;
		keepRecentRounds?: number;
	};

	export type Source = {
		rules?: Rule[];
		skills?: SkillIndex[];
	};

	export type BuildInput = {
		source: Source;
		contextBuildStrategy: BuildStrategy;
	};

	export type BuildResult = {
		events: AgentEvent[];
		systemPrompt: string;
	};
}

const CHAR_LENGTH_PER_TOKEN = 4;

function formatRulesToPrompt(rules: Context.Rule[]): string {
	if (!rules.length) return '';

	return rules
		.map((rule) => {
			return [rule.name ? `## Rule: ${rule.name}` : '', rule.content].filter(Boolean).join('\n\n');
		})
		.join('\n\n');
}

/** keep latest x rounds, not turns */
function keepRecentRounds(maxRecentRounds: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		const eventRounds = [...EventRound.groupByRoundId(events).values()];
		if (eventRounds.length <= maxRecentRounds) return eventRounds.flat();
		return eventRounds.slice(-maxRecentRounds).flat();
	};
}

/** truncate observation result if it exceed token budget. */
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
	return (events: AgentEvent[]) => {
		return events.filter((event) => event.type !== eventType);
	};
}

// canonical events rebuild pipe line: window first, then truncate
function rebuildEvents(contextBuildStrategy: Context.BuildStrategy) {
	return pipe<AgentEvent[]>(
		cleanEvents(EventType.AGENT_STOP),
		keepRecentRounds(contextBuildStrategy.keepRecentRounds ?? Infinity),
		truncateObservation(contextBuildStrategy.maxSingleObservationToken ?? Infinity),
	);
}

function rebuildSystemPrompt(rules: Context.Rule[] = []) {
	return formatRulesToPrompt(rules);
}

export default function contextBuilder(input: Context.BuildInput & { events: AgentEvent[] }): Context.BuildResult {
	const { source, contextBuildStrategy, events } = input;

	return {
		systemPrompt: rebuildSystemPrompt(source.rules),
		events: rebuildEvents(contextBuildStrategy)(events),
	};
}
