import { EventType } from '../../protocol/events';

import type { AgentEvent } from '../../protocol/events';
import type { Context } from './contextBuilder';

const CHAR_LENGTH_PER_TOKEN = 4;
const INDEXED_RESULT_PREFIX = '[Indexed:tool_result:';
const INDEXED_ARG_PREFIX = '[Indexed:tool_arg:';

export type ContextSnapRecord = {
	kind: 'context_snap';
	at: number;
	meta?: { roundId: string; turn: number };
	strategyEnabled: boolean;
	canonical: {
		eventCount: number;
		charCount: number;
		estTokens: number;
		turnCount: number;
	};
	prompt: {
		eventCount: number;
		charCount: number;
		estTokens: number;
		systemCharCount: number;
		systemEstTokens: number;
		historyCharCount: number;
		historyEstTokens: number;
	};
	compression: {
		compressRatio: number;
		indexedObs: number;
		indexedArgs: number;
		indexedObsChars: number;
		indexedObsEstTokens: number;
		indexedObsSavedChars: number;
		indexedObsSavedEstTokens: number;
		indexedArgsChars: number;
		indexedArgsEstTokens: number;
		indexedArgsSavedChars: number;
		indexedArgsSavedEstTokens: number;
		thoughtCharsDropped: number;
		thoughtSavedEstTokens: number;
		totalSavedEstTokens: number;
		summaryActive: boolean;
		summaryTriggered: boolean;
	};
	window: {
		lastWindowTokens: number;
		deltaTokens: number;
	};
};

function estimateToken(charCount: number) {
	if (!charCount) return 0;
	return Math.round(charCount / CHAR_LENGTH_PER_TOKEN);
}

function estimateSavedToken(charCount: number) {
	if (!charCount) return 0;
	return Math.ceil(charCount / CHAR_LENGTH_PER_TOKEN);
}

function measureArgValue(value: unknown) {
	if (typeof value === 'string') return value.length;
	return JSON.stringify(value).length;
}

function measureEventsCharCount(events: AgentEvent[]) {
	let total = 0;

	for (const event of events) {
		switch (event.type) {
			case EventType.INPUT:
			case EventType.THOUGHT:
			case EventType.OUTPUT:
			case EventType.AGENT_SUMMARY:
				total += event.text.length;
				break;
			case EventType.ACTIONS:
				for (const action of event.actions) {
					total += action.name.length;
					for (const value of Object.values(action.args)) {
						total += measureArgValue(value);
					}
				}
				break;
			case EventType.OBSERVATIONS:
				for (const obs of event.observations) {
					total += obs.result.length;
				}
				break;
		}
	}

	return total;
}

function countTurns(events: AgentEvent[]) {
	const turns = new Set<string>();

	for (const event of events) {
		const roundId = event.meta?.roundId;
		const turn = event.meta?.turn;
		if (!roundId || typeof turn !== 'number') continue;
		turns.add(`${roundId}:${turn}`);
	}

	return turns.size;
}

function countDeltaTokens(events: AgentEvent[]) {
	const lastEvent = events.at(-1);
	if (!lastEvent) {
		return 0;
	}

	if (lastEvent.type === EventType.OBSERVATIONS) {
		return lastEvent.observations.reduce((acc, obs) => acc + estimateToken(obs.result.length), 0);
	}

	if (lastEvent.type === EventType.INPUT) {
		return estimateToken(lastEvent.text.length);
	}

	return 0;
}

function measureIndexSavings(canonicalEvents: AgentEvent[], promptEvents: AgentEvent[]) {
	const canonicalObs = new Map<string, string>();
	const canonicalArgs = new Map<string, unknown>();

	for (const event of canonicalEvents) {
		if (!event.meta) continue;

		if (event.type === EventType.OBSERVATIONS) {
			for (const obs of event.observations) {
				canonicalObs.set(`${event.meta.roundId}:${event.meta.turn}:${obs.id}`, obs.result);
			}
		}

		if (event.type === EventType.ACTIONS) {
			for (const action of event.actions) {
				for (const [fieldName, value] of Object.entries(action.args)) {
					canonicalArgs.set(
						`${event.meta.roundId}:${event.meta.turn}:${action.id}:${fieldName}`,
						value,
					);
				}
			}
		}
	}

	let indexedObs = 0;
	let indexedArgs = 0;
	let indexedObsChars = 0;
	let indexedObsSavedChars = 0;
	let indexedArgsChars = 0;
	let indexedArgsSavedChars = 0;

	for (const event of promptEvents) {
		if (!event.meta) continue;

		if (event.type === EventType.OBSERVATIONS) {
			for (const obs of event.observations) {
				if (obs.isError || !obs.result.includes(INDEXED_RESULT_PREFIX)) continue;

				indexedObs += 1;
				const canonicalResult = canonicalObs.get(`${event.meta.roundId}:${event.meta.turn}:${obs.id}`);
				if (!canonicalResult) continue;

				indexedObsChars += canonicalResult.length;
				indexedObsSavedChars += Math.max(0, canonicalResult.length - obs.result.length);
			}
		}

		if (event.type === EventType.ACTIONS) {
			for (const action of event.actions) {
				for (const [fieldName, value] of Object.entries(action.args)) {
					if (typeof value !== 'string' || !value.includes(INDEXED_ARG_PREFIX)) continue;

					indexedArgs += 1;
					const canonicalValue = canonicalArgs.get(
						`${event.meta.roundId}:${event.meta.turn}:${action.id}:${fieldName}`,
					);
					if (canonicalValue === undefined) continue;

					const canonicalLen = measureArgValue(canonicalValue);
					indexedArgsChars += canonicalLen;
					indexedArgsSavedChars += Math.max(0, canonicalLen - value.length);
				}
			}
		}
	}

	return {
		indexedObs,
		indexedArgs,
		indexedObsChars,
		indexedObsSavedChars,
		indexedArgsChars,
		indexedArgsSavedChars,
	};
}

