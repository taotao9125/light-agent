// Context 构建策略：静态常驻 + 动态可回溯 + 摘要兜底。
//
// 总体原则：
// - 静态上下文保持稳定，减少 prompt 前缀抖动，尽量提升 KV cache 命中。
// - 动态上下文不追求全量常驻，而是优先变成可回溯记忆。
// - 有损摘要只作为二级兜底，不作为默认事实源。

// token 窗口策略
// 展示用 api 返回的真值, 决策压缩用 api 返回的真值 + 本次 turn 的 agent 本地增量 token (如工具调用的结果)

import { EventType } from '@light-agent/protocol/events';
import { collectToolResultsForTurn } from '../helpers.ts';
import runtimePrompts, { historyCompressionSystemPrompt } from './prompts.consts.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, SummaryEvent, ToolCallsEvent, ToolResultEvent } from '@light-agent/protocol/events';

export namespace Context {
	export type Config = {
		prompts?: { name: string; content: string }[];
		skills?: string[];
		/** hot/cold index + summary; off = pass full history to the model */
		strategyEnabled?: boolean;
	};
	export type BuildResult = {
		events: AgentEvent[];
		systemPrompt: string;
		summaryEvent: SummaryEvent | null;
	};
}

const CHAR_LENGTH_PER_TOKEN = 4;

type Prompt = Context.Config['prompts'];
function buildPromptsToXML(prompts: Prompt = []): string {
	return prompts
		.map((prompt) => {
			const xmlTagName = `${prompt.name}_instructions`;
			return [`<${xmlTagName}>`, prompt.content, `</${xmlTagName}>`].join('\n');
		})
		.join('\n');
}

// ---
// name:
// description:
// ---
// ...content...
type SkillJson = { name: string; description: string; content: string };
function parseSkill(skillRaw: string): SkillJson {
	const textLines = skillRaw
		// 去掉BOM字节顺序, windows 可能有
		.replace(/^\uFEFF/, '')
		.trim()
		.split('\n')
		.filter((line) => line !== '\n');

	if (!textLines[0].startsWith('---')) throw new Error('SKILL.md 必须以 --- 开头');

	const closeHyphenIndex = textLines.indexOf('---', 3);

	if (closeHyphenIndex === -1) throw new Error('缺少结束的 ---');

	const frontmatterLines = textLines
		.slice(0, closeHyphenIndex)
		// 去掉 `---` 和 `#` 注释
		.filter((line) => line !== '---' && !line.startsWith('#'));
	const contentLines = textLines.slice(closeHyphenIndex + 1);
	const meta: Record<'name' | 'description', string> = { name: '', description: '' };
	for (const line of frontmatterLines) {
		// key:value
		const trimmedLine = line.trim();
		const i = trimmedLine.indexOf(':');
		const key = trimmedLine.slice(0, i).trim();
		const value = trimmedLine.slice(i + 1).trim();

		if (key === 'name') meta.name = value;
		if (key === 'description') meta.description = value;
	}

	if (!meta.name) throw new Error('skill 缺少 `name` 属性');
	if (!meta.description) throw new Error('skill 缺少 `description` 属性');

	return {
		name: meta.name,
		description: meta.description,
		content: contentLines.join('\n'),
	};
}

function buildSkillsToXML(skills: string[] = []) {
	const SKILL_USAGE_INSTRUCTIONS = [
		'当用户任务明显落在某个 skill 的领域内时：',
		'1. 先使用调用方提供的可用读取工具获取对应 SKILL.md 的完整说明',
		'2. 按 skill 中的流程与约束执行任务',
		'3. skill 内的领域规则以 SKILL 为准，但不违背 identity 与上述 instructions',
		'',
		'不要假设 skill 内容；未读取完整说明前不要声称已遵循某 skill。',
	].join('\n');

	const skillIndexesXml = skills
		.map((skillRaw) => {
			const skillJson = parseSkill(skillRaw);
			return [
				'<skill>',
				`<name>${skillJson.name}</name>`,
				`<description>${skillJson.description}</description>`,
				'</skill>',
			].join('\n');
		})
		.join('\n');

	return ['<skillIndex_instructions>', SKILL_USAGE_INSTRUCTIONS, '</skillIndex_instructions>', skillIndexesXml].join(
		'\n',
	);
}

function estimateToken(text: string) {
	if (!text) return 0;
	return Math.round(text.length / CHAR_LENGTH_PER_TOKEN);
}

