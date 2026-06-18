import { EventType, AgentEvent, ActionsEvent, ObservationsEvent } from '../../protocol/events';
import { pipe } from '../helpers';
import { buildPromptContext } from './promptContextBuilder';

import type { SSOTEvent, TraceEvent } from '../../protocol/events';
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
		events: SSOTEvent[];
		systemPrompt: string;
	};
}

const CHAR_LENGTH_PER_TOKEN = 4;

function keepRecentRounds(maxRecentRounds: number) {
	return (events: SSOTEvent[]): SSOTEvent[] => {
		const roundIds = events.map((event) => event.meta?.roundId).filter(Boolean);
		const uniqueRoundIds = [...new Set(roundIds)];
		const keepRecentIds = uniqueRoundIds.slice(-maxRecentRounds);
		return events.filter((event) => keepRecentIds.includes(event.meta?.roundId));
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



function _estimateToken(text: string) {
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


const thresholdSummary = {
	enabled: true,
	budgetTokens: 32000, // 模型 context 预算（或 prompt 侧上限）
	triggerRatio: 0.7, // 达到 70% 触发
	targetRatio: 0.55, // 压到 55% 停（滞回，防抖动）
	keepRecentRounds: 2, // 最近 N 个 round 永不总结
	keepActiveRound: true, // 当前 round 永不总结
	minRoundsBeforeSummary: 2, // 至少 2 个 completed round 才允许总结
};


function getIntent(args: Record<string, unknown>): string {
	if (typeof args._intent === 'string') {
		return args._intent;
	}
	return '';
}
function buildObsIndexs(events: SSOTEvent[]) {
	const actionEvents = events
		.filter(event => event.type === EventType.ACTIONS)
		.reduce((acc, { actions }) => {
			acc.push(...actions);
			return acc;
		}, [] as ActionsEvent['actions'])

	const observationEvents = events
		.filter(event => event.type === EventType.OBSERVATIONS)
		.reduce((acc, { observations }) => {
			acc.push(...observations);
			return acc;
		}, [] as ObservationsEvent['observations'])

	return actionEvents.map(action => {
		return {
			toolName: action.name,
			intent: getIntent(action.args),
			status: observationEvents.find(obs => obs.id === action.id)?.isError,

		}
	})




}



type RoundMap = Map<string, Map<number, AgentEvent[]>>;

function parseEventsIntoRoundMap(events: AgentEvent[]): RoundMap {
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



async function summaryHistory(events: AgentEvent[], traces: TraceEvent[]) {
	
	const costsMap = toRounCostsMap(traces);
	const nextContextInputTokens = costsMap.lastContextWindowTokens;

	// 超过阈值进行压缩，返回压缩摘要 string
	if (nextContextInputTokens >= thresholdSummary.budgetTokens * thresholdSummary.triggerRatio) {
		// const turns = map<turnIndex, AgentEvent[]>;
		// const needCompactTurns = turn.values().slice(-1);
		// const keepTurnsEvents = [...turn.values().slice(turn.values().length - 2)];
		// const summaryString await callLLM([...needCompactTurns]);
		// return [summaryEvent, ...keepTurnsEvents];
	}

	// 不用进行压缩
	return events;

}


function buildHistoryIndex(events: AgentEvent[]) {
	
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

export default function contextBuilder(
	input: Context.Config & { events: SSOTEvent[]; traces: TraceEvent[] },
): Context.BuildResult {
	const { prompts, strategy, events, traces } = input;
	return {
		systemPrompt: buildPromptContext(prompts),
		events: rebuildEvents(strategy)(events),
	};
}
