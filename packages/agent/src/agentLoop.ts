import { shouldRetryAIError } from '@light-agent/ai';
import { EventType } from '@light-agent/protocol/events';
import pRetry, { AbortError } from 'p-retry';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, ToolCallsEvent, ToolResultEvent } from '@light-agent/protocol/events';
import type { Context } from './context/contextBuilder.ts';
import type ToolRegistry from './tool.ts';

/** Agent loop runtime configuration. */
export namespace Loop {
	export type RetryConfig = {
		retries?: number;
	};

	export type Config = {
		venderAdaptor: Vender.Adaptor;
		toolRegistry: ToolRegistry;
		retry?: RetryConfig;
	};
}

type AgentEventListener = (event: AgentEvent) => void;

type LoopDeps = {
	abortSignal: AbortSignal;
	pullContextSnap: () => Promise<Context.BuildResult>;
};

function randomId() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

class AgentLoop {
	private venderAdaptor: Vender.Adaptor;
	private toolRegistry: ToolRegistry;
	private retry: {
		retries: number;
	};
	private listeners: AgentEventListener[] = [];

	constructor(config: Loop.Config) {
		this.venderAdaptor = config.venderAdaptor;
		this.toolRegistry = config.toolRegistry;
		this.retry = {
			retries: config.retry?.retries ?? 3,
		};
	}

	private emit(event: AgentEvent): void {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}

	private async runToolAction(action: ToolCallsEvent['tool_calls'][number]): Promise<ToolResultEvent['tool_result']> {
		const { name, id, args } = action;
		const toolCommand = this.toolRegistry.get(name);

		if (!toolCommand) {
			return {
				id,
				name,
				isError: true,
				result: `Unknown tool: ${name}`,
			};
		}

		try {
			const { isError, content } = await toolCommand.execute(args);

			return {
				id,
				name,
				isError,
				result: content,
			};
		} catch (e) {
			return {
				id,
				name,
				isError: true,
				result: e instanceof Error ? e.message : String(e),
			};
		}
	}

	/**
	 * 只负责消费一次模型 stream，并把 retry 边界收口在这里：
	 * - 未收到任何 chunk 前失败：交给 p-retry 按错误类型判断是否重试。
	 * - 已收到任意 chunk 后失败：终止自动重试，避免两次模型输出混在同一轮事件流里。
	 */
	private async consumeVenderStream(
		input: Vender.StreamInput,
		onChunk: (chunk: Vender.StreamEvent) => void,
	): Promise<void> {
		const runOnce = async () => {
			let hasEmitted = false;

			try {
				for await (const chunk of this.venderAdaptor.stream(input)) {
					hasEmitted = true;
					onChunk(chunk);
				}
			} catch (error) {
				if (hasEmitted) {
					// 已经有 chunk 进入外部事件流后，不再重试，上层接口暴露 runLastPrompt，重新尝试 round
					throw new AbortError(error instanceof Error ? error : new Error(String(error)));
				}

				throw error;
			}
		};

		if (this.retry.retries <= 0) {
			await runOnce();
			return;
		}

		await pRetry(runOnce, {
			retries: this.retry.retries,
			shouldRetry: ({ error }) => shouldRetryAIError(error),
		});
	}

	private formatLlmError(error: unknown): string {
		const cause = error instanceof AbortError ? error.originalError : error;

		if (cause instanceof Error) {
			return cause.message;
		}

		return String(cause);
	}

	/**
	 *
	 * abort 时机
	 * 1. turn 开始前
	 * 2. stream 开始前
	 * 3. tool 并行执行后
	 *
	 * 退出 loop 的机制,
	 * 1. stop 事件发生, 分三种, llm, runtime 限制, user 取消， 需要 emit agent_stop, 统一 return 退出
	 * 2. 正常无 action, 有 output
	 *
	 */

	private async runAgentLoop(prompt: string, loopDeps: LoopDeps): Promise<void> {
		const { abortSignal } = loopDeps;

		// 一个 input 到 output 为一个 roundId
		const roundId = `${randomId()}`;
		let turn = 1;

		const emitAbort = () => {
			this.emit({
				type: EventType.AGENT_STOP,
				cause: 'user',
				// 注意 abortSignal.reason 要随时去读
				message: String(abortSignal.reason ?? 'aborted'),
				meta: { roundId, turn },
			});
		};

		const inputEvent: AgentEvent = { type: EventType.INPUT, source: 'user', text: prompt, meta: { roundId, turn } };
		this.emit(inputEvent);

		while (true) {
			if (abortSignal.aborted) {
				emitAbort();
				// 用户取消, 退出
				return;
			}

			let turnToolCalls: ToolCallsEvent['tool_calls'] = [];

			// 刷新 context
			const { systemPrompt = '', events = [] } = await loopDeps.pullContextSnap();

			const streamInput = {
				systemPrompt: systemPrompt,
				input: events,
				tools: this.toolRegistry.getTools(),
			};

			try {
				await this.consumeVenderStream(streamInput, (chunk) => {
					if (abortSignal.aborted) {
						return;
					}

					switch (chunk.type) {
						case EventType.THOUGHT_DELTA:
						case EventType.THOUGHT:
						case EventType.OUTPUT_DELTA:
						case EventType.OUTPUT:
						case EventType.AGENT_TRACE:
							this.emit({ ...chunk, meta: { roundId, turn } });
							break;

						case EventType.Tool_Calls:
							turnToolCalls = chunk.tool_calls;
							break;
					}
				});
			} catch (error) {
				this.emit({
					type: EventType.AGENT_STOP,
					cause: 'llm',
					message: this.formatLlmError(error),
					meta: { roundId, turn },
				});
				return;
			}

			if (abortSignal.aborted) {
				emitAbort();
				return;
			}

			// 有最终 output 且没有工具调用，说明本轮已经正常结束。
			if (!turnToolCalls.length) {
				return;
			}

			const meta = { roundId, turn };

			this.emit({
				type: EventType.Tool_Calls,
				tool_calls: turnToolCalls,
				meta,
			});

			const toolTasks = turnToolCalls.map(async (action) => {
				const toolResult = await this.runToolAction(action);
				this.emit({
					type: EventType.Tool_Result,
					tool_result: toolResult,
					meta,
				});
			});

			await Promise.all(toolTasks);

			if (abortSignal.aborted) {
				emitAbort();
				return;
			}

			turn++;
		}
	}

	async prompt(prompt: string, loopDeps: LoopDeps): Promise<void> {
		return await this.runAgentLoop(prompt, loopDeps);
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}
}

export default AgentLoop;
