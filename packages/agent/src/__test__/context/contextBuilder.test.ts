/**
 * contextBuilder 集成测试 — 只通过 default export 测投影结果，不 export 内部函数。
 */

import { EventType } from '@light-agent/protocol/events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import contextBuilder from '../../context/contextBuilder.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, ThoughtEvent, ToolCallsEvent, ToolResultsEvent } from '@light-agent/protocol/events';

const ROUND_ID = 'round-1';
const MAX_WINDOW_TOKENS = 30_000;
const CHAR_LENGTH_PER_TOKEN = 4;

const mockGenerateText = vi.fn();

const mockVenderAdaptor = {
	_generateText: mockGenerateText,
	stream: vi.fn(),
} as unknown as Vender.Adaptor;

function estimateToken(text: string) {
	if (!text) return 0;
	return Math.round(text.length / CHAR_LENGTH_PER_TOKEN);
}

function toolTurn(
	roundId: string,
	turn: number,
	obsResult: string,
	options: { obsId?: string; isError?: boolean; intent?: string } = {},
): AgentEvent[] {
	const obsId = options.obsId ?? `call_${turn}`;
	return [
		{
			type: EventType.THOUGHT,
			text: `thought-${turn}`,
			meta: { roundId, turn },
		},
		{
			type: EventType.Tool_Calls,
			tool_calls: [
				{
					id: obsId,
					name: 'read_file',
					args: {
						path: `file-${turn}.ts`,
						...(options.intent ? { _intent: options.intent } : {}),
					},
				},
			],
			meta: { roundId, turn },
		},
		{
			type: EventType.Tool_Results,
			tool_results: [
				{
					id: obsId,
					name: 'read_file',
					result: obsResult,
					isError: options.isError ?? false,
				},
			],
			meta: { roundId, turn },
		},
	];
}

function inputEvent(roundId: string, turn: number, text: string): AgentEvent {
	return {
		type: EventType.INPUT,
		text,
		source: 'user',
		meta: { roundId, turn },
	};
}

function buildManyToolTurns(roundId: string, turnNumbers: number[], obsResult: string) {
	return turnNumbers.flatMap((turn) => toolTurn(roundId, turn, obsResult));
}

async function buildContext(
	events: AgentEvent[],
	lastWindowTokens = 0,
	overrides: Partial<{
		prompts: { name: string; content: string }[];
		skills: string[];
	}> = {},
) {
	return contextBuilder({
		prompts: overrides.prompts ?? [{ name: 'identity', content: 'test assistant' }],
		skills: overrides.skills ?? [],
		events,
		lastWindowTokens,
		venderAdaptor: mockVenderAdaptor,
	});
}

function findToolResults(events: AgentEvent[], roundId: string, turn: number) {
	return events.find(
		(event) =>
			event.type === EventType.Tool_Results && event.meta?.roundId === roundId && event.meta?.turn === turn,
	) as ToolResultsEvent | undefined;
}

function findThought(events: AgentEvent[], roundId: string, turn: number) {
	return events.find(
		(event) => event.type === EventType.THOUGHT && event.meta?.roundId === roundId && event.meta?.turn === turn,
	) as ThoughtEvent | undefined;
}

function findToolCalls(events: AgentEvent[], roundId: string, turn: number) {
	return events.find(
		(event) => event.type === EventType.Tool_Calls && event.meta?.roundId === roundId && event.meta?.turn === turn,
	) as ToolCallsEvent | undefined;
}

function writeFileTurn(roundId: string, turn: number, fileContent: string, obsId?: string): AgentEvent[] {
	const id = obsId ?? `call_${turn}`;
	return [
		{
			type: EventType.THOUGHT,
			text: `thought-${turn}`,
			meta: { roundId, turn },
		},
		{
			type: EventType.Tool_Calls,
			tool_calls: [
				{
					id,
					name: 'write_file',
					args: {
						path: `src/file-${turn}.ts`,
						content: fileContent,
					},
				},
			],
			meta: { roundId, turn },
		},
		{
			type: EventType.Tool_Results,
			tool_results: [
				{
					id,
					name: 'write_file',
					result: `File written successfully.\nPath: src/file-${turn}.ts\nBytes: ${fileContent.length}`,
					isError: false,
				},
			],
			meta: { roundId, turn },
		},
	];
}

