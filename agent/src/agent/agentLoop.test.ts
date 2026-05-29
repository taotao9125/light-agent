import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProvider } from '../ai/index';
import type { AgentEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import AgentLoop from './agentLoop';

const mockToolGet = vi.fn();

vi.mock('../tools/index.js', () => ({
	default: {
		get: (name: string) => mockToolGet(name),
	},
}));

function createProvider(batches: AgentEvent[][]): AiProvider {
	let callIndex = 0;
	return {
		stream() {
			const chunks = batches[callIndex] ?? [];
			callIndex += 1;
			return (async function* () {
				for (const chunk of chunks) {
					yield chunk;
				}
			})();
		},
	};
}

function collectAgentEvents(loop: AgentLoop): AgentEvent[] {
	const events: AgentEvent[] = [];
	loop.on((event) => events.push(event));
	return events;
}

describe('AgentLoop', () => {
	beforeEach(() => {
		mockToolGet.mockReset();
	});

	it('prompt 发出 INPUT 并写入当前轮日志', async () => {
		const loop = new AgentLoop({
			provider: createProvider([[{ type: EventType.OUTPUT, text: 'done' }]]),
			model: 'test',
			tools: [],
		});

		await loop.prompt('hello');

		const log = loop.getCurrentPromptLog();
		expect(log[0]).toMatchObject({
			type: EventType.INPUT,
			text: 'hello',
			source: 'user',
		});
		expect(log.at(-1)).toMatchObject({
			type: EventType.OUTPUT,
			text: 'done',
		});
	});

	it('流式 OUTPUT 会发出 OUTPUT_DELTA 与最终 OUTPUT', async () => {
		const loop = new AgentLoop({
			provider: createProvider([[{ type: EventType.OUTPUT, text: 'hi' }]]),
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('say hi');

		expect(events.filter((e) => e.type === EventType.OUTPUT_DELTA)).toEqual([
			expect.objectContaining({ text: 'hi' }),
		]);
		expect(events.filter((e) => e.type === EventType.OUTPUT)).toEqual([expect.objectContaining({ text: 'hi' })]);
	});

	it('流式 THOUGHT 会发出 THOUGHT_DELTA 与最终 THOUGHT', async () => {
		const loop = new AgentLoop({
			provider: createProvider([
				[
					{ type: EventType.THOUGHT, text: 'a' },
					{ type: EventType.OUTPUT, text: 'b' },
				],
			]),
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('think');

		expect(events).toContainEqual(expect.objectContaining({ type: EventType.THOUGHT_DELTA, text: 'a' }));
		expect(events).toContainEqual(expect.objectContaining({ type: EventType.THOUGHT, text: 'a' }));
	});

	it('仅有 OUTPUT 时结束循环，不再请求下一轮', async () => {
		const batches: AgentEvent[][] = [
			[{ type: EventType.OUTPUT, text: 'once' }],
			[{ type: EventType.OUTPUT, text: 'should-not-run' }],
		];
		const loop = new AgentLoop({
			provider: createProvider(batches),
			model: 'test',
			tools: [],
		});

		await loop.prompt('once');

		expect(batches).toHaveLength(2);
	});

	it('ACTION 会调用工具并发出 OBSERVATION', async () => {
		mockToolGet.mockReturnValue({
			execute: vi.fn().mockResolvedValue({ content: 'tool-ok', isError: false }),
		});

		const loop = new AgentLoop({
			provider: createProvider([
				[
					{
						type: EventType.ACTION,
						id: 'call-1',
						name: 'echo',
						args: { x: 1 },
					},
					{ type: EventType.OUTPUT, text: 'final' },
				],
			]),
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('use tool');

		expect(mockToolGet).toHaveBeenCalledWith('echo');
		expect(events).toContainEqual(
			expect.objectContaining({
				type: EventType.OBSERVATION,
				id: 'call-1',
				name: 'echo',
				result: 'tool-ok',
				isError: false,
			}),
		);
	});

	it('流中出现未注册工具名时发出 AGENT_ERROR', async () => {
		mockToolGet.mockReturnValue(undefined);

		const loop = new AgentLoop({
			provider: createProvider([
				[
					{
						type: EventType.ACTION,
						id: 'x',
						name: 'missing',
						args: {},
					},
				],
			]),
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('bad tool');

		expect(events).toContainEqual(
			expect.objectContaining({
				type: EventType.AGENT_ERROR,
				message: expect.stringContaining('unknown tool'),
			}),
		);
	});

	it('无 action 且无 output 时发出 AGENT_ERROR', async () => {
		const loop = new AgentLoop({
			provider: createProvider([[]]),
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('empty');

		expect(events).toContainEqual(
			expect.objectContaining({
				type: EventType.AGENT_ERROR,
				message: expect.stringContaining('did not return'),
			}),
		);
	});

	it('超过 maxTurns 时停止并报错', async () => {
		mockToolGet.mockReturnValue({
			execute: vi.fn().mockResolvedValue({ content: 'ok', isError: false }),
		});

		const loop = new AgentLoop({
			provider: createProvider([
				[
					{
						type: EventType.ACTION,
						id: '1',
						name: 'echo',
						args: {},
					},
				],
				[
					{
						type: EventType.ACTION,
						id: '2',
						name: 'echo',
						args: {},
					},
				],
				[
					{
						type: EventType.ACTION,
						id: '3',
						name: 'echo',
						args: {},
					},
				],
			]),
			model: 'test',
			tools: [],
			maxTurns: 2,
		});
		const events = collectAgentEvents(loop);

		await loop.prompt('loop');

		expect(events).toContainEqual(
			expect.objectContaining({
				type: EventType.AGENT_ERROR,
				message: expect.stringContaining('max turns'),
			}),
		);
	});

	it('abortSignal 触发时发出 INTERRUPT', async () => {
		const controller = new AbortController();
		const loop = new AgentLoop({
			provider: {
				stream() {
					return (async function* () {
						yield { type: EventType.OUTPUT, text: 'partial' };
						await new Promise<void>((resolve) => {
							controller.signal.addEventListener('abort', () => resolve(), {
								once: true,
							});
						});
						controller.signal.throwIfAborted();
					})();
				},
			},
			model: 'test',
			tools: [],
		});
		const events = collectAgentEvents(loop);

		const pending = loop.prompt('abort me', { abortSignal: controller.signal });
		controller.abort('user cancelled');
		await pending;

		expect(events).toContainEqual(
			expect.objectContaining({
				type: EventType.INTERRUPT,
				reason: 'user cancelled',
			}),
		);
	});
});
