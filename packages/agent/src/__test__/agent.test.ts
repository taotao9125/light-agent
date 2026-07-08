import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Agent from '../agent.ts';

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

function createAgent() {
	return new Agent({
		cwd: '/tmp/workspace',
		venderAdaptor: mockVenderAdaptor,
		context: {},
	});
}

describe('Agent 工具接口', () => {
	it('应默认注册项目文件树工具', () => {
		const agent = createAgent();

		expect(agent.tool.get('list_project_files_tree')?.description).toContain('查看当前工作目录内的项目文件树');
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
