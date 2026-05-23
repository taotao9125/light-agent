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
	const stringifyContent = (content: unknown): string => {
		if (typeof content === 'string') return content;
		return JSON.stringify(content);
	};

	const splitEventsByInput = (events: AgentEvent[]): AgentEvent[][] => {
		const inputIndexes = events.reduce<number[]>((indexes, event, index) => {
			if (event.type === EventType.INPUT) {
				indexes.push(index);
			}
			return indexes;
		}, []);

		return inputIndexes.map((startIndex, index) => {
			const endIndex = inputIndexes[index + 1] ?? events.length;
			return events.slice(startIndex, endIndex);
		});
	};

	const eventGroupToMessages = (eventGroup: AgentEvent[]): ChatCompletionMessageParam[] => {
		const messages = [] as ChatCompletionMessageParam[];
		let thought = '';
		const pendingActions: Extract<AgentEvent, { type: typeof EventType.ACTION }>[] = [];

		const commitAssistantToolCall = (): void => {
			if (!pendingActions.length) return;

			messages.push({
				role: 'assistant',
				content: null,
				reasoning_content: thought,
				tool_calls: pendingActions.map((action) => ({
					id: action.id,
					type: 'function',
					function: {
						arguments: JSON.stringify(action.args),
						name: action.name,
					},
				})),
			} as ChatCompletionAssistantMessageParam);


			
			thought = '';
			pendingActions.length = 0;
		};

		for (const event of eventGroup) {
			const type = event.type;
			if (type === EventType.INPUT) {
				messages.push({ role: event.source ?? 'user', content: event.text });
			}

			if (type === EventType.THOUGHT) {
				thought = event.text;
			}

			if (type === EventType.ACTION) {
				pendingActions.push(event);
			}

			if (type === EventType.OBSERVATION) {
				commitAssistantToolCall();
				messages.push({ role: 'tool', tool_call_id: event.id, content: stringifyContent(event.result) });
			}

			if (type === EventType.OUTPUT) {
				commitAssistantToolCall();
				messages.push({ role: 'assistant', content: event.text });
				thought = '';
			}
		}

		commitAssistantToolCall();
		return messages;
	};

	const eventGroups = splitEventsByInput(events);
	return eventGroups.flatMap(eventGroupToMessages);
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
