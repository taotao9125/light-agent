import OpenAI from 'openai';
import { EventType } from '../../protocol/events';
import { parseEventsIntoRoundMap, stringifyContent } from '../helpers';

import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { AgentEvent } from '../../protocol/events';
import type { Vender } from '../index';

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
	},
	{
		role: 'assistant'
	},
	{
	   role: 'tool'
	},
	...
];
 */

// 注意这是 deepseek 要求的结构, 回传时, 都塞进一个 assistant message 里
const normalizeDeepSeekInputMessage = (events: AgentEvent[]): ChatCompletionMessageParam[] => {
	const roundsMap = parseEventsIntoRoundMap(events);

	const messages: ChatCompletionMessageParam[] = [];

	for (const [_, round] of roundsMap) {
		const roundMessage: ChatCompletionMessageParam[] = [];
		for (const [_, turn] of round) {
			const inputEvent = turn.find(event => event.type === EventType.INPUT);
			
			if (inputEvent) {
				roundMessage.push({
					role: inputEvent.source ?? 'user',
					content: inputEvent.text
				})
			}

			const thoughtEvent = turn.find((event) => event.type === EventType.THOUGHT);
			const actionsEvent = turn.find((event) => event.type === EventType.ACTIONS);
			const observationsEvent = turn.find((event) => event.type === EventType.OBSERVATIONS);
			const outputEvent = turn.find((event) => event.type === EventType.OUTPUT);

			if (actionsEvent?.actions.length) {
				roundMessage.push({
					role: 'assistant',
					content: outputEvent?.text ?? '',
					reasoning_content: thoughtEvent?.text ?? '',
					tool_calls: actionsEvent.actions.map((action) => ({
						id: action.id,
						type: 'function',
						function: {
							name: action.name,
							arguments: JSON.stringify(action.args),
						},
					})),
				} as ChatCompletionAssistantMessageParam);

				for (const observation of observationsEvent?.observations ?? []) {
					roundMessage.push({
						role: 'tool',
						tool_call_id: observation.id,
						content: stringifyContent(observation.result),
					});
				}
			} else {
				if (outputEvent || thoughtEvent) {
					roundMessage.push({
						role: 'assistant',
						content: outputEvent?.text,
						reasoning_content: thoughtEvent?.text,
					} as ChatCompletionAssistantMessageParam);
				}
			}


		}

		messages.push(...roundMessage);
	}


	return messages;
};



export default class OpenAIAdaptor implements Vender.Adaptor {
	private client: OpenAI;
	private vender: Vender.Config;

	constructor(vender: Vender.Config) {
		this.vender = vender;
		this.client = new OpenAI({
			apiKey: vender.apiKey,
			baseURL: vender.baseURL,
			// logLevel: 'debug',
		});
	}

	protected normalizeRequestConfig(input: Vender.StreamInput): ChatCompletionCreateParamsStreaming {
		const messages = normalizeDeepSeekInputMessage(input.input);
		if (input.systemPrompt) {
			messages.unshift({
				role: 'system',
				content: input.systemPrompt,
			});
		}
		return {
			model: this.vender.model,
			messages,
			tools: input.tools?.map((tool) => ({
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

	/** agent 内部使用：用于摘要等文本生成 */
	async _generateText(input: Vender.GenerateTextInput): Promise<Vender.GenerateTextResult> {
		const messages: ChatCompletionMessageParam[] = input.messages.map((message) => ({
			role: message.role,
			content: message.content,
		}));

		if (input.systemPrompt) {
			messages.unshift({
				role: 'system',
				content: input.systemPrompt,
			});
		}

		const response = await this.client.chat.completions.create({
			model: this.vender.model,
			messages,
			stream: false,
		});

		const text = response.choices[0]?.message?.content ?? '';

		return {
			text,
			usage: {
				inputTokens: response.usage?.prompt_tokens ?? 0,
				outputTokens: response.usage?.completion_tokens ?? 0,
				totalTokens: response.usage?.total_tokens ?? 0,
			},
		};
	}

	async *stream(input: Vender.StreamInput): ReturnType<Vender.Adaptor['stream']> {
		const config = this.normalizeRequestConfig(input);
		const pendingToolCalls = new Map<
			number,
			{
				id: string;
				name: string;
				args: string;
			}
		>();

		let thoughtTextBuffer = '';
		let outputTextBuffer = '';
		const costs = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		};
		const startAt = Date.now();

		try {
			const { data: stream } = await this.client.chat.completions.create(config).withResponse();

			for await (const chunk of stream) {
				if (chunk.usage) {
					if (chunk.usage.prompt_tokens) {
						costs.inputTokens = chunk.usage.prompt_tokens;
					}
					if (chunk.usage.completion_tokens) {
						costs.outputTokens = chunk.usage.completion_tokens;
					}
					if (chunk.usage.total_tokens) {
						costs.totalTokens = chunk.usage.total_tokens;
					}
				}

				const delta = chunk.choices[0]?.delta;
				const tools = delta?.tool_calls ?? [];

				// as any, deepseek 接口有 reasoning_content, 但 openai ts 类型没有
				const reasoningText = (delta as any).reasoning_content;
				const deltaText = delta?.content;

				if (reasoningText) {
					thoughtTextBuffer += reasoningText;
					yield { type: EventType.THOUGHT_DELTA, text: reasoningText };
				}

				if (deltaText) {
					outputTextBuffer += deltaText;
					yield { type: EventType.OUTPUT_DELTA, text: deltaText };
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

			// thought -> action -> output

			if (!pendingToolCalls.size && !outputTextBuffer) {
				yield { type: EventType.AGENT_STOP, cause: 'llm', message: 'LLM did not return an action or output.' };
			}

			if (thoughtTextBuffer) {
				yield { type: EventType.THOUGHT, text: thoughtTextBuffer };
			}

			const actions = [...pendingToolCalls.values()].map((call) => ({
				id: call.id,
				name: call.name,
				args: call.args ? JSON.parse(call.args) : {},
			}));

			if (actions.length) {
				yield { type: EventType.ACTIONS, actions };
			}

			if (outputTextBuffer) {
				yield { type: EventType.OUTPUT, text: outputTextBuffer };
			}

			pendingToolCalls.clear();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: EventType.AGENT_STOP, cause: 'llm', message };
		} finally {
			yield {
				type: EventType.AGENT_TRACE,
				startAt,
				endAt: Date.now(),
				model: config.model,
				costs,
			};
		}
	}
}
