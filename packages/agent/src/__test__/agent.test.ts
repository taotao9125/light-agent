import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Agent from '../agent.ts';

import type { Vender } from '@light-agent/ai';

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
		sessionId: 'test-session',
		cwd: '/tmp/workspace',
		venderAdaptor: mockVenderAdaptor,
		context: {},
	});
}

describe('Agent 工具接口', () => {
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
