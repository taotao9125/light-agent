import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Agent from '../agent.ts';
import createGrepTool from '../tools/createGrepTool.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent } from '@light-agent/protocol/events';

const mockVenderAdaptor: Vender.Adaptor = {
	async *stream() {},
	async _generateText() {
		return {
			text: '',
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
		};
	},
};

function createAgent(venderAdaptor: Vender.Adaptor = mockVenderAdaptor) {
	return new Agent({
		cwd: '/tmp/workspace',
		venderAdaptor,
		context: {},
	});
}

function createDeferred<T = void>() {
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	return { promise, resolve, reject };
}

async function waitFor(assertion: () => boolean) {
	const startedAt = Date.now();
	while (!assertion()) {
		if (Date.now() - startedAt > 1000) {
			throw new Error('等待条件超时');
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

describe('Agent 工具接口', () => {
	it('默认不应注册内置业务工具，但应注册 runtime recall 工具', () => {
		const agent = createAgent();

		expect(agent.tool.get('tree')).toBeUndefined();
		expect(agent.tool.get('grep')).toBeUndefined();
		expect(agent.tool.get('read_file')).toBeUndefined();
		expect(agent.tool.get('recall_indexed')?.description).toContain('召回已从当前上下文移出');
	});

	it('应允许调用方显式注册内置工具', () => {
		const agent = createAgent();

		agent.tool.register(createGrepTool());

		expect(agent.tool.get('grep')?.description).toContain('搜索一个已知普通字符串');
	});

	it('应通过 agent.tool 注册和移除工具', () => {
		const agent = createAgent();

		agent.tool.register({
			name: 'weather',
			description: '获取天气',
			schema: z.object({
				city: z.string().describe('城市名称'),
			}),
			execute: async ({ city }) => ({ isError: false, content: city }),
		});

		expect(agent.tool.get('weather')?.name).toBe('weather');
		expect(agent.tool.remove('weather')).toBe(true);
		expect(agent.tool.get('weather')).toBeUndefined();
	});

	it('不应暴露独立的 registerTool 接口', () => {
		const agent = createAgent();

		expect('registerTool' in agent).toBe(false);
	});

	it('内置 recall 工具应绑定当前 Agent 事件', async () => {
		const agent = createAgent() as unknown as {
			commitEvent: (event: AgentEvent) => Promise<void>;
			tool: Agent['tool'];
		};

		await agent.commitEvent({
			type: EventType.Tool_Result,
			tool_result: {
				id: 'call_1',
				name: 'read_file',
				result: '完整历史结果',
				isError: false,
			},
			meta: { roundId: 'round-1', turn: 1 },
		});
		const recallTool = agent.tool.get('recall_indexed');

		const result = await recallTool?.execute({ id: 'call_1', _intent: '召回历史结果' }, { cwd: '/tmp/workspace' });

		expect(result).toEqual({ isError: false, content: '完整历史结果' });
	});
});

describe('Agent prompt 队列', () => {
	it('应按顺序串行执行多个 prompt', async () => {
		const gates = [createDeferred(), createDeferred()];
		const startedPrompts: number[] = [];
		const venderAdaptor: Vender.Adaptor = {
			async *stream() {
				const index = startedPrompts.length;
				startedPrompts.push(index);
				await gates[index].promise;
				yield { type: EventType.OUTPUT, text: `第 ${index + 1} 次输出` };
			},
			async _generateText() {
				return {
					text: '',
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				};
			},
		};
		const agent = createAgent(venderAdaptor);

		const firstPrompt = agent.prompt('第一个问题');
		const secondPrompt = agent.prompt('第二个问题');

		await waitFor(() => startedPrompts.length === 1);
		expect(agent.getState()).toMatchObject({
			isRunning: true,
			queuedPrompts: 1,
		});

		gates[0].resolve();
		await firstPrompt;

		await waitFor(() => startedPrompts.length === 2);
		expect(startedPrompts).toEqual([0, 1]);

		gates[1].resolve();
		await secondPrompt;
		expect(agent.getState()).toMatchObject({
			isRunning: false,
			queuedPrompts: 0,
		});
	});

	it('interrupt 应取消当前运行 prompt，但不清空等待队列', async () => {
		const gates = [createDeferred(), createDeferred()];
		const startedPrompts: number[] = [];
		const venderAdaptor: Vender.Adaptor = {
			async *stream() {
				const index = startedPrompts.length;
				startedPrompts.push(index);
				await gates[index].promise;
				yield { type: EventType.OUTPUT, text: `第 ${index + 1} 次输出` };
			},
			async _generateText() {
				return {
					text: '',
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				};
			},
		};
		const agent = createAgent(venderAdaptor);

		const firstPrompt = agent.prompt('第一个问题');
		const secondPrompt = agent.prompt('第二个问题');

		await waitFor(() => startedPrompts.length === 1);
		agent.interrupt('用户取消');
		expect(agent.getState().queuedPrompts).toBe(1);

		gates[0].resolve();
		await firstPrompt;

		await waitFor(() => startedPrompts.length === 2);
		gates[1].resolve();
		await secondPrompt;
		expect(startedPrompts).toEqual([0, 1]);
	});

	it('工具执行时应拿到当前 prompt 的 signal', async () => {
		const toolGate = createDeferred();
		let capturedSignal: AbortSignal | undefined;
		let streamCalls = 0;
		const venderAdaptor: Vender.Adaptor = {
			async *stream() {
				streamCalls++;
				if (streamCalls === 1) {
					yield {
						type: EventType.Tool_Calls,
						tool_calls: [
							{
								id: 'call_1',
								name: 'capture_signal',
								args: { _intent: '验证工具中断信号' },
							},
						],
					};
					return;
				}

				yield { type: EventType.OUTPUT, text: '完成' };
			},
			async _generateText() {
				return {
					text: '',
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				};
			},
		};
		const agent = createAgent(venderAdaptor);
		agent.tool.register({
			name: 'capture_signal',
			description: '捕获当前 prompt 的中断信号',
			schema: z.object({}),
			execute: async (_args, context) => {
				capturedSignal = context?.signal;
				await toolGate.promise;
				return { isError: false, content: 'ok' };
			},
		});

		const runningPrompt = agent.prompt('调用工具');

		await waitFor(() => !!capturedSignal);
		expect(capturedSignal?.aborted).toBe(false);

		agent.interrupt('用户取消');
		expect(capturedSignal?.aborted).toBe(true);

		toolGate.resolve();
		await runningPrompt;
	});
});

describe('Agent session 内存窗口', () => {
	it('提交 summary 后应丢弃已参与 summary 的 canonical events', async () => {
		const agent = createAgent() as unknown as {
			commitEvent: (event: AgentEvent) => Promise<void>;
			canonicalEvents: AgentEvent[];
		};

		await agent.commitEvent({
			type: EventType.INPUT,
			text: '第一轮输入',
			source: 'user',
			meta: { roundId: 'round-1', turn: 1 },
		});
		await agent.commitEvent({
			type: EventType.OUTPUT,
			text: '第一轮输出',
			meta: { roundId: 'round-1', turn: 1 },
		});
		await agent.commitEvent({
			type: EventType.INPUT,
			text: '第二轮输入',
			source: 'user',
			meta: { roundId: 'round-1', turn: 2 },
		});
		await agent.commitEvent({
			type: EventType.OUTPUT,
			text: '第二轮输出',
			meta: { roundId: 'round-1', turn: 2 },
		});
		await agent.commitEvent({
			type: EventType.INPUT,
			text: '第三轮输入',
			source: 'user',
			meta: { roundId: 'round-1', turn: 3 },
		});

		await agent.commitEvent({
			type: EventType.AGENT_SUMMARY,
			text: '第一轮和第二轮摘要',
			source: 'system',
			meta: {
				roundId: 'round-1',
				turn: 4,
				endRoundId: 'round-1',
				endTurn: 2,
			},
		});

		expect(agent.canonicalEvents).toMatchObject([
			{
				type: EventType.AGENT_SUMMARY,
				text: '第一轮和第二轮摘要',
			},
			{
				type: EventType.INPUT,
				text: '第三轮输入',
			},
		]);
	});
});
