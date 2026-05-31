
import type { AgentEvent } from '../protocol/events';
import {EventType} from '../protocol/events';
import {pipe, toRoundMap, truncateText, stringify} from './helpers';


const BASE_RULE = [
	'# Base Agent Runtime Rules',
	'',
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
].join('\n');

type Rule = { content: string; name?: string; path?: string };
type ContextBuildStrategy = {
	maxSingleObservationToken?: number;
	keepRecentRounds?: number;
}
export type ContextSource = {
	cwd?: string;
	rules?: Rule[];
	skills?: string[];
	memories?: string[];
	contextBuildStrategy: ContextBuildStrategy
}

export type Context = {
	events: AgentEvent[];
	systemPrompt: string;
};

const CHAR_LENGTH_PER_TOKEN = 4;


function formatRules(rules: Rule[]): string {
	if (!rules.length) return '';
	const rulePrompts = [
		'# Project Rules',
		rules.map(rule => {
			return [
				rule.name ? `## Rule: ${rule.name}` : '',
				rule.content
			].filter(Boolean).join('\n\n')
		})
	].join('\n\n');

	return rulePrompts;
}



/** keep latest x rounds, not turns */
function keepRecentRounds(maxRecentRounds: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		const eventRounds = [...toRoundMap(events).values()];
		if (eventRounds.length <= maxRecentRounds) return eventRounds.flat();
		return eventRounds.slice(-maxRecentRounds).flat()
	}
}

/** truncate observation result if it exceed token budget. */
function rebuildObservation(maxSingleObservationToken: number) {
	return (events: AgentEvent[]): AgentEvent[] => {
		return events.map(event => {
			if (event.type !== EventType.OBSERVATION) return event;
			
			const result = typeof event.result === 'string'
				? event.result
				: stringify(event.result);

			return {
				...event,
				result: truncateText(result, maxSingleObservationToken * CHAR_LENGTH_PER_TOKEN)
				
			}
		})
	}
}

// canonical events rebuild pipe line
function rebuildEvents(contextBuildStrategy: ContextBuildStrategy) {
	return pipe<AgentEvent[]>(
		rebuildObservation(contextBuildStrategy.maxSingleObservationToken ?? Infinity),
		keepRecentRounds(contextBuildStrategy.keepRecentRounds ?? Infinity)
	)
}



export default function contextBuilder(input: ContextSource & { events: AgentEvent[] }): Context {
	const {
		events,
		rules = [],
		contextBuildStrategy
	} = input;
	return {
		systemPrompt: [
			BASE_RULE,
			formatRules(rules)
		].join('\n\n'),

		events: rebuildEvents(contextBuildStrategy)(events)
	};
}
