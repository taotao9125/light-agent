import { randomUUID } from 'node:crypto';
import type { AiProvider } from '../ai/index';
import type { ActionEvent, AgentError, AgentEvent, ObservationEvent } from '../protocol/events';
import { EventType } from '../protocol/events';
import type toolRegistry from '../tools/index';

type AgentConfig = {
	provider: AiProvider;
	model: string;
	toolRegistry: typeof toolRegistry;
	maxTurns?: number;
};


type AgentEventListener = (event: AgentEvent) => void;

export interface AgentInterface {
	prompt: (prompt: string) => Promise<void>;
	on: (listener: AgentEventListener) => void;
	getCurrentPromptLog: () => AgentEvent[];
}

class Agent implements AgentInterface {
	private provider: AiProvider;
	private toolRegistry: typeof toolRegistry;
	private eventLog: AgentEvent[];
	private model: string;
	private listeners: AgentEventListener[];
	private maxTurns: number;
	constructor(config: AgentConfig) {
		this.provider = config.provider;
		this.toolRegistry = config.toolRegistry;
		this.eventLog = [];
		this.listeners = [];
		this.model = config.model;
		this.maxTurns = config.maxTurns ?? 20;
	}

	emit(event: AgentEvent): void {
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

	logs() {
		return this.eventLog;
	}

	getCurrentPromptLog() {
		const lastInputEventIndex = this.eventLog.findLastIndex(event => event.type === EventType.INPUT);
		return this.eventLog.slice(lastInputEventIndex);
	}

	async runAgentLoop(roundId: string) {
		this.emit({ type: EventType.AGENT_START, meta: { roundId } });

		let turn = 0;

		while (true) {
			turn++;
			let turnThoughtTextBuffer = '';
			let turnOutputTextBuffer = '';
			const turnActionEvents: ActionEvent[] = [];
			const turnObservationEvents: ObservationEvent[] = [];

			const errorEvents: AgentError[] = [];

			let hasEmitThoughtStart = false;

			if (turn > this.maxTurns) {
				this.emit({
					type: EventType.AGENT_ERROR,
					message: `Agent stopped after reaching max turns: ${this.maxTurns}`,
					meta: { roundId }
				});
				break;
			}

			const stream = this.provider.stream({
				model: this.model,
				input: this.eventLog,
				tools: this.toolRegistry.list(),
			});

			// 需要等把流迭代完了, 才能知道有没有指令来决定是否进行下一轮
			for await (const chunk of stream) {
				if (chunk.type === EventType.AGENT_ERROR) {
					errorEvents.push(chunk);
					break;
				}

				// 一旦有 action, LLM 需要 observe 外部调用, 进入下一步调用
				if (chunk.type === EventType.ACTION) {
					if (!this.toolRegistry.get(chunk.name)) {
						errorEvents.push({ type: EventType.AGENT_ERROR, message: `unknown tool \`${chunk.name}\``, meta: { roundId } });
						break;
					}
					turnActionEvents.push({
						...chunk,
						meta: {
							roundId
						}
					});
				}

				if (chunk.type === EventType.THOUGHT) {
					if (!hasEmitThoughtStart) {
						hasEmitThoughtStart = true;
						this.emit({ type: EventType.THOUGHT_START, meta: { roundId } });
					}

					// 存起来用于下一次
					this.emit({ type: EventType.THOUGHT, text: chunk.text, meta: { roundId } });
					turnThoughtTextBuffer += chunk.text;
				}

				if (chunk.type === EventType.OUTPUT) {
					this.emit({ type: EventType.OUTPUT, text: chunk.text, meta: { roundId } });
					turnOutputTextBuffer += chunk.text;
				}
			}

			// 有 start 就有 end
			if (hasEmitThoughtStart) {
				this.emit({ type: EventType.THOUGHT_DONE, meta: { roundId } });
			}

			if (!turnActionEvents.length && !turnOutputTextBuffer) {
				errorEvents.push({ type: EventType.AGENT_ERROR, message: 'LLM did not return an action or output.', meta: { roundId } });
			}

			if (errorEvents.length) {
				errorEvents.forEach((event) => {
					this.emit({ type: EventType.AGENT_ERROR, message: event.message, meta: { roundId } });
				});
				break;
			}

			let shouldBreakLoop = false;

			if (!turnActionEvents.length) {
				shouldBreakLoop = true;
			} else {
				// 观察外部环境输入
				for await (const action of turnActionEvents) {
					const { name, id, args } = action;
					const toolCommand = this.toolRegistry.get(name);
					if (toolCommand) {
						const content = await toolCommand.execute(args, { cwd: process.cwd() });
						turnObservationEvents.push({
							type: 'observation',
							id,
							name,
							result: content,
							meta: { roundId }
						});
					}
				}
			}

			// 没有 buffer 也要推进去, 这样 log 更线性
			if (turnThoughtTextBuffer) {
				this.eventLog.push({ type: EventType.THOUGHT, text: turnThoughtTextBuffer, meta: { roundId } });
			}

			this.eventLog.push(...turnActionEvents);
			this.eventLog.push(...turnObservationEvents);
			if (turnOutputTextBuffer) {
				this.eventLog.push({ type: EventType.OUTPUT, text: turnOutputTextBuffer, meta: { roundId } });
			}


			if (shouldBreakLoop) break;
		}

		this.emit({ type: EventType.AGENT_DONE, meta: { roundId } });
	}

	async prompt(prompt: string) {
		// 一个 input 到 output 为一个 roundId
		const roundId = `round_id_${randomUUID()}`;
		this.eventLog.push({ type: EventType.INPUT, source: 'user', text: prompt, meta: { roundId} });
		await this.runAgentLoop(roundId);
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
	}
}

export default Agent;
