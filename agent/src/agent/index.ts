import type { AiProvider } from '../ai/index';
import { EventType } from '../protocol/events';
import type { AgentEvent, AgentError, ActionEvent } from '../protocol/events';
import toolRegistry from '../tools/index';



type AgentConfig = {
	provider: AiProvider;
	model: string;
	toolRegistry: typeof toolRegistry;
	maxTurns?: number;
};

type AgentEventListener = (event: AgentEvent) => void;

interface AgentInterface {
	prompt: (prompt: string) => void;
	on: (listener: AgentEventListener) => void;
}

class Agent implements AgentInterface {
	private provider: AiProvider;
	private toolRegistry: typeof toolRegistry;
	private input: AgentEvent[];
	private model: string;
	private listeners: AgentEventListener[];
	private maxTurns: number;
	constructor(config: AgentConfig) {
		this.provider = config.provider;
		this.toolRegistry = config.toolRegistry;
		this.input = [];
		this.listeners = [];
		this.model = config.model;
		this.maxTurns = config.maxTurns ?? 5;
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
	async runAgentLoop() {
		this.emit({ type: EventType.AGENT_START });

		let turn = 0;

		while (true) {
			turn++;
			let nextTurnThoughtTextBuffer = '';
			let nextTurnOutputTextBuffer = '';
			let actionEvents: ActionEvent[] = [];
			let errorEvents: AgentError[] = [];

			let hasEmitThoughtStart = false;

			if (turn > this.maxTurns) {
				this.emit({ type: EventType.AGENT_ERROR, message: `Agent stopped after reaching max turns: ${this.maxTurns}` })
				break;
			}

			const stream = this.provider.stream({
				model: this.model,
				input: this.input,
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
						errorEvents.push({type: EventType.AGENT_ERROR, message: `unknown tool \`${chunk.name}\``});
						break;
					}
					actionEvents.push(chunk)
				}

				if (chunk.type === EventType.THOUGHT) {

					if (!hasEmitThoughtStart) {
						hasEmitThoughtStart = true;
						this.emit({ type: EventType.THOUGHT_START });
					}

					// 存起来用于下一次
					this.emit({ type: EventType.THOUGHT, text: chunk.text, });
					nextTurnThoughtTextBuffer += chunk.text;
				}

				if (chunk.type === EventType.OUTPUT) {
					this.emit({ type: EventType.OUTPUT, text: chunk.text });
					nextTurnOutputTextBuffer += chunk.text;
				}


			}

			// 有 start 就有 end
			if (hasEmitThoughtStart) {
				this.emit({ type: EventType.THOUGHT_DONE });
			}
		


			if (errorEvents.length) {
				errorEvents.forEach(event => {
					this.emit({ type: EventType.AGENT_ERROR, message: event.message});
				})
				break;
			}

			if (!actionEvents.length) {
				const hasOutput = nextTurnOutputTextBuffer;
				if (hasOutput) break;

				this.emit({ type: EventType.AGENT_ERROR, message: 'Model returned no action and no output.'});
				break;
			}

			// 准备下一轮
			this.input.push({ type: EventType.THOUGHT, text: nextTurnThoughtTextBuffer });
			this.input.push({ type: EventType.OUTPUT, text: nextTurnOutputTextBuffer });


			// 观察外部环境输入
			for await (const action of actionEvents) {
				// 也告诉给 LLM，它之前返了哪些指令
				this.input.push(action);
				const { name, id, args } = action;
				const toolCommand = this.toolRegistry.get(name);
				if (toolCommand) {
					const content = await toolCommand.execute(args, { cwd: process.cwd() });
					this.input.push({
						type: 'observation',
						id,
						name,
						result: content
					});
				}
			}


		}


		this.emit({ type: EventType.AGENT_DONE })

	}

	prompt(prompt: string) {
		this.input.push({ type: EventType.INPUT, source: 'user', text: prompt });
		this.runAgentLoop();
	}

	on(listener: AgentEventListener) {
		this.listeners.push(listener);
	}
}

export default Agent;