function getIntent(args: Record<string, unknown>): string {
	if (typeof args._intent === 'string') {
		return args._intent;
	}
	return '';
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

type ToolCall = ToolCallsEvent['tool_calls'][number];
type ToolResult = ToolResultEvent['tool_result'];
const INDEX_MIN_CHARS = 100;

// 尽可能给模型视角提供线索: 这是什么历史结果，状态是什么, 调用目的是什么，如果需要细节，恢复指令是什么
function compressObsContent(obs: ToolResult, action: ToolCall) {
	if (obs.result.length <= INDEX_MIN_CHARS) return obs.result;
	const intent = getIntent(action.args);
	return [
		`[what]: indexed_tool_result id=${obs.id} tool=${obs.name}；完整正文已从当前上下文移出，并保存在历史索引中`,
		intent ? `[intent]: ${intent}` : undefined,
		`[how]: 如果后续判断必须依赖完整原文，调用 recall_indexed({ id: "${obs.id}" }) 召回；否则不要召回。`,
	]
		.filter(Boolean)
		.join('\n');
}

function compressEvents(events: AgentEvent[]) {
	const compressedEvent: AgentEvent[] = [];

	for (const event of events) {
		const roundId = event.meta?.roundId;
		const turn = event.meta?.turn;
		if (!roundId || typeof turn !== 'number') continue;

		switch (event.type) {
			case EventType.Tool_Calls: {
				compressedEvent.push(event);
				break;
			}
			case EventType.Tool_Result: {
				const toolCallsEvent = events.find(
					(item) =>
						item.type === EventType.Tool_Calls &&
						item.meta?.roundId === roundId &&
						item.meta?.turn === turn,
				) as ToolCallsEvent;

				const toolCalls = toolCallsEvent?.tool_calls || [];
				const obs = event.tool_result;
				const action = toolCalls.find((item) => item.id === obs.id);
				const compressedContent = action ? compressObsContent(obs, action) : '';

				compressedEvent.push({
					...event,
					tool_result: {
						...obs,
						result: obs.isError ? obs.result : compressedContent || obs.result,
					},
				});
				break;
			}
			case EventType.THOUGHT:
				compressedEvent.push({
					...event,
					text: '',
				});
				break;
			default:
				compressedEvent.push(event);
		}
	}

	return compressedEvent;
}

// 下一个 turn 的 token 增量能来自两个方向:
// 1. agent 执行工具调用拿到的结果（要喂个下一个 turn）
// 2. 一个 round 对话结束, 用户新增了一个对话 prompt
function countDeltaTokens(events: AgentEvent[]) {
	const lastEvent = events.at(-1);
	if (!lastEvent) {
		return 0;
	}

	if (lastEvent.type === EventType.Tool_Result) {
		const roundId = lastEvent.meta?.roundId;
		const turn = lastEvent.meta?.turn;

		if (!roundId || typeof turn !== 'number') {
			return estimateToken(lastEvent.tool_result.result);
		}

		return events.reduce((acc, event) => {
			if (event.type !== EventType.Tool_Result) return acc;
			if (event.meta?.roundId !== roundId || event.meta?.turn !== turn) return acc;
			return acc + estimateToken(event.tool_result.result);
		}, 0);
	}

	if (lastEvent.type === EventType.INPUT) {
		return estimateToken(lastEvent.text);
	}

	return 0;
}

function buildEventToXML(events: AgentEvent[]) {
	const lines: string[] = [];
	for (const event of events) {
		switch (event.type) {
			case EventType.INPUT:
				lines.push(['<userInput>', event.text, '</userInput>'].join('\n'));
				break;
			case EventType.THOUGHT:
				lines.push(['<assistantThought>', event.text, '</assistantThought>'].join('\n'));
				break;
			case EventType.OUTPUT:
				lines.push(['<assistantOutput>', event.text, '</assistantOutput>'].join('\n'));
				break;
			case EventType.Tool_Calls:
				lines.push(
					[
						'<toolCalls>',
						event.tool_calls
							.map((action) => {
								return [
									`<toolCall id="${action.id}" name="${action.name}">`,
									`<intent>${getIntent(action.args)}</intent>`,
									`<arguments>${JSON.stringify(action.args)}</arguments>`,
									'</toolCall>',
								].join('\n');
							})
							.join('\n'),
						'</toolCalls>',
					].join('\n'),
				);
				{
					const toolResults = collectToolResultsForTurn(
						events,
						event.tool_calls.map((action) => action.id),
					);
					if (toolResults.length) {
						lines.push(
							[
								'<toolResults>',
								toolResults
									.map((obs) => {
										return [`<toolResult isError="${obs.isError}">`, obs.result, '</toolResult>'];
									})
									.join('\n'),
								'</toolResults>',
							].join('\n'),
						);
					}
				}
				break;
			// 如果工具结果索引压缩后，运行多次任务后又超过窗口阈值，要进行摘要压缩，摘要压缩发给模型
			// 的是全量工具结果还是索引信息呢
			// 如果是索引信息？摘要后，会不会丢失索引
			// 如果是全量工具结果，那会不会可能直接撑爆模型的窗口大小，退一步，即使没撑爆，这么多信息模型会不会失焦点
			case EventType.Tool_Result:
				break;
		}
	}

	return lines.join('\n');
}

function buildTurnsToXML(turnMap: Map<number, AgentEvent[]>) {
	const lines: string[] = [];
	for (const [turnIndex, turn] of turnMap) {
		lines.push([`<turn index="${turnIndex}">`, buildEventToXML(turn), '</turn>'].join('\n'));
	}
	return lines.join('\n');
}

function buildRoundToXML(roundsMap: RoundMap) {
	const lines: string[] = [];
	for (const [roundId, round] of roundsMap) {
		lines.push([`<round id="${roundId}">`, buildTurnsToXML(round), '</round>'].join('\n'));
	}
	return lines.join('\n');
}

function buildEventsToXML(events: AgentEvent[]) {
	const roundsMap = parseEventsIntoRoundMap(events);
	return buildRoundToXML(roundsMap);
}

function cleanEvents(events: AgentEvent[]) {
	return events.filter((event) => event.type !== EventType.AGENT_STOP && event.type !== EventType.AGENT_TRACE);
}

function splitEventsBoundary(events: AgentEvent[], hotTurnLength = 2) {
	const roundsMap = parseEventsIntoRoundMap(events);
	const turns = [...roundsMap.values()].flatMap((turnMap) => [...turnMap.values()]);
	const hotTurns = turns.slice(-hotTurnLength);
	const coldTurns = turns.slice(0, turns.length - hotTurnLength);

	if (turns.length === hotTurnLength) {
		return {
			hotEvents: hotTurns.flat(),
			coldEvents: [],
		};
	}

	return {
		hotEvents: hotTurns.flat(),
		coldEvents: coldTurns.flat(),
	};
}

const recentHotTurnsLength = 2;
const maxWindowTokens = 200_000;
// |--------------------------------- round1 -------------------------------------------|
// |------------- turn1 ---------------|  |------------- turn2 --------|  |--- turn3 ---|
// input, thought, toolCalls, toolResults, thought, toolCalls, toolResults, thought, output

export default async function contextBuilder(config: {
	// 构建 prompt
	prompts: Context.Config['prompts'];
	// 构建 skill
	skills: Context.Config['skills'];
	// 构建索引, 摘要压缩
	events: AgentEvent[];
	lastWindowTokens: number;
	// 摘要压缩模型
	venderAdaptor: Vender.Adaptor;
	strategyEnabled?: boolean;
}): Promise<Context.BuildResult> {
	const { prompts, skills, events, lastWindowTokens, venderAdaptor, strategyEnabled = true } = config;

	const systemPrompt = [buildPromptsToXML(prompts), buildPromptsToXML(runtimePrompts), buildSkillsToXML(skills)].join(
		'\n',
	);

	const preProcessEvents = cleanEvents(events);

	if (!strategyEnabled) {
		return {
			systemPrompt,
			events: preProcessEvents,
			summaryEvent: null,
		};
	}

	const { coldEvents, hotEvents } = splitEventsBoundary(preProcessEvents, recentHotTurnsLength);
	let compressedColdEvents = compressEvents(coldEvents);
	const currentWindowTokens = lastWindowTokens + countDeltaTokens(events);
	let summaryEvent: SummaryEvent | null = null;

	// 当压缩后, currentWindowTokens 会变小, 下一个人 turn 模型视角是看到的压缩后的摘要, 然后返回新的账单
	if (currentWindowTokens >= maxWindowTokens) {
		const summaryHistory = await venderAdaptor._generateText({
			systemPrompt: historyCompressionSystemPrompt,
			messages: [
				{
					role: 'user',
					content: buildEventsToXML(compressedColdEvents),
				},
			],
		});

		const lastColdEvent = coldEvents.at(-1);
		const lastHotEvent = hotEvents.at(-1);

		if (lastColdEvent && lastHotEvent && lastColdEvent.meta && lastHotEvent.meta) {
			summaryEvent = {
				type: EventType.AGENT_SUMMARY,
				text: summaryHistory.text,
				source: 'system',
				meta: {
					// 第几个 round 第几个 turn 产生了摘要
					roundId: lastHotEvent.meta?.roundId,
					turn: lastHotEvent.meta?.turn,
					// 进行摘要压缩的事件范围
					endRoundId: lastColdEvent.meta?.roundId,
					endTurn: lastColdEvent.meta?.turn,
				},
			};
		}
	}

	if (summaryEvent) {
		compressedColdEvents = [summaryEvent];
	}

	return {
		systemPrompt,
		events: [...compressedColdEvents, ...hotEvents],
		summaryEvent,
	};
}
