import { EventType, ActionsEvent, ObservationsEvent } from '../../protocol/events';
import { pipe } from '../helpers';
import { buildPromptContext } from './promptContextBuilder';

import type { SSOTEvent, TraceEvent } from '../../protocol/events';
import type { Prompts } from './prompts.types';
import type { Vender } from '../../ai/index';

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
		events: SSOTEvent[];
		systemPrompt: string;
		indexedEventsMap: Map<string, { id: string; content: string; compressed: string; }>
	};
}

const CHAR_LENGTH_PER_TOKEN = 4;



export function truncateText(text: string, maxLength: number) {
	if (text.length <= maxLength) return text;
	const placeHolder = '\n\n...[truncated]...\n\n';

	if (maxLength <= placeHolder.length) return text.slice(0, maxLength);

	const budgetLength = maxLength - placeHolder.length;

	const headLength = Math.floor(budgetLength * 0.7);
	const tailLength = budgetLength - headLength;

	return text.slice(0, headLength) + placeHolder + text.slice(-tailLength);
}

function truncateObservation(maxSingleObservationToken: number) {
	const maxLength = maxSingleObservationToken * CHAR_LENGTH_PER_TOKEN;

	return (events: SSOTEvent[]): SSOTEvent[] => {
		return events.map((event) => {
			if (event.type !== EventType.OBSERVATIONS) return event;

			return {
				...event,
				observations: event.observations.map((observation) => ({
					...observation,
					result: truncateText(observation.result, maxLength),
				})),
			};
		});
	};
}

function cleanEvents(eventType: string) {
	return (events: SSOTEvent[]) => events.filter((event) => event.type !== eventType);
}



function estimateToken(text: string) {
	if (!text) return 0;
	return Math.round(text.length / CHAR_LENGTH_PER_TOKEN);
}

type TokenStat = {
	// 各 turn input token 之和
	historyInputTokens: number;
	// 各 turn output token 之和
	historyOutputTokens: number;
	// 各 turn total token 之和
	historyTotalTokens: number;
	// 最后一个 turn 的 total token
	lastContextWindowTokens: number;
	// 每个 round 的账单, 基于各 turn 的累加
	roundBills: Map<
		string,
		{
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
			// 每个 turn 的账单
			turnBills: Map<
				number,
				{
					inputTokens: number;
					outputTokens: number;
					totalTokens: number;
				}
			>;
		}
	>;
};

