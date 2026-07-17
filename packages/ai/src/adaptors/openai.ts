import { EventType } from '@light-agent/protocol/events';
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { collectToolResultsForTurn, parseEventsIntoRoundMap, stringifyContent } from '../helpers.ts';
import { AIError } from '../retry.ts';

import type { AgentEvent } from '@light-agent/protocol/events';
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { Vender } from '../index.ts';

const nonRetryableApiCodes = ['insufficient_quota', 'context_length_exceeded', 'content_filter'];
const retryableApiCodes = ['rate_limit_exceeded'];

function readOpenAICode(error: APIError): string | undefined {
	return typeof error.code === 'string' ? error.code : undefined;
}

function isRetryableProviderStatus(status: number | undefined): boolean {
	return status !== undefined && status >= 500;
}

function isRequestErrorStatus(status: number | undefined): boolean {
	return status !== undefined && status >= 400 && status < 500;
}

function isTransportError(error: unknown): error is APIConnectionError {
	return error instanceof APIConnectionError || error instanceof APIConnectionTimeoutError;
}

function getMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// 传输层错误, 可重试
// 5XX 错误, 可重试
// 4XX 错误, 优先根据 code 语意重试, 典型的就是 429 的 code 可能是账单问题, 可能是限流问题, 账单问题不重试, 限流的可以
function normalizeOpenAIError(error: unknown): AIError {
	if (error instanceof AIError) return error;

	if (isTransportError(error)) {
		return new AIError({
			kind: 'transport_error',
			message: error.message,
			retryable: true,
			cause: error,
		});
	}

	if (error instanceof APIUserAbortError) {
		return new AIError({
			kind: 'abort_error',
			message: error.message,
			retryable: false,
			cause: error,
		});
	}

	if (error instanceof APIError) {
		const code = readOpenAICode(error);

		// https://developers.openai.com/api/docs/guides/error-codes
		// 5xx 属于 provider 基础设施错误，按 status 可直接重试。
		if (isRetryableProviderStatus(error.status)) {
			return new AIError({
				kind: 'provider_error',
				message: error.message,
				retryable: true,
				status: error.status,
				code,
				cause: error,
			});
		}

		// 4xx 是请求已被 provider 理解后的业务语义错误。
		// 同一个 HTTP status 下可能有不同语义，例如 429 rate_limit 可重试，429 insufficient_quota 不可重试。
		// 所以 4xx 必须先判断 provider code，不能只按 status 粗判。
		if (code && nonRetryableApiCodes.includes(code)) {
			return new AIError({
				kind: 'request_error',
				message: error.message,
				retryable: false,
				status: error.status,
				code,
				cause: error,
			});
		}

		if (code && retryableApiCodes.includes(code)) {
			return new AIError({
				kind: 'provider_error',
				message: error.message,
				retryable: true,
				status: error.status,
				code,
				cause: error,
			});
		}

		return new AIError({
			kind: isRequestErrorStatus(error.status) ? 'request_error' : 'unknown_error',
			message: error.message,
			retryable: false,
			status: error.status,
			code,
			cause: error,
		});
	}

	return new AIError({
		kind: 'unknown_error',
		message: getMessage(error),
		retryable: false,
		cause: error,
	});
}

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
	const summaryEvent = events.findLast((event) => event.type === EventType.AGENT_SUMMARY);

	const roundsMap = parseEventsIntoRoundMap(events.filter((event) => event.type !== EventType.AGENT_SUMMARY));

	const messages: ChatCompletionMessageParam[] = [];

	for (const [_, round] of roundsMap) {
		const roundMessage: ChatCompletionMessageParam[] = [];
		for (const [_, turn] of round) {
			const inputEvent = turn.find((event) => event.type === EventType.INPUT);

			if (inputEvent) {
				roundMessage.push({
					role: inputEvent.source ?? 'user',
					content: inputEvent.text,
				});
			}

			const thoughtEvent = turn.find((event) => event.type === EventType.THOUGHT);
			const toolCallsEvent = turn.find((event) => event.type === EventType.Tool_Calls);
			const outputEvent = turn.find((event) => event.type === EventType.OUTPUT);

			if (toolCallsEvent?.tool_calls.length) {
				const toolCallIds = toolCallsEvent.tool_calls.map((action) => action.id);
				const toolResults = collectToolResultsForTurn(turn, toolCallIds);

				roundMessage.push({
					role: 'assistant',
					content: outputEvent?.text ?? '',
					reasoning_content: thoughtEvent?.text ?? '',
					tool_calls: toolCallsEvent.tool_calls.map((action) => ({
						id: action.id,
						type: 'function',
						function: {
							name: action.name,
							arguments: JSON.stringify(action.args),
						},
					})),
				} as ChatCompletionAssistantMessageParam);

				for (const observation of toolResults) {
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
						content: outputEvent?.text ?? '',
						reasoning_content: thoughtEvent?.text,
					} as ChatCompletionAssistantMessageParam);
				}
			}
		}

		messages.push(...roundMessage);
	}

	if (summaryEvent) {
		messages.unshift({
			role: summaryEvent.source,
			content: summaryEvent.text,
		});
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
			maxRetries: 0,
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
			tools: [],
			tool_choice: 'auto',
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
		let completed = false;

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

			if (thoughtTextBuffer) {
				yield { type: EventType.THOUGHT, text: thoughtTextBuffer };
			}

			const toolCalls = [...pendingToolCalls.values()].map((call) => ({
				id: call.id,
				name: call.name,
				args: call.args ? JSON.parse(call.args) : {},
			}));

			if (toolCalls.length) {
				yield { type: EventType.Tool_Calls, tool_calls: toolCalls };
			}

			if (outputTextBuffer) {
				yield { type: EventType.OUTPUT, text: outputTextBuffer };
			}

			pendingToolCalls.clear();
			completed = true;
		} catch (error) {
			throw normalizeOpenAIError(error);
		} finally {
			if (completed) {
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
}
