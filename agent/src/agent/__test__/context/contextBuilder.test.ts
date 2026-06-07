/**
 * contextBuilder 集成测试
 */
import { describe, expect, it } from 'vitest';

import { type AgentEvent, EventType, type ObservationEvent } from '../../../protocol/events';
import contextBuilder, { type Context } from '../../context/contextBuilder';

const TRUNCATED_MARKER = '...[truncated]...';

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

function buildManyRounds(count: number): AgentEvent[] {
	return Array.from({ length: count }, (_, index) => roundEvents(`round-${index}`, index)).flat();
}

function defaultInput(events: AgentEvent[], strategy: Context.Strategy = {}) {
	return contextBuilder({
		events,
		prompts: {
			identity: 'test',
		},
		strategy,
	});
}

function pickRounds(events: AgentEvent[]): string[] {
	return [...new Set(events.map((event) => event.meta?.roundId).filter(Boolean))] as string[];
}

describe('contextBuilder', () => {
	it('systemPrompt 应通过 prompts 编译 identity 与 runtime', () => {
		const context = contextBuilder({
			events: [],
			prompts: {
				identity: 'CLI assistant',
			},
			strategy: {},
		});

		expect(context.systemPrompt).toContain('<identity>');
		expect(context.systemPrompt).toContain('CLI assistant');
		expect(context.systemPrompt).toContain('<contextWindowInstructions>');
	});

	it('应截断超长的 string 类型 observation', () => {
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
		const events = buildManyRounds(6);
		const context = defaultInput(events, { keepRecentRounds: 2 });
		expect(pickRounds(context.events)).toEqual(['round-4', 'round-5']);
	});

	it('pipe 应先按 round 裁剪再 truncate', () => {
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
