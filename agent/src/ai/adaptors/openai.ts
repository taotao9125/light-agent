import OpenAI from 'openai';
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { type AgentEvent, EventType } from '../../protocol/events';
import type { AiProvider, AiRequestConfig, clientConfig } from '../index';

const pendingToolCalls = new Map<
	number,
	{
		id: string;
		name: string;
		args: string;
	}
>();

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

export default class OpenAIAdaptor implements AiProvider {
	private client: OpenAI;
	constructor(config: clientConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
			// logLevel: 'debug',
		});
	}

	protected normalizeInput(events: AgentEvent[]): ChatCompletionMessageParam[] {
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
				messages.push({ role: !event.source ? 'user' : event.source, content: event.text });
			}

			if (type === EventType.THOUGHT) {
				messages.push(assistantMessage);
			}

			if (type === EventType.THOUGHT) {
				// deepseek api 接口不兼容 openai ts 类型
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
				messages.push({ role: 'tool', tool_call_id: event.id, content: event.result });
			}
		}

		return messages;

		// return events.map(event => {
		//   const assistantMessage = {
		//     role: 'assistant',
		//     content: '',
		//     reasoning_content: '',
		//     tool_calls: []
		//   }
		//   switch (event.type) {
		//     case EventType.INPUT:
		//       return { role: !event.source ? 'user' : event.source, content: event.text };
		//     case EventType.THOUGHT:
		//       // deepseek: reasoning_content
		//       assistantMessage.reasoning_content = event.text;
		//       break;
		//     // return { role: 'assistant', content: '', reasoning_content: event.text} as AssistantMessageParam
		//     case EventType.ACTION:
		//       assistantMessage.tool_calls.push({
		//         id: event.id,
		//         type: 'function',
		//         function: {
		//           arguments: JSON.stringify(event.args),
		//           name: event.name
		//         }
		//       } as ToolmessageParam)
		//       break;
		//     case EventType.OBSERVATION:
		//       return { role: 'tool', tool_call_id: event.id, content: [{ type: 'text', text: event.result }] } as ToolmessageParam
		//     default:
		//       return null;
		//   }
		//   // 组装 deepseek 结构
		//   return assistantMessage as AssistantMessageParam;
		// }).filter(event => !!event)
	}

	protected normalizeRequestConfig(requestConfig: AiRequestConfig): ChatCompletionCreateParamsStreaming {
		return {
			model: requestConfig.model,
			messages: this.normalizeInput(requestConfig.input),
			tools: requestConfig.tools?.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.schema,
				},
				tool_choice: 'auto',
			})),
			stream: true,
		};
	}

	async *stream(requestConfig: AiRequestConfig): ReturnType<AiProvider['stream']> {
		const config = this.normalizeRequestConfig(requestConfig);
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

				// if (chunk.choices[0].finish_reason === 'tool_calls') {

				// }
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
			yield { type: EventType.AGNET_ERROR, message };
		}
	}

	// async chat(requestConfig: AiRequestConfig): ReturnType<AiProvider['chat']> {
	//   const response = await this.client.chat.completions.create({
	//     model: requestConfig.model,
	//     messages: requestConfig.messages.map(message => {
	//       const { role, content } = message;

	//       if (role === 'tool') {
	//         return {
	//           role,
	//           // from open ai sdk, tell it which tool I have called.
	//           tool_call_id: message.toolCallId,
	//           content: message.content
	//         }
	//       }

	//       return { role, content };

	//     }),
	//     // tell ai how many tools I have.
	//     tools: requestConfig.tools?.map((tool) => ({
	//       type: 'function',
	//       function: {
	//         name: tool.name,
	//         description: tool.description,
	//         parameters: tool.schema,
	//       },
	//       tool_choice: 'auto',
	//     })),
	//   });

	//   return {
	//     role: 'assistant',
	//     content: response.choices[0].message.content ?? '',
	//     toolCalls: (response.choices[0].message.tool_calls ?? []).map((tool) => {
	//       if (tool.type !== 'function') return null;
	//       return {
	//         toolCallId: tool.id,
	//         name: tool.function.name,
	//         args: JSON.parse(tool.function.arguments),
	//       };
	//     }).filter(tool => !!tool)
	//   };
	// }
}
