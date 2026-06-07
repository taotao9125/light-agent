import { randomUUID } from 'node:crypto';
import type { CreateClient, Vender } from '../ai/index';
import { createClient } from '../ai/index';
import type { ActionEvent, AgentEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import type { Context } from './contextBuilder';
import { stringify } from './helpers';
import type { Tool } from './toolRegistry';

/** Agent loop runtime configuration. */
export namespace Loop {
	export type Config = {
		vender: Vender.Config;
		strategy?: {
			maxTurns?: number;
		};
	};
}

type AgentEventListener = (event: AgentEvent) => void;

type LoopDeps = {
	abortSignal: AbortSignal;
	pullContextSnap: () => Context.BuildResult;
	pullToolsSnap: () => Tool.Definition[];
};

export interface AgentLoopInterface {
	prompt: (prompt: string, options: LoopDeps) => Promise<void>;
	on: (listener: AgentEventListener) => void;
}

function toToolsMap(tools: Tool.Definition[]) {
	const map = new Map<string, Tool.Definition>();
	for (const tool of tools) {
		map.set(tool.name, tool);
	}
	return map;
}

function toToolsMeta(tools: Tool.Definition[]) {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		schema: tool.schema,
	}));
}

class AgentLoop implements AgentLoopInterface {
	private venderAdaptor: ReturnType<CreateClient>;
	private listeners: AgentEventListener[] = [];
	private maxTurns: number;

	constructor(config: Loop.Config) {
		this.maxTurns = config.strategy?.maxTurns ?? 20;
		this.venderAdaptor = createClient(config.vender);
	}

	private emit(event: AgentEvent): void {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}

	/**
	 *
	 * abort 时机
	 * 1. turn 开始前
	 * 2. stream 开始前
	 * 3. tool 开始前
	 * 4. tool 执行后
	 *
	 * 退出 loop 的机制,
	 * 1. stop 事件发生, 分三种, llm, runtime 限制, user 取消， 需要 emit agent_stop, 统一 return 退出
	 * 2. 正常无 action, 有 output
	 *
	 */

	private async runAgentLoop(prompt: string, loopDeps: LoopDeps): Promise<void> {
		const { abortSignal } = loopDeps;

		// 一个 input 到 output 为一个 roundId
		const roundId = `round_id_${randomUUID()}`;
		let turn = 0;

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

			turn++;

			const turnActionEvents: ActionEvent[] = [];
			// 这就支持了动态注册工具的能力
			const tools = loopDeps.pullToolsSnap();
			const toolsMap = toToolsMap(tools);
			const toolsMeta = toToolsMeta(tools);

			// 刷新 context
			const context = loopDeps.pullContextSnap();

			if (turn > this.maxTurns) {
				this.emit({
					type: EventType.AGENT_STOP,
					cause: 'runtime',
					message: `Agent stopped after reaching max turns: ${this.maxTurns}`,
					meta: { roundId, turn },
				});
				return;
			}

			const stream = this.venderAdaptor.stream({
				input: context.events,
				systemPrompt: context.systemPrompt,
				tools: toolsMeta,
			});

			for await (const chunk of stream) {
				if (abortSignal.aborted) {
					emitAbort();
					return;
				}

				switch (chunk.type) {
					case EventType.AGENT_STOP:
						// LLM 厂商的错误, 我们无能为力, 但要进 canonicalEvents, 需要审计, 但不进下一轮的 prompt context ,对 LLM 来说没用。
						this.emit({ ...chunk, meta: { roundId, turn } });
						return;

					case EventType.THOUGHT_DELTA:
						this.emit({ type: EventType.THOUGHT_DELTA, text: chunk.text, meta: { roundId, turn } });
						break;

					case EventType.THOUGHT:
						this.emit({ type: EventType.THOUGHT, text: chunk.text, meta: { roundId, turn } });
						break;

					// 搜集 action 命令，需要等把流迭代完了, 才能知道有没有指令来决定是否进行下一轮
					case EventType.ACTION:
						turnActionEvents.push({
							...chunk,
							meta: {
								roundId,
								turn,
							},
						});
						break;

					case EventType.OUTPUT_DELTA:
						this.emit({ type: EventType.OUTPUT_DELTA, text: chunk.text, meta: { roundId, turn } });
						break;

					case EventType.OUTPUT:
						this.emit({ type: EventType.OUTPUT, text: chunk.text, meta: { roundId, turn } });
						break;
					default:
						break;
				}
			}

			if (!turnActionEvents.length) {
				return;
			}

			for (const action of turnActionEvents) {
				if (abortSignal.aborted) {
					emitAbort();
					return;
				}

				const { name, id, args } = action;
				this.emit(action);
				const toolCommand = toolsMap.get(name);
				const observationBase = {
					type: EventType.OBSERVATION,
					id,
					name,
					meta: { roundId, turn },
				};
				// 外部环境不存在，回传给 ai， 它做下一步决策
				if (!toolCommand) {
					this.emit({
						...observationBase,
						isError: true,
						result: `Unknown tool: ${action.name}`,
					});
					continue;
				}

				try {
					const { isError, content } = await toolCommand.execute(args, {
						signal: abortSignal,
					});

					// 外部执行错误也回传给 ai， 它做下一步决策
					this.emit({
						...observationBase,
						isError,
						result: stringify(content),
					});
				} catch (e) {
					// 兜底
					// 可能工具里面 abortSignal.throwIfAborted()
					if (abortSignal.aborted) {
						emitAbort();
						return;
					}

					// 防止没按照约定格式返回错误
					this.emit({
						...observationBase,
						isError: true,
						result: JSON.stringify([
							{
								type: 'text',
								text: e instanceof Error ? e.message : String(e),
							},
						]),
					});
				}
			}
		}
	}

	async prompt(prompt: string, loopDeps: LoopDeps): Promise<void> {
		return await this.runAgentLoop(prompt, loopDeps);
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
	}
}

export default AgentLoop;
