import { randomUUID } from 'node:crypto';
import type { CreateClient } from '../ai/index';
import { createClient } from '../ai/index';
import type { ActionEvent, AgentError, AgentEvent, ObservationEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import type { AgentLoopConfig, ContextBuildOuput } from './types';

import type { ToolDefinition } from './types';




type AgentEventListener = (event: AgentEvent) => void;

type LoopDeps = {
	abortSignal: AbortSignal;
	pullContextSnap: () => ContextBuildOuput;
	pullToolsSnap: () => ToolDefinition<any, any>[]
};
export interface AgentLoopInterface {
	prompt: (prompt: string, options: LoopDeps) => Promise<void>;
	on: (listener: AgentEventListener) => void;
}


function toToolsMap(tools: ToolDefinition<any, any>[]) {
	const map = new Map<string, ToolDefinition<any, any>>();
	for (const tool of tools) {
		map.set(tool.name, tool)
	}
	return map;
}

function toToolsMeta(tools: ToolDefinition<any, any>[]) {
	return tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		schema: tool.schema
	}))
}

class AgentLoop implements AgentLoopInterface {
	private AiClient: ReturnType<CreateClient>;
	private listeners: AgentEventListener[] = [];
	private model: string;
	private maxTurns: number;
	private currentRun: { roundId: string; turn: number } = { roundId: '', turn: 0 };
	constructor(config: AgentLoopConfig) {
		this.model = config.vender.model;
		this.maxTurns = 20;
		this.AiClient = createClient({
			venderName: config.vender.name,
			apiKey: config.vender.apiKey,
			baseURL: config.vender.baseURL
		})
	}

	private emit(event: AgentEvent): void {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}
	// input -> thought -> action -> observation -> output
	// loop 出口
	// 1. > turns
	// 2. error
	// 3. no action + has output = done;
	// 4. no action	+ no output = error;

	private async runAgentLoop(prompt: string, loopDeps: LoopDeps) {
		const { abortSignal } = loopDeps;

		abortSignal?.throwIfAborted();

		// 一个 input 到 output 为一个 roundId
		const roundId = `round_id_${randomUUID()}`;
		let turn = 0;
		this.currentRun = {
			roundId,
			turn,
		};

		const inputEvent: AgentEvent = { type: EventType.INPUT, source: 'user', text: prompt, meta: { roundId, turn } };
		this.emit(inputEvent);

		while (true) {
			abortSignal?.throwIfAborted();
			turn++;

			this.currentRun = {
				roundId,
				turn,
			};

			let turnThoughtTextBuffer = '';
			let turnOutputTextBuffer = '';
			const turnActionEvents: ActionEvent[] = [];
			const errorEvents: AgentError[] = [];

			// enable tool register dynamically
			const tools = loopDeps.pullToolsSnap();
			const toolsMap = toToolsMap(tools);
			const toolsMeta = toToolsMeta(tools);

			// refresh context
			const context = loopDeps.pullContextSnap();

			if (turn > this.maxTurns) {
				this.emit({
					type: EventType.AGENT_ERROR,
					message: `Agent stopped after reaching max turns: ${this.maxTurns}`,
					meta: { roundId, turn },
				});
				break;
			}



			const stream = this.AiClient.stream({
				model: this.model,
				input: context.events,
				systemPrompt: context.systemPrompt,
				tools: toolsMeta,
			});

			// 需要等把流迭代完了, 才能知道有没有指令来决定是否进行下一轮
			for await (const chunk of stream) {
				abortSignal?.throwIfAborted();

				if (chunk.type === EventType.AGENT_ERROR) {
					errorEvents.push(chunk);
					break;
				}

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
				errorEvents.push({
					type: EventType.AGENT_ERROR,
					message: 'LLM did not return an action or output.',
					meta: { roundId, turn },
				});
			}

			if (errorEvents.length) {
				errorEvents.forEach((event) => {
					this.emit({ type: EventType.AGENT_ERROR, message: event.message, meta: { roundId, turn } });
				});
				break;
			}

			// thought done
			if (turnThoughtTextBuffer) {
				this.emit({ type: EventType.THOUGHT, text: turnThoughtTextBuffer, meta: { roundId, turn } });
			}


			let shouldBreakLoop = false;

			if (!turnActionEvents.length) {
				shouldBreakLoop = true;
			} else {
				// 观察外部环境输入, 自我修正环
				for (const action of turnActionEvents) {
					abortSignal?.throwIfAborted();
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
						})
						continue;
					}
					const { content, isError } = await toolCommand.execute(args, {
						cwd: process.cwd(),
						signal: abortSignal,
					});
					this.emit({
						type: EventType.OBSERVATION,
						id,
						name,
						isError,
						result: content,
						meta: { roundId, turn },
					})

				}
			}

			if (turnOutputTextBuffer) {
				this.emit({ type: EventType.OUTPUT, text: turnOutputTextBuffer, meta: { roundId, turn } });
			}

			if (shouldBreakLoop) break;
		}
	}

	async prompt(prompt: string, loopDeps: LoopDeps) {
		try {
			await this.runAgentLoop(prompt, loopDeps);
		} catch (e) {
			// 记录 interrupt
			if (loopDeps.abortSignal.aborted) {
				this.emit({
					type: EventType.INTERRUPT,
					reason: String(loopDeps.abortSignal.reason ?? 'aborted'),
					meta: {
						roundId: this.currentRun.roundId,
						turn: this.currentRun.turn,
					},
				});
				return;
			}

			throw e;
		} finally {
			this.currentRun = {
				roundId: '',
				turn: 0,
			};
		}
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
	}
}

export default AgentLoop;
