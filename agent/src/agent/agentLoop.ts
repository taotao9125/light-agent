import { randomUUID } from 'node:crypto';
import type { CreateClient } from '../ai/index';
import { createClient } from '../ai/index';
import type { ActionEvent, AgentEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import type { AgentLoopConfig, ContextBuildOuput, ToolDefinition } from './types';

type AgentEventListener = (event: AgentEvent) => void;


type LoopDeps = {
	abortSignal: AbortSignal;
	pullContextSnap: () => ContextBuildOuput;
	pullToolsSnap: () => ToolDefinition<any, any>[];
};

export interface AgentLoopInterface {
	prompt: (prompt: string, options: LoopDeps) => Promise<void>;
	on: (listener: AgentEventListener) => void;
}

function toToolsMap(tools: ToolDefinition<any, any>[]) {
	const map = new Map<string, ToolDefinition<any, any>>();
	for (const tool of tools) {
		map.set(tool.name, tool);
	}
	return map;
}

function toToolsMeta(tools: ToolDefinition<any, any>[]) {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		schema: tool.schema,
	}));
}

class AgentLoop implements AgentLoopInterface {
	private AiClient: ReturnType<CreateClient>;
	private listeners: AgentEventListener[] = [];
	private model: string;
	private maxTurns: number;
	constructor(config: AgentLoopConfig) {
		this.model = config.vender.model;
		this.maxTurns = 20;
		this.AiClient = createClient({
			venderName: config.vender.name,
			apiKey: config.vender.apiKey,
			baseURL: config.vender.baseURL,
		});
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
	 * 4. tool 返回 isAborted
	 *
	 *
	 * fail 时机是 LLM 出错，这要进入 canonicalEvents，审计时用的着
	 * 1. stream 有 error, 如无权限, 超过 token, 模型层我们无能为力
	 * 2. 无 action 和 无 output, 可以认为是 LLM 脑子坏了，无能为力
	 *
	 * loop 正常出口时机
	 * 无 action, 有 output （注意，无 ouput 就是 fail, 如上LLM 脑子坏了）
	 *
	 * loop 其他出口, abort, fail
	 * 
	 * 退出 loop 的机制, 
	 * 1. 需要 emit agent_stop, 比如 llm 层错误, user abort, runtime 限制，如 maxturn
	 * 2. 正常无 action, 有 output
	 *
	 */

	private async runAgentLoop(prompt: string, loopDeps: LoopDeps): Promise<void> {
		const { abortSignal } = loopDeps;
		

		// 一个 input 到 output 为一个 roundId
		const roundId = `round_id_${randomUUID()}`;
		let turn = 0;

		const inputEvent: AgentEvent = { type: EventType.INPUT, source: 'user', text: prompt, meta: { roundId, turn } };
		this.emit(inputEvent);

		while (true) {


			const emitAbort = () => {
				this.emit({
					type: EventType.AGENT_STOP,
					cause: 'user',
					// 注意 abortSignal.reason 要随时去读
					message: String(abortSignal.reason ?? 'aborted'),
					meta: { roundId, turn } 
				});
			}

			if (abortSignal.aborted) {
				emitAbort();
				// 用户取消, 退出
				return;
				
			}

			turn++;

			let turnThoughtTextBuffer = '';
			let turnOutputTextBuffer = '';

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

			const stream = this.AiClient.stream({
				model: this.model,
				input: context.events,
				systemPrompt: context.systemPrompt,
				tools: toolsMeta,
			});

			// 需要等把流迭代完了, 才能知道有没有指令来决定是否进行下一轮
			for await (const chunk of stream) {
				if (abortSignal.aborted) {
					emitAbort();
					return;
				}

				if (chunk.type === EventType.AGENT_STOP) {
					// LLM 厂商的错误, 我们无能为力, 但要进 canonicalEvents, 需要审计, 但不进下一轮的 prompt context ,对 LLM 来说没用。
					this.emit({ ...chunk, meta: { roundId, turn } });
					return;
				}

				// 搜集 action 命令
				if (chunk.type === EventType.ACTION) {
					turnActionEvents.push({
						...chunk,
						meta: {
							roundId,
							turn,
						},
					});
				}

				if (chunk.type === EventType.THOUGHT) {
					// 存起来用于下一次
					this.emit({ type: EventType.THOUGHT_DELTA, text: chunk.text, meta: { roundId, turn } });
					turnThoughtTextBuffer += chunk.text;
				}

				if (chunk.type === EventType.OUTPUT) {
					this.emit({ type: EventType.OUTPUT_DELTA, text: chunk.text, meta: { roundId, turn } });
					turnOutputTextBuffer += chunk.text;
				}
			}

			if (!turnActionEvents.length && !turnOutputTextBuffer) {
				const message = 'LLM did not return an action or output.';
				// 跟上面 stream 里 error 捕捉一样, LLM 层的错误 agent 无能为力
				this.emit({ type: EventType.AGENT_STOP, cause: 'llm',  message, meta: { roundId, turn } });
				return;
			}

			// thought done
			if (turnThoughtTextBuffer) {
				this.emit({ type: EventType.THOUGHT, text: turnThoughtTextBuffer, meta: { roundId, turn } });
			}

			if (!turnActionEvents.length) {
				if (turnOutputTextBuffer) {
					this.emit({ type: EventType.OUTPUT, text: turnOutputTextBuffer, meta: { roundId, turn } });
				}
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
				// 外部环境不存在，回传给 ai， 它做下一步决策
				if (!toolCommand) {
					this.emit({
						type: EventType.OBSERVATION,
						isError: true,
						id,
						name,
						result: `Unknown tool: ${action.name}`,
						meta: { roundId, turn },
					});
					continue;
				}

				const { content, isError, isAborted } = await toolCommand.execute(args, {
					signal: abortSignal,
				});
				if (isAborted) {
					emitAbort();
					return;
				}

				// 外部执行错误也回传给 ai， 它做下一步决策
				this.emit({
					type: EventType.OBSERVATION,
					id,
					name,
					isError,
					result: content,
					meta: { roundId, turn },
				});
			}

			if (turnOutputTextBuffer) {
				this.emit({ type: EventType.OUTPUT, text: turnOutputTextBuffer, meta: { roundId, turn } });
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