describe('contextBuilder', () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockGenerateText.mockResolvedValue({
			text: 'mock-summary-text',
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		});
	});

	describe('systemPrompt', () => {
		it('应编译 identity 与 runtime instructions', async () => {
			const result = await buildContext([]);

			expect(result.systemPrompt).toContain('<identity_instructions>');
			expect(result.systemPrompt).toContain('test assistant');
			expect(result.systemPrompt).toContain('<context_window_instructions>');
		});

		it('应包含项目结构探索与 grep 边界说明', async () => {
			const result = await buildContext([]);

			expect(result.systemPrompt).toContain('list_project_files_tree：用于探索项目目录结构');
			expect(result.systemPrompt).toContain('若用户要求“分析项目架构”、而你还不知道项目目录结构，先调用它');
			expect(result.systemPrompt).toContain('它只有一个参数 searchStr');
			expect(result.systemPrompt).toContain('不要调用 grep({ searchStr: "." })');
			expect(result.systemPrompt).toContain(
				'grep({ searchStr: "Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id" })',
			);
			expect(result.systemPrompt).toContain('项目结构未知：先 list_project_files_tree');
		});

		it('传入 skills 时应包含 skill index', async () => {
			const skill = ['---', 'name: demo-skill', 'description: demo', '---', 'skill body'].join('\n');
			const result = await buildContext([], 0, { skills: [skill] });

			expect(result.systemPrompt).toContain('<skillIndex_instructions>');
			expect(result.systemPrompt).toContain('<name>demo-skill</name>');
		});
	});

	describe('hot/cold split & index', () => {
		it('最近 2 turn 保留 OBS 全文，更早 turn 变为 indexed 占位符', async () => {
			const fullText = `full-result-${'x'.repeat(500)}`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, fullText, { obsId: 'call_1' }),
				...toolTurn(ROUND_ID, 2, fullText, { obsId: 'call_2' }),
				...toolTurn(ROUND_ID, 3, fullText, { obsId: 'call_3' }),
				...toolTurn(ROUND_ID, 4, fullText, { obsId: 'call_4' }),
			];

			const result = await buildContext(events);

			const coldResult = findToolResults(result.events, ROUND_ID, 1);
			const hotResult = findToolResults(result.events, ROUND_ID, 4);

			expect(coldResult?.tool_results[0].result).toContain('[Indexed:tool_result:');
			expect(coldResult?.tool_results[0].result).toContain('recall_indexed("call_1")');
			expect(hotResult?.tool_results[0].result).toBe(fullText);
		});

		it('cold turn 的 THOUGHT 应被清空，hot turn 保留', async () => {
			const fullText = `full-${'y'.repeat(500)}`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, fullText),
				...toolTurn(ROUND_ID, 2, fullText),
				...toolTurn(ROUND_ID, 3, fullText),
			];

			const result = await buildContext(events);

			expect(findThought(result.events, ROUND_ID, 1)?.text).toBe('');
			expect(findThought(result.events, ROUND_ID, 3)?.text).toBe('thought-3');
		});

		it('小于 index 阈值的 cold OBS 不压缩', async () => {
			const smallText = 'small-obs';
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, smallText),
				...toolTurn(ROUND_ID, 2, smallText),
				...toolTurn(ROUND_ID, 3, smallText),
			];

			const result = await buildContext(events);
			const coldResult = findToolResults(result.events, ROUND_ID, 1);

			expect(coldResult?.tool_results[0].result).toBe(smallText);
		});

		it('isError 的 OBS 不 index', async () => {
			const errorText = `error-${'e'.repeat(500)}`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, errorText, { isError: true }),
				...toolTurn(ROUND_ID, 2, errorText),
				...toolTurn(ROUND_ID, 3, errorText),
			];

			const result = await buildContext(events);
			const coldResult = findToolResults(result.events, ROUND_ID, 1);

			expect(coldResult?.tool_results[0].result).toBe(errorText);
			expect(coldResult?.tool_results[0].result).not.toContain('[Indexed:tool_result:');
		});

		it('tool args 不应被 index', async () => {
			const fileContent = `export const value = '${'x'.repeat(500)}';`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...writeFileTurn(ROUND_ID, 1, fileContent, 'call_1'),
				...writeFileTurn(ROUND_ID, 2, fileContent, 'call_2'),
				...writeFileTurn(ROUND_ID, 3, fileContent, 'call_3'),
			];

			const result = await buildContext(events);
			const coldToolCall = findToolCalls(result.events, ROUND_ID, 1)?.tool_calls[0];
			const hotToolCall = findToolCalls(result.events, ROUND_ID, 3)?.tool_calls[0];

			expect(coldToolCall?.args.content).toBe(fileContent);
			expect(coldToolCall?.args.path).toBe('src/file-1.ts');
			expect(hotToolCall?.args.content).toBe(fileContent);
		});
	});

	describe('summary trigger', () => {
		it('lastWindowTokens + 最后 OBS 达到阈值时应生成 summary', async () => {
			const obsText = 'o'.repeat(400);
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...buildManyToolTurns(ROUND_ID, [1, 2, 3, 4], `chunk-${'a'.repeat(500)}`),
				{
					type: EventType.Tool_Results,
					tool_results: [{ id: 'call_final', name: 'read_file', result: obsText, isError: false }],
					meta: { roundId: ROUND_ID, turn: 5 },
				},
			];

			const delta = estimateToken(obsText);
			const lastWindowTokens = MAX_WINDOW_TOKENS - delta;

			const result = await buildContext(events, lastWindowTokens);

			expect(mockGenerateText).toHaveBeenCalledOnce();
			expect(result.summaryEvent?.text).toBe('mock-summary-text');
			expect(result.events[0].type).toBe(EventType.AGENT_SUMMARY);
			expect(result.events.at(-1)?.meta?.turn).toBe(5);
		});

		it('未超阈值时不应调用 summary LLM', async () => {
			const events = [inputEvent(ROUND_ID, 1, 'hello'), ...toolTurn(ROUND_ID, 1, 'small-result')];

			const result = await buildContext(events, 0);

			expect(mockGenerateText).not.toHaveBeenCalled();
			expect(result.summaryEvent).toBeNull();
		});

		it('summary meta 应指向 cold 末 turn 与 hot 末 turn', async () => {
			const obsText = 'o'.repeat(400);
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, `cold-${'a'.repeat(500)}`, { obsId: 'call_1' }),
				...toolTurn(ROUND_ID, 2, `cold-${'b'.repeat(500)}`, { obsId: 'call_2' }),
				...toolTurn(ROUND_ID, 3, `hot-${'c'.repeat(500)}`, { obsId: 'call_3' }),
				...toolTurn(ROUND_ID, 4, obsText, { obsId: 'call_4' }),
			];

			const delta = estimateToken(obsText);
			const result = await buildContext(events, MAX_WINDOW_TOKENS - delta);

			expect(result.summaryEvent?.meta?.endRoundId).toBe(ROUND_ID);
			expect(result.summaryEvent?.meta?.endTurn).toBe(2);
			expect(result.summaryEvent?.meta?.roundId).toBe(ROUND_ID);
			expect(result.summaryEvent?.meta?.turn).toBe(4);
		});

		it('只有 hot、没有 cold 时即使超阈值也不生成 summaryEvent', async () => {
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, `hot-${'h'.repeat(500)}`),
				...toolTurn(ROUND_ID, 2, `hot-${'h'.repeat(500)}`),
			];

			const result = await buildContext(events, MAX_WINDOW_TOKENS);

			expect(mockGenerateText).toHaveBeenCalledOnce();
			expect(result.summaryEvent).toBeNull();
		});
	});

	describe('token delta（anchor + 最后 INPUT/OBS）', () => {
		it('最后一条 INPUT 的增量可触发 summary', async () => {
			const inputText = 'u'.repeat(400);
			const bigObs = `chunk-${'a'.repeat(500)}`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, bigObs),
				...toolTurn(ROUND_ID, 2, bigObs),
				...toolTurn(ROUND_ID, 3, bigObs),
				inputEvent(ROUND_ID, 4, inputText),
			];

			const delta = estimateToken(inputText);
			const result = await buildContext(events, MAX_WINDOW_TOKENS - delta);

			expect(mockGenerateText).toHaveBeenCalledOnce();
			expect(result.summaryEvent).not.toBeNull();
		});

		it('最后一条 OUTPUT 时不叠加 OBS/INPUT 增量，不应误触发 summary', async () => {
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, `obs-${'a'.repeat(500)}`),
				...toolTurn(ROUND_ID, 2, `obs-${'b'.repeat(500)}`),
				{
					type: EventType.OUTPUT,
					text: 'final answer',
					meta: { roundId: ROUND_ID, turn: 3 },
				},
			];

			const result = await buildContext(events, MAX_WINDOW_TOKENS - 1);

			expect(mockGenerateText).not.toHaveBeenCalled();
			expect(result.summaryEvent).toBeNull();
		});
	});

	describe('preProcess after AGENT_SUMMARY', () => {
		it('应裁掉 summary checkpoint 之前的 history，summary 置于 view 前部', async () => {
			const archived = `archived-${'z'.repeat(500)}`;
			const recent = `recent-${'r'.repeat(100)}`;
			const events: AgentEvent[] = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, archived, { obsId: 'call_1' }),
				...toolTurn(ROUND_ID, 2, `middle-${'m'.repeat(500)}`, { obsId: 'call_2' }),
				{
					type: EventType.AGENT_SUMMARY,
					text: 'checkpoint summary',
					source: 'system',
					meta: {
						roundId: ROUND_ID,
						turn: 2,
						endRoundId: ROUND_ID,
						endTurn: 1,
					},
				},
				...toolTurn(ROUND_ID, 3, recent, { obsId: 'call_3' }),
			];

			const result = await buildContext(events, 0);

			expect(result.events[0].type).toBe(EventType.AGENT_SUMMARY);
			expect(result.events[0]).toMatchObject({ text: 'checkpoint summary' });
			expect(findToolResults(result.events, ROUND_ID, 1)).toBeUndefined();
			expect(findToolResults(result.events, ROUND_ID, 3)).toBeDefined();
		});
	});

	describe('strategyEnabled', () => {
		it('关闭策略时应原样返回 events，不 index、不 summary', async () => {
			const fullText = `full-${'x'.repeat(500)}`;
			const events = [
				inputEvent(ROUND_ID, 1, 'start'),
				...toolTurn(ROUND_ID, 1, fullText, { obsId: 'call_1' }),
				...toolTurn(ROUND_ID, 2, fullText, { obsId: 'call_2' }),
				...toolTurn(ROUND_ID, 3, fullText, { obsId: 'call_3' }),
			];

			const result = await contextBuilder({
				prompts: [{ name: 'identity', content: 'test assistant' }],
				skills: [],
				events,
				lastWindowTokens: MAX_WINDOW_TOKENS,
				venderAdaptor: mockVenderAdaptor,
				strategyEnabled: false,
			});

			expect(mockGenerateText).not.toHaveBeenCalled();
			expect(result.summaryEvent).toBeNull();
			expect(findToolResults(result.events, ROUND_ID, 1)?.tool_results[0].result).toBe(fullText);
			expect(findThought(result.events, ROUND_ID, 1)?.text).toBe('thought-1');
		});
	});
});
