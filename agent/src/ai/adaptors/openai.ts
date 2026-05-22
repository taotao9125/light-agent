import OpenAI from 'openai';
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { type AgentEvent, EventType } from '../../protocol/events';
import type { AiProvider, AiRequestConfig, clientConfig } from '../index';



/** deepseek 的每一轮思考模式 message 结构
 * const messages: Messages = [
  {
    role: 'user',
    content: '帮我读下 package.json'
  },
  {
    role: 'assistant',
    content: null,
    reasoning_content: '用户想读 package.json，我来调用 read_file 工具',
    tool_calls: [{
      id: 'call_00_xxx',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: '{"path": "package.json"}'
      }
    }]
  },
  {
    role: 'tool',
    tool_call_id: 'call_00_xxx',
    content: '{"name": "agent", "version": "1.0.0"}'
  }
];
 */

// 注意这是 deepseek 要求的结构, 回传时, 都塞进一个 assistant message 里
const normalizeDeepSeekInputMessage = (events: AgentEvent[]): ChatCompletionMessageParam[] => {
	const messages = [] as ChatCompletionMessageParam[];
		const assistantMessage = {
			role: 'assistant',
			content: '',
			reasoning_content: '',
			tool_calls: [],
		} as ChatCompletionAssistantMessageParam;

		for (const event of events) {
			const type = event.type;
			if (type === EventType.INPUT) {
				messages.push({ role: event.source ?? 'user', content: event.text });
			}

			// output/THOUGHT/ACTION 都需要回传到 assistantMessage 里
			if (type === EventType.OUTPUT) {
				assistantMessage.content = event.text;
			}

			if (type === EventType.THOUGHT) {
				(assistantMessage as any).reasoning_content = event.text;
			}

			if (type === EventType.ACTION) {
				(assistantMessage as any).tool_calls.push({
					id: event.id,
					type: 'function',
					function: {
						arguments: JSON.stringify(event.args),
						name: event.name,
					},
				});
			}

			if (type === EventType.OBSERVATION) {
				// 证明有 tool call, 把assistantMessage回传回去
				messages.push(assistantMessage)
				messages.push({ role: 'tool', tool_call_id: event.id, content: event.result });
			}
		}

		return messages;
}

export default class OpenAIAdaptor implements AiProvider {
	private client: OpenAI;
	constructor(config: clientConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
			// logLevel: 'debug',
		});
	}

	protected normalizeRequestConfig(requestConfig: AiRequestConfig): ChatCompletionCreateParamsStreaming {
		return {
			model: requestConfig.model,
			messages: normalizeDeepSeekInputMessage(requestConfig.input),
			tools: requestConfig.tools?.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.schema,
				},
			})),
			tool_choice: 'auto',
			stream: true,
		};
	}

	async *stream(requestConfig: AiRequestConfig): ReturnType<AiProvider['stream']> {
		const config = this.normalizeRequestConfig(requestConfig);
		const pendingToolCalls = new Map<
			number,
			{
				id: string;
				name: string;
				args: string;
			}
		>();
		try {
			const { data: stream } = await this.client.chat.completions.create(config).withResponse();

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;
				const tools = delta?.tool_calls ?? [];

				// as any, deepseek 接口有 reasoning_content, 但 openai ts 类型没有
				const reasoningText = (delta as any).reasoning_content;
				const deltaText = delta?.content;

				if (reasoningText) {
					yield { type: EventType.THOUGHT, text: reasoningText };
				}

				if (deltaText) {
					yield { type: EventType.OUTPUT, text: deltaText };
				}

				for (const tool of tools) {
					const current = pendingToolCalls.get(tool.index) || {
						id: '',
						name: '',
						args: '',
					};

					if (tool.id) {
						current.id = tool.id;
					}

					if (tool.function?.name) {
						current.name = tool.function?.name ?? '';
					}

					if (tool.function?.arguments) {
						current.args += tool.function?.arguments ?? '';
					}

					pendingToolCalls.set(tool.index, current);
				}
			}

			// 注意，工具调用要在当前这次 LLM 的输出迭代完毕后再 yield 出去，统一判断工具输出的完整性，最终确定有没有工具调用，没有那就是最终结束了
			for (const call of pendingToolCalls.values()) {
				yield {
					type: EventType.ACTION,
					id: call.id,
					name: call.name,
					args: call.args ? JSON.parse(call.args) : {},
				};
			}
			pendingToolCalls.clear();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: EventType.AGENT_ERROR, message };
		}
	}
}
