import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import AgentLoop from '../agentLoop.ts';
import ToolRegistry from '../tool.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent } from '@light-agent/protocol/events';

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('AgentLoop', () => {
	it('应在单个工具完成后立即 emit Tool_Result', async () => {
		let streamCallCount = 0;
		const venderAdaptor = {
			async *stream() {
				streamCallCount++;
				if (streamCallCount === 1) {
					yield {
						type: EventType.Tool_Calls,
						tool_calls: [
							{
								id: 'slow_call',
								name: 'delay_tool',
								args: { ms: 30, label: 'slow', _intent: '测试慢工具' },
							},
							{
								id: 'fast_call',
								name: 'delay_tool',
								args: { ms: 1, label: 'fast', _intent: '测试快工具' },
							},
						],
					};
					return;
				}

				yield { type: EventType.OUTPUT, text: 'done' };
			},
			_generateText: vi.fn(),
		} as unknown as Vender.Adaptor;

		const toolRegistry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));
		toolRegistry.register({
			name: 'delay_tool',
			description: '延迟后返回 label',
			schema: z.object({
				ms: z.number(),
				label: z.string(),
			}),
			async execute(args) {
				await wait(args.ms);
				return { isError: false, content: args.label };
			},
		});

		const loop = new AgentLoop({ venderAdaptor, toolRegistry, retry: { retries: 0 } });
		const events: AgentEvent[] = [];
		loop.on((event) => {
			events.push(event);
		});

		await loop.prompt('run tools', {
			abortSignal: new AbortController().signal,
			pullContextSnap: async () => ({ systemPrompt: '', events: [], summaryEvent: null }),
		});

		const toolResultEvents = events.filter((event) => event.type === EventType.Tool_Result);

		expect(toolResultEvents).toHaveLength(2);
		expect(toolResultEvents[0]?.tool_result.id).toBe('fast_call');
		expect(toolResultEvents[0]?.tool_result.result).toBe('fast');
		expect(toolResultEvents[1]?.tool_result.id).toBe('slow_call');
		expect(toolResultEvents[1]?.tool_result.result).toBe('slow');
		expect(events.at(-1)).toMatchObject({ type: EventType.OUTPUT, text: 'done' });
	});
});
