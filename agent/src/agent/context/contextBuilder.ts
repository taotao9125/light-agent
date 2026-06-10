import { EventType } from '../../protocol/events';
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

const _thresholdSummary = {
	enabled: true,
	budgetTokens: 32000, // 模型 context 预算（或 prompt 侧上限）
	triggerRatio: 0.7, // 达到 70% 触发
	targetRatio: 0.55, // 压到 55% 停（滞回，防抖动）
	keepRecentRounds: 2, // 最近 N 个 round 永不总结
	keepActiveRound: true, // 当前 round 永不总结
	minRoundsBeforeSummary: 2, // 至少 2 个 completed round 才允许总结
};

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

function _toRounCostsMap(traces: TraceEvent[]) {
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
				inputTokens: event.usage.inputTokens,
				outputTokens: event.usage.outputTokens,
				totalTokens: event.usage.totalTokens,
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
		keepRecentRounds(strategy.keepRecentRounds ?? Infinity),
		truncateObservation(strategy.maxSingleObservationToken ?? Infinity),
	);
}

export default function contextBuilder(
	input: Context.Config & { events: SSOTEvent[]; traces: TraceEvent[] },
): Context.BuildResult {
	const { prompts, strategy, events } = input;

	return {
		systemPrompt: buildPromptContext(prompts),
		events: rebuildEvents(strategy)(events),
	};
}
