import OpenAI from 'openai';
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { type AgentEvent, EventType } from '../../protocol/events';
import { parseTurnEventGroup, splitEventsToRoundGroups } from '../../protocol/eventGroups';
import { stringifyContent } from '../helpers';
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
	}
];
 */

// 注意这是 deepseek 要求的结构, 回传时, 都塞进一个 assistant message 里
const normalizeDeepSeekInputMessage = (events: AgentEvent[]): ChatCompletionMessageParam[] => {
	const roundGroups = splitEventsToRoundGroups(events);

	const messages = roundGroups.flatMap((roundGroup): ChatCompletionMessageParam[] => {
		const groupMessages: ChatCompletionMessageParam[] = [];
		const { input, turns } = roundGroup;

		if (input?.type === EventType.INPUT) {
			groupMessages.push({
				role: input.source ?? 'user',
				content: input.text,
			});
		}

		for (const turnEvents of turns) {
			const { thought, actions, observations, output } = parseTurnEventGroup(turnEvents);

			const thoughtText = thought?.type === EventType.THOUGHT && thought.text ? thought.text : null;
			const outputText = output?.type === EventType.OUTPUT && output.text ? output.text : null;

			if (actions.length) {
				groupMessages.push({
					role: 'assistant',
					content: outputText,
					reasoning_content: thoughtText,
					tool_calls: actions.map((action) => ({
						id: action.id,
						type: 'function',
						function: {
							name: action.name,
							arguments: JSON.stringify(action.args),
						},
					})),
				} as ChatCompletionAssistantMessageParam);

				for (const observation of observations) {
					groupMessages.push({
						role: 'tool',
						tool_call_id: observation.id,
						content: stringifyContent(observation.result),
					});
				}

				continue;
			}

			if (thoughtText || outputText) {
				groupMessages.push({
					role: 'assistant',
					content: outputText,
					reasoning_content: thoughtText,
				} as ChatCompletionAssistantMessageParam);
			}
		}

		return groupMessages;
	});

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

		try {
			const { data: stream } = await this.client.chat.completions.create(config).withResponse();

			for await (const chunk of stream) {
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

			// 注意，工具调用要在当前这次 LLM 的输出迭代完毕后再 yield 出去，统一判断工具输出的完整性，最终确定有没有工具调用，没有那就是最终结束了
			for (const call of pendingToolCalls.values()) {
				yield {
					type: EventType.ACTION,
					id: call.id,
					name: call.name,
					args: call.args ? JSON.parse(call.args) : {},
				};
			}

			if (outputTextBuffer) {
				yield { type: EventType.OUTPUT, text: outputTextBuffer };
			}

			pendingToolCalls.clear();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: EventType.AGENT_STOP, cause: 'llm', message };
		}
	}
}