function toRounCostsMap(traces: TraceEvent[]) {
	const tokenStat: TokenStat = {
		historyInputTokens: 0,
		historyOutputTokens: 0,
		historyTotalTokens: 0,
		lastContextWindowTokens: 0,
		roundBills: new Map(),
	};

	for (const event of traces) {
		const roundId = event.meta?.roundId;
		const turnIndex = event.meta?.turn;
		if (!roundId || typeof turnIndex !== 'number') continue;

		const roundBills = tokenStat.roundBills;

		let currentRoundBill = roundBills.get(roundId);

		if (!currentRoundBill) {
			currentRoundBill = {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				turnBills: new Map(),
			};

			roundBills.set(roundId, currentRoundBill);
		}

		const turnBills = currentRoundBill.turnBills;

		let currentTurnBill = turnBills.get(turnIndex);

		if (!currentTurnBill) {
			currentTurnBill = {
				inputTokens: event.costs.inputTokens,
				outputTokens: event.costs.outputTokens,
				totalTokens: event.costs.totalTokens,
			};

			turnBills.set(turnIndex, currentTurnBill);
		}
	}

	const roundBills = tokenStat.roundBills;

	for (const [_, roundBill] of roundBills) {
		const turnBillList = [...roundBill.turnBills.values()];

		const turnBillAcc = turnBillList.reduce(
			(acc, curTurnBill) => {
				acc.inputTokens += curTurnBill.inputTokens;
				acc.outputTokens += curTurnBill.outputTokens;
				acc.totalTokens += curTurnBill.totalTokens;
				return acc;
			},
			{
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
		);

		roundBill.inputTokens = turnBillAcc.inputTokens;
		roundBill.outputTokens = turnBillAcc.outputTokens;
		roundBill.totalTokens = turnBillAcc.totalTokens;

		// 最后一个 turn 的 total token 等于最后一个 context window token, 为下一个 prompt 做 context 预算处理
		tokenStat.lastContextWindowTokens = turnBillList[turnBillList.length - 1].totalTokens;
		tokenStat.historyInputTokens += roundBill.inputTokens;
		tokenStat.historyOutputTokens += roundBill.outputTokens;
		tokenStat.historyTotalTokens += roundBill.totalTokens;
	}

	return tokenStat;
}

function rebuildEvents(strategy: Context.Strategy) {
	return pipe<SSOTEvent[]>(
		cleanEvents(EventType.AGENT_STOP),
		//keepRecentRounds(strategy.keepRecentRounds ?? Infinity),
		// truncateObservation(strategy.maxSingleObservationToken ?? Infinity),
	);
}



function getIntent(args: Record<string, unknown>): string {
	if (typeof args._intent === 'string') {
		return args._intent;
	}
	return '';
}



type RoundMap = Map<string, Map<number, SSOTEvent[]>>;

function parseEventsIntoRoundMap(events: SSOTEvent[]): RoundMap {
	const roundMap: RoundMap = new Map();

	for (const event of events) {
		const roundId = event.meta?.roundId;
		const turnIndex = event.meta?.turn;

		if (!roundId || typeof turnIndex !== 'number') continue;


		if (!roundMap.get(roundId)) {
			roundMap.set(roundId, new Map());
		}

		if (!roundMap.get(roundId)?.get(turnIndex)) {
			roundMap.get(roundId)?.set(turnIndex, []);
		}

		const currentTurn = roundMap.get(roundId)?.get(turnIndex);

		currentTurn?.push(event);

	}

	return roundMap;
}




// Context 构建策略：静态常驻 + 动态可回溯 + 摘要兜底。
//
// 总体原则：
// - 静态上下文保持稳定，减少 prompt 前缀抖动，尽量提升 KV cache 命中。
// - 动态上下文不追求全量常驻，而是优先变成可回溯记忆。
// - 有损摘要只作为二级兜底，不作为默认事实源。
//
// 1. Static context
// - system prompts、runtime instructions、product instructions 以 XML block 注入。
// - skill 也属于 instructions，但只注入 skill index，不注入 SKILL.md 全文。
// - 模型根据 skill index 按需读取具体 SKILL.md。
// - 静态块的顺序、格式、tag 尽量稳定。
//
// 2. Dynamic context
// - events 按 turn 构建模型视图，而不是按 round。
// - 最近 N 个 committed turns 保留原文，默认 N=2。
// - 更早的 turns 不再全量进入 context，而是投影为可回溯结构：
//   a. historyNotes：阶段性笔记，用于帮助模型快速回忆过去发生了什么。
//   b. historyIndex：证据目录，指向 SSOT event log 中的原始 event。
// - 精确历史细节必须通过 search_history / read_history 回溯。
// - SSOT event log 永远保留，不被摘要覆盖或删除。
//
// 2.1 Recoverable compression
// - 对 recent turns 之前的历史进行索引化裁剪。
// - 裁剪目标不是让模型“记住一切”，而是让模型在需要时能找到原始证据。
// - 设计必须保证 recall path 精确：historyNotes -> historyIndex -> SSOT ref。
// - 不能保证弱模型一定会主动 recall；但要保证有能力 recall 的模型能根据线索找回丢失细节。
// - historyNotes / historyIndex 不是事实源，只是导航层；精确事实以 read_history 返回的 SSOT 内容为准。
//
// 2.2 Lossy fallback summary
// - 如果 static context + recent raw turns + historyNotes + visible historyIndex 仍超过 context window 预算，
//   再进行摘要总结压缩。
// - 摘要优先压缩旧 historyNotes / historyIndex，而不是直接覆盖 SSOT。
// - 摘要结果仍应保留 refs / indexRefs，避免成为不可验证的孤立结论。
// - 摘要是兜底策略，不是默认记忆机制。



type Action = ActionsEvent['actions'][number];
type Observation = ObservationsEvent['observations'][number];

// 尽可能给模型视角提供线索: 这是什么历史结果，状态是什么, 调用目的是什么，如果需要细节，恢复指令是什么
function compressObsContent(obs: Observation, action: Action) {

	// token 数量太小了, 也没必要压缩
	if (estimateToken(obs.result) <= 100) return obs.result;

	const callId = obs.id;
	const toolName = obs.name;
	const intent = getIntent(action.args);

	return [
		 // 这是什么历史结果, 状态
		`[Indexed:tool_result:${callId}]] success`,
		// 工具名
		`tool: ${toolName}`,
		// 调用目的
		`intent: ${intent}`,
		// 恢复指令
		`Recall if need: recall_indexed("${callId}")`
	].join('\n')

}


function compressEvents(events: SSOTEvent[]) {

	const roundsMap = parseEventsIntoRoundMap(events);
	const rencentHotTurnsLength = 2;
	const rencentHotRoundsLength = 2;

	const roundsIds = [...roundsMap.keys()];

	// agentEvent[][]
	const turns = [...roundsMap.values()].map(turn => [...turn.values()]).flat();

	const keepRecentTurnsEvents = turns.slice(-rencentHotTurnsLength).flat();
	const needProcessTurnsEvents = turns.slice(0, turns.length - rencentHotTurnsLength).flat();

	// 最近两个 round 之前的可以丢弃 thinking block;
	const needDropThinkingBlockRounds = roundsIds.slice(0, roundsIds.length - rencentHotRoundsLength);

	const indexedEventsMap: Context.BuildResult['indexedEventsMap'] = new Map();

	const compressedEvent: SSOTEvent[] = [];

	for (const event of needProcessTurnsEvents) {
		const roundId = event.meta?.roundId;
		const turn = event.meta?.turn;
		if (!roundId || typeof turn !== 'number') continue;

		switch (event.type) {
			case EventType.OBSERVATIONS:
				const obses = event.observations;
				const actionsEvent = needProcessTurnsEvents.find(
					event => event.type === EventType.ACTIONS && event.meta?.roundId === roundId && event.meta?.turn === turn
				) as ActionsEvent;

				const actions = actionsEvent.actions || [];

				compressedEvent.push({
					...event,
					observations: obses.map(obs => {
						const id = obs.id;
						const action = actions.find(action => action.id === id)!;
						const compressedContent = compressObsContent(obs, action);
						indexedEventsMap.set(id, { id, content: obs.result, compressed: compressedContent});
						return {
							...obs,
							// error 不用索引
							result: obs.isError ? obs.result : compressedContent,
						}
					})
				})
				break;
			case EventType.THOUGHT:
				// 最近两个 round 之前的可以丢弃 thinking block;
				compressedEvent.push({
					...event,
					text: needDropThinkingBlockRounds.includes(roundId) ? '' : event.text
				});
				break;
			default:
				compressedEvent.push(event);
		}

	}


	return {
		indexedEventsMap,
		events: [...compressedEvent, ...keepRecentTurnsEvents]
	}


}


// context_tokens_{t+1} = total_tokens_{t}（模型返回的上次总 token） + detal_obs(估算) + detal_input（估算）- 被索引压缩的
function estimateNextWindowContextTokens(events: SSOTEvent[], lastWindowTokens: number) {
	const deltaTokens = deltaObservationsTokens(events);
	return lastWindowTokens + deltaTokens;
}

// 下一个 turn 里面 token 估算来自新增的工具计算的 observations 或者新的 prompt input
function deltaObservationsTokens(events: SSOTEvent[]) {
	const lastEvent = events[events.length - 1];
	if (!lastEvent) {
		return 0;
	}

	if (lastEvent.type === EventType.OBSERVATIONS) {
		return lastEvent.observations.reduce((acc, obs) => {
			acc += estimateToken(obs.result);
			return acc;
		}, 0)
	}

	if (lastEvent.type === EventType.INPUT) {
		return estimateToken(lastEvent.text);
	}

	return 0;

}




// 构建成类似一个虚拟 dom 的树结构, 好用于构建结构化的 history content
function buildEventsToSummaryStructureText(events: SSOTEvent[]) {
	const roundsMap = parseEventsIntoRoundMap(events);
	const hotTurnsLength = 2;


	const allTurns = [...roundsMap.values()].map(round => [...round.values()]).flat();
	const hotTurnsEvents = allTurns.slice(-hotTurnsLength).flat();
	const coldTurnsEvents = allTurns.slice(0, allTurns.length - hotTurnsLength).flat();

}

// 让模型返回一个结构化的输出用于组装一个历史文本结构，为了结构稳定，需要用一个内部工具去让模型填参数
// <historySummary>
// Current goal:
// ...

// Topic
// Status: implemented
// - 旧 observation 使用 tool_call_id 建立索引。[ref: call_12]

// Recall catalog:
// - call_12: contextBuilder 源码 observation
// <historySummary>
function tryBuildSummary(events: SSOTEvent[]) {

}

export default async function contextBuilder(
	input: Context.Config & { events: SSOTEvent[]; traces: TraceEvent[]; venderAdaptor: Vender.Adaptor },
): Promise<Context.BuildResult> {
	const { prompts, events, traces, venderAdaptor } = input;
	const costs = toRounCostsMap(traces);

	const cleanedEvents = cleanEvents(EventType.AGENT_STOP)(events);
	const { events: compressedEvents, indexedEventsMap } = compressEvents(cleanedEvents);
	const nextWindowContextTokens = estimateNextWindowContextTokens(events, costs.lastContextWindowTokens);


	return {
		systemPrompt: buildPromptContext(prompts),
		events: compressedEvents,
		indexedEventsMap,
	};
}
