import { EventType } from '@light-agent/protocol/events';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, ToolCallsEvent, ToolResultsEvent } from '@light-agent/protocol/events';
import type { Context } from './context/contextBuilder.ts';
import type { Tool } from './tool.ts';

/** Agent loop runtime configuration. */
export namespace Loop {
	export type Config = {
		venderAdaptor: Vender.Adaptor;
		strategy?: {
			maxTurns?: number;
		};
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

class AgentLoop {
	private venderAdaptor: Vender.Adaptor;
	private listeners: AgentEventListener[] = [];
	private maxTurns: number;

	constructor(config: Loop.Config) {
		this.maxTurns = config.strategy?.maxTurns ?? 20;
		this.venderAdaptor = config.venderAdaptor;
	}

	private emit(event: AgentEvent): void {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}

	private async runToolAction(
		action: ToolCallsEvent['tool_calls'][number],
		toolsMap: Map<string, Tool.Definition>,
		abortSignal: AbortSignal,
	): Promise<ToolResultsEvent['tool_results'][number]> {
		const { name, id, args } = action;
		const toolCommand = toolsMap.get(name);

		if (!toolCommand) {
			return {
				id,
				name,
				isError: true,
				result: `Unknown tool: ${name}`,
			};
		}

		try {
			const { isError, content } = await toolCommand.execute(args, {
				signal: abortSignal,
			});

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
		const roundId = `round_id_${randomId()}`;
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

			if (turn > this.maxTurns) {
				this.emit({
					type: EventType.AGENT_STOP,
					cause: 'runtime',
					message: `Agent stopped after reaching max turns: ${this.maxTurns}`,
					meta: { roundId, turn },
				});
				return;
			}

			let turnToolCalls: ToolCallsEvent['tool_calls'] = [];

			// 刷新 context
			const { systemPrompt = '', tools = [], events = [] } = await loopDeps.pullContextSnap();

			const toolsMap = toToolsMap(tools);
			const toolsMeta = toToolsMeta(tools);

			const stream = this.venderAdaptor.stream({
				systemPrompt: systemPrompt,
				input: events,
				tools: toolsMeta,
			});

			for await (const chunk of stream) {
				if (abortSignal.aborted) {
					emitAbort();
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

					case EventType.AGENT_STOP:
						// LLM 厂商的错误, 我们无能为力, 但要进 canonicalEvents, 需要审计, 但不进下一轮的 prompt context ,对 LLM 来说没用。
						this.emit({ ...chunk, meta: { roundId, turn } });
						return;
				}
			}

			if (!turnToolCalls.length) {
				return;
			}

			const meta = { roundId, turn };

			this.emit({
				type: EventType.Tool_Calls,
				tool_calls: turnToolCalls,
				meta,
			});

			const settled = await Promise.allSettled(
				turnToolCalls.map((action) => this.runToolAction(action, toolsMap, abortSignal)),
			);

			if (abortSignal.aborted) {
				emitAbort();
				return;
			}

			const toolResults = settled.map((result, index) => {
				if (result.status === 'fulfilled') {
					return result.value;
				}

				const action = turnToolCalls[index];
				const rejectReason = result.reason;
				return {
					id: action.id,
					name: action.name,
					isError: true,
					result: rejectReason instanceof Error ? rejectReason.message : String(result.reason),
				};
			});

			this.emit({
				type: EventType.Tool_Results,
				tool_results: toolResults,
				meta,
			});

			turn++;
		}
	}

	async prompt(prompt: string, loopDeps: LoopDeps): Promise<void> {
		return await this.runAgentLoop(prompt, loopDeps);
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
	}

	getVenderAdaptor() {
		return this.venderAdaptor;
	}
}

export default AgentLoop;