function countThoughtCharsDropped(canonicalEvents: AgentEvent[], promptEvents: AgentEvent[]) {
	const promptThoughtByTurn = new Map<string, string>();

	for (const event of promptEvents) {
		if (event.type !== EventType.THOUGHT || !event.meta) continue;
		promptThoughtByTurn.set(`${event.meta.roundId}:${event.meta.turn}`, event.text);
	}

	let dropped = 0;

	for (const event of canonicalEvents) {
		if (event.type !== EventType.THOUGHT || !event.meta || !event.text) continue;

		const key = `${event.meta.roundId}:${event.meta.turn}`;
		const promptText = promptThoughtByTurn.get(key);
		if (promptText === '') {
			dropped += event.text.length;
		}
	}

	return dropped;
}

function filterCanonicalHistory(events: AgentEvent[]) {
	return events.filter(
		(event) => event.type !== EventType.AGENT_STOP && event.type !== EventType.AGENT_TRACE,
	);
}

function inferSnapMeta(canonicalEvents: AgentEvent[]) {
	const lastEvent = canonicalEvents.at(-1);
	if (!lastEvent?.meta) return undefined;

	if (lastEvent.type === EventType.OBSERVATIONS) {
		return {
			roundId: lastEvent.meta.roundId,
			turn: lastEvent.meta.turn + 1,
		};
	}

	return {
		roundId: lastEvent.meta.roundId,
		turn: lastEvent.meta.turn,
	};
}

export default function buildContextSnap(config: {
	snap: Context.BuildResult;
	canonicalEvents: AgentEvent[];
	strategyEnabled: boolean;
	lastWindowTokens: number;
}): ContextSnapRecord {
	const { snap, canonicalEvents, strategyEnabled, lastWindowTokens } = config;
	const canonicalHistory = filterCanonicalHistory(canonicalEvents);
	const canonicalCharCount = measureEventsCharCount(canonicalHistory);
	const historyCharCount = measureEventsCharCount(snap.events);
	const systemCharCount = snap.systemPrompt.length;
	const promptCharCount = systemCharCount + historyCharCount;
	const indexSavings = measureIndexSavings(canonicalHistory, snap.events);
	const thoughtCharsDropped = countThoughtCharsDropped(canonicalHistory, snap.events);
	const thoughtSavedEstTokens = estimateSavedToken(thoughtCharsDropped);
	const indexedObsSavedEstTokens = estimateSavedToken(indexSavings.indexedObsSavedChars);
	const indexedArgsSavedEstTokens = estimateSavedToken(indexSavings.indexedArgsSavedChars);
	const totalSavedEstTokens = indexedObsSavedEstTokens + indexedArgsSavedEstTokens + thoughtSavedEstTokens;
	const compressRatio =
		canonicalCharCount > 0 ? Number((1 - historyCharCount / canonicalCharCount).toFixed(4)) : 0;

	return {
		kind: 'context_snap',
		at: Date.now(),
		meta: inferSnapMeta(canonicalEvents),
		strategyEnabled,
		canonical: {
			eventCount: canonicalHistory.length,
			charCount: canonicalCharCount,
			estTokens: estimateToken(canonicalCharCount),
			turnCount: countTurns(canonicalHistory),
		},
		prompt: {
			eventCount: snap.events.length,
			charCount: promptCharCount,
			estTokens: estimateToken(promptCharCount),
			systemCharCount,
			systemEstTokens: estimateToken(systemCharCount),
			historyCharCount,
			historyEstTokens: estimateToken(historyCharCount),
		},
		compression: {
			compressRatio,
			indexedObs: indexSavings.indexedObs,
			indexedArgs: indexSavings.indexedArgs,
			indexedObsChars: indexSavings.indexedObsChars,
			indexedObsEstTokens: estimateToken(indexSavings.indexedObsChars),
			indexedObsSavedChars: indexSavings.indexedObsSavedChars,
			indexedObsSavedEstTokens,
			indexedArgsChars: indexSavings.indexedArgsChars,
			indexedArgsEstTokens: estimateToken(indexSavings.indexedArgsChars),
			indexedArgsSavedChars: indexSavings.indexedArgsSavedChars,
			indexedArgsSavedEstTokens,
			thoughtCharsDropped,
			thoughtSavedEstTokens,
			totalSavedEstTokens,
			summaryActive: snap.events.some((event) => event.type === EventType.AGENT_SUMMARY),
			summaryTriggered: snap.summaryEvent !== null,
		},
		window: {
			lastWindowTokens,
			deltaTokens: countDeltaTokens(canonicalEvents),
		},
	};
}
