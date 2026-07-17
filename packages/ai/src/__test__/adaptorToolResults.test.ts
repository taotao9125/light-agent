import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it } from 'vitest';
import GoogleAdaptor from '../adaptors/google.ts';
import OpenAIAdaptor from '../adaptors/openai.ts';

import type { Content } from '@google/genai';
import type { AgentEvent } from '@light-agent/protocol/events';
import type { Vender } from '../index.ts';

const venderConfig: Vender.Config = {
	name: 'test',
	apiKey: 'test-key',
	baseURL: 'https://example.com',
	model: 'test-model',
};

const events: AgentEvent[] = [
	{
		type: EventType.Tool_Calls,
		tool_calls: [
			{ id: 'call_a', name: 'demo_tool', args: { value: 'a' } },
			{ id: 'call_b', name: 'demo_tool', args: { value: 'b' } },
			{ id: 'call_c', name: 'demo_tool', args: { value: 'c' } },
		],
		meta: { roundId: 'round_1', turn: 1 },
	},
	{
		type: EventType.Tool_Result,
		tool_result: { id: 'call_c', name: 'demo_tool', result: 'result c', isError: false },
		meta: { roundId: 'round_1', turn: 1 },
	},
	{
		type: EventType.Tool_Result,
		tool_result: { id: 'call_a', name: 'demo_tool', result: 'result a', isError: false },
		meta: { roundId: 'round_1', turn: 1 },
	},
	{
		type: EventType.Tool_Result,
		tool_result: { id: 'call_b', name: 'demo_tool', result: 'result b', isError: false },
		meta: { roundId: 'round_1', turn: 1 },
	},
];

class TestOpenAIAdaptor extends OpenAIAdaptor {
	public build(input: Vender.StreamInput) {
		return this.normalizeRequestConfig(input);
	}
}

class TestGoogleAdaptor extends GoogleAdaptor {
	public build(input: Vender.StreamInput) {
		return this.normalizeRequestConfig(input);
	}
}

describe('adaptor tool result 聚合', () => {
	it('OpenAI 应按 Tool_Calls 顺序组装 tool message', () => {
		const adaptor = new TestOpenAIAdaptor(venderConfig);
		const config = adaptor.build({ input: events });
		const toolMessages = config.messages.filter((message) => message.role === 'tool');

		expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_a', 'call_b', 'call_c']);
		expect(toolMessages.map((message) => message.content)).toEqual(['result a', 'result b', 'result c']);
	});

	it('Google 应按 Tool_Calls 顺序组装 functionResponse', () => {
		const adaptor = new TestGoogleAdaptor(venderConfig);
		const config = adaptor.build({ input: events });
		const contents = config.contents as Content[];
		const functionResponses =
			contents
				.flatMap((content) => content.parts ?? [])
				.flatMap((part) => (part.functionResponse ? [part.functionResponse] : [])) ?? [];

		expect(functionResponses.map((item) => item.id)).toEqual(['call_a', 'call_b', 'call_c']);
		expect(functionResponses.map((item) => item.response?.output)).toEqual(['result a', 'result b', 'result c']);
	});
});
