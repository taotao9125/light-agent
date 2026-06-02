import type { AgentEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import { pipe, stringify, toRoundMap, truncateText } from './helpers';
import type { ContextBuildInput, ContextBuildOuput, ContextBuildStrategy, Rule } from './types';

const BASE_RULES: Rule[] = [
	{
		name: 'Base Agent Runtime Rules',
		content: [
			'## Identity',
			'- You are an agent running inside an event-driven runtime.',
			'- You help the user complete tasks by reasoning, using tools, observing results, and producing final output.',
			'',
			'## Event Protocol',
			'- Your work follows this semantic loop: input -> thought -> action -> observation -> output.',
			'- input is the user or system request.',
			'- thought is your reasoning about the next step.',
			'- action is a tool call.',
			'- observation is the result of a tool call.',
			'- output is your response to the user.',
			'',
			'## Tool Use',
			'- Use actions when you need external information or external effects.',
			'- After each action, wait for its observation before deciding the next step.',
			'- If an observation reports an error, use it to adjust your next step.',
			'- Do not claim that an action succeeded unless the observation confirms it.',
			'',
			'## Completion',
			'- Continue the loop until the task is complete, blocked, or requires user input.',
			'- When no more action is needed, produce output.',
			'- If the task is blocked, explain the blocker clearly.',
		].join('\n'),
	},
];

const CHAR_LENGTH_PER_TOKEN = 4;

function formatRulesToPrompt(ruleTitle: string, rules: Rule[]): string {
	if (!rules.length) return '';
	const rulePrompts = [
		`# ${ruleTitle}`,
		rules.map((rule) => {
			return [rule.name ? `## Rule: ${rule.name}` : '', rule.content].filter(Boolean).join('\n\n');
		}),
	].join('\n\n');

	return rulePrompts;
}

/** keep latest x rounds, not turns */
function keepRecentRounds(maxRecentRounds: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		const eventRounds = [...toRoundMap(events).values()];
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
function rebuildEvents(contextBuildStrategy: ContextBuildStrategy) {
	return pipe<AgentEvent[]>(
		cleanEvents(EventType.AGENT_STOP),
		keepRecentRounds(contextBuildStrategy.keepRecentRounds ?? Infinity),
		truncateObservation(contextBuildStrategy.maxSingleObservationToken ?? Infinity),
	);
}

function rebuildSystemPrompt(rules: Rule[]) {
	return [
		formatRulesToPrompt('BASE AGENT RUNTIME RULES', BASE_RULES),
		formatRulesToPrompt('PROJECT RULES', rules),
	].join('\n\n');
}

export default function contextBuilder(input: ContextBuildInput & { events: AgentEvent[] }): ContextBuildOuput {
	const { source, contextBuildStrategy, events } = input;

	return {
		systemPrompt: rebuildSystemPrompt(source.rules ?? []),
		events: rebuildEvents(contextBuildStrategy)(events),
	};
}
