import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it } from 'vitest';
import buildContextSnap from '../../context/buildContextSnap.ts';

import type { AgentEvent } from '@light-agent/protocol/events';

describe('buildContextSnap', () => {
	it('应统计 canonical 与 prompt 的压缩指标', () => {
		const longResult = 'x'.repeat(120);
		const canonicalEvents: AgentEvent[] = [
			{
				type: EventType.INPUT,
				text: 'hello',
				source: 'user',
				meta: { roundId: 'round-1', turn: 1 },
			},
			{
				type: EventType.THOUGHT,
				text: 'thinking hard',
				meta: { roundId: 'round-1', turn: 1 },
			},
			{
				type: EventType.Tool_Calls,
				tool_calls: [{ id: 'a1', name: 'read_file', args: { path: 'a.ts', _intent: 'read' } }],
				meta: { roundId: 'round-1', turn: 1 },
			},
			{
				type: EventType.Tool_Results,
				tool_results: [{ id: 'a1', name: 'read_file', result: longResult, isError: false }],
				meta: { roundId: 'round-1', turn: 1 },
			},
		];

		const indexedResult = [
			'[Indexed:tool_result:a1]] success',
			'tool: read_file',
			'intent: read',
			'Recall if need: recall_indexed("a1")',
		].join('\n');

		const snap = {
			systemPrompt: '<system>rules</system>',
			summaryEvent: null,
			tools: [],
			events: [
				{
					type: EventType.INPUT,
					text: 'hello',
					source: 'user',
					meta: { roundId: 'round-1', turn: 1 },
				},
				{
					type: EventType.THOUGHT,
					text: '',
					meta: { roundId: 'round-1', turn: 1 },
				},
				{
					type: EventType.Tool_Calls,
					tool_calls: [{ id: 'a1', name: 'read_file', args: { path: 'a.ts', _intent: 'read' } }],
					meta: { roundId: 'round-1', turn: 1 },
				},
				{
					type: EventType.Tool_Results,
					tool_results: [{ id: 'a1', name: 'read_file', result: indexedResult, isError: false }],
					meta: { roundId: 'round-1', turn: 1 },
				},
			] as AgentEvent[],
		};

		const contextSnap = buildContextSnap({
			snap,
			canonicalEvents,
			strategyEnabled: true,
			lastWindowTokens: 1000,
		});

		expect(contextSnap.kind).toBe('context_snap');
		expect(contextSnap.meta).toEqual({ roundId: 'round-1', turn: 2 });
		expect(contextSnap.canonical.turnCount).toBe(1);
		expect(contextSnap.compression.indexedObs).toBe(1);
		expect(contextSnap.compression.indexedObsChars).toBe(120);
		expect(contextSnap.compression.indexedObsEstTokens).toBe(30);
		expect(contextSnap.compression.indexedObsSavedChars).toBeGreaterThan(0);
		expect(contextSnap.compression.indexedObsSavedEstTokens).toBeGreaterThan(0);
		expect(contextSnap.compression.totalSavedEstTokens).toBeGreaterThan(
			contextSnap.compression.indexedObsSavedEstTokens,
		);
		expect(contextSnap.compression.thoughtCharsDropped).toBe('thinking hard'.length);
		expect(contextSnap.compression.compressRatio).toBeGreaterThan(0);
		expect(contextSnap.prompt.systemCharCount).toBe(snap.systemPrompt.length);
		expect(contextSnap.window.lastWindowTokens).toBe(1000);
		expect(contextSnap.window.deltaTokens).toBeGreaterThan(0);
	});
});
