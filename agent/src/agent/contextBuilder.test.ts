/**
 * contextBuilder 集成测试
 *
 * 测的是「发给模型的 view」，不是 canonical log：
 * - truncateObservation：单条 observation 超 token 预算 → head/tail 截断
 * - keepRecentRounds：按 meta.roundId 保留最近 N 个完整 round
 * - pipe 顺序：先按 round 窗口裁剪，再 truncate（避免对已丢弃 round 做无用截断）
 */
import { describe, expect, it } from 'vitest';
import { type AgentEvent, EventType, type ObservationEvent } from '../protocol/events';
import contextBuilder from './contextBuilder';
import type { ContextBuildStrategy } from './types';

/** truncateText 插入的中间标记 */
const TRUNCATED_MARKER = '...[truncated]...';

/** 构造一个最小 round：input → thought → action → observation → output */
function roundEvents(roundId: string, index: number, observationResult: unknown = `result-${index}`): AgentEvent[] {
	return [
		{
			type: EventType.INPUT,
			text: `input-${index}`,
			source: 'user',
			meta: { roundId, turn: 0 },
		},
		{
			type: EventType.THOUGHT,
			text: `thought-${index}`,
			meta: { roundId, turn: 1 },
		},
		{
			type: EventType.ACTION,
			id: 'action',
			name: 'read_file',
			args: { path: `file-${index}.ts` },
			meta: { roundId, turn: 1 },
		},
		{
			type: EventType.OBSERVATION,
			id: 'obs',
			name: 'read_file',
			result: observationResult,
			isError: false,
			meta: { roundId, turn: 1 },
		},
		{
			type: EventType.OUTPUT,
			text: `output-${index}`,
			meta: { roundId, turn: 1 },
		},
	];
}

/** 连续生成 count 个 round，roundId 为 round-0 .. round-(count-1) */
function buildManyRounds(count: number): AgentEvent[] {
	return Array.from({ length: count }, (_, index) => {
		return roundEvents(`round-${index}`, index);
	}).flat();
}

/** 默认走公开 API；strategy 为空时 pipe 内用 Infinity，相当于不裁剪 */
function defaultInput(events: AgentEvent[], strategy: ContextBuildStrategy = {}) {
	return contextBuilder({
		events,
		source: {},
		contextBuildStrategy: strategy,
	});
}

function pickRounds(events: AgentEvent[]): string[] {
	return [...new Set(events.map((event) => event.meta?.roundId).filter(Boolean))] as string[];
}

describe('contextBuilder', () => {
	it('systemPrompt 应包含 base rules 与 project rules', () => {
		const context = defaultInput([], {
			maxSingleObservationToken: Infinity,
			keepRecentRounds: Infinity,
		});

		expect(context.systemPrompt).toContain('# BASE AGENT RUNTIME RULES');
		expect(context.systemPrompt).toContain('Event Protocol');

		const withProjectRules = contextBuilder({
			events: [],
			source: {
				rules: [{ name: 'Demo Rule', content: 'Always use tools when needed.' }],
			},
			contextBuildStrategy: {},
		});

		expect(withProjectRules.systemPrompt).toContain('# PROJECT RULES');
		expect(withProjectRules.systemPrompt).toContain('Always use tools when needed.');
	});

	it('应截断超长的 string 类型 observation', () => {
		// 对应 read_file 返回 string；10 token × 4 char/token = 40 字符预算
		const longText = 'x'.repeat(500);
		const events: AgentEvent[] = [
			{
				type: EventType.OBSERVATION,
				id: 'obs-1',
				name: 'read_file',
				result: longText,
				isError: false,
				meta: { roundId: 'round-0', turn: 1 },
			},
		];

		const context = defaultInput(events, { maxSingleObservationToken: 10 });

		const result = (context.events[0] as ObservationEvent).result;
		expect(result.length).toBeLessThan(longText.length);
		expect(result).toContain(TRUNCATED_MARKER);
	});

	it('应对非 string 的 observation 先 stringify 再截断', () => {
		// 对应 list_files 返回 object；先 stringify 再 truncate
		const files = Array.from({ length: 50 }, (_, index) => `file-${index}.ts`);
		const events: AgentEvent[] = [
			{
				type: EventType.OBSERVATION,
				id: 'obs-1',
				name: 'list_files',
				result: { content: files, isError: false },
				isError: false,
				meta: { roundId: 'round-0', turn: 1 },
			},
		];

		const context = defaultInput(events, { maxSingleObservationToken: 20 });
		const result = (context.events[0] as ObservationEvent).result;

		expect(typeof result).toBe('string');
		expect(result).toContain(TRUNCATED_MARKER);
		expect(result).toContain('file-0.ts');
	});

	it('应只保留最近 N 个 round', () => {
		// window 层：6 个 round 只留 round-4、round-5，整轮保留不拆 turn
		const events = buildManyRounds(6);
		const context = defaultInput(events, {
			keepRecentRounds: 2,
		});

		const roundIds = pickRounds(context.events);

		expect(roundIds).toEqual(['round-4', 'round-5']);
	});

	it('pipe 应先按 round 裁剪再 truncate', () => {
		// round-0 整轮丢弃，其中超长 observation 不做 truncate
		// 再 truncate：仅处理保留的 round-1 observation
		const events: AgentEvent[] = [
			...roundEvents('round-0', 0, 'o'.repeat(500)),
			...roundEvents('round-1', 1, 'n'.repeat(500)),
		];

		const context = defaultInput(events, {
			maxSingleObservationToken: 10,
			keepRecentRounds: 1,
		});

		expect(pickRounds(context.events)).toEqual(['round-1']);

		const observation = context.events.find((event) => event.type === EventType.OBSERVATION);
		expect(observation?.result).toContain(TRUNCATED_MARKER);
	});
});
