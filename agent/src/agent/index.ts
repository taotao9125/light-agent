import type { AiProvider } from '../ai/index';
import { type AgentEvent, EventType } from '../protocol/events';
import toolRegistry from '../tools/index';

// import type { Message } from '../protocol/message';
// import type { LLMToolCallEvent } from '../protocol/LLMEvent';

// import { AgentEvent } from '../protocol/agentEvent';

type AgentConfig = {
	provider: AiProvider;
	model: string;
	toolRegistry: typeof toolRegistry;
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
	constructor(config: AgentConfig) {
		this.provider = config.provider;
		this.toolRegistry = config.toolRegistry;
		this.input = [];
		this.listeners = [];
		this.model = config.model;
	}

	emit(event: AgentEvent): void {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}
	// input -> thought -> action -> ovservation -> output
	async runAgentLoop() {
		this.emit({ type: EventType.AGENT_START });

		let jobDone = false;

		while (!jobDone) {
			let thoughtTextBuffer = '';

			const stream = this.provider.stream({
				model: this.model,
				input: this.input,
				tools: this.toolRegistry.list(),
			});

			this.emit({ type: EventType.THOUGHT_START });
			for await (const chunk of stream) {
				if (chunk.type === EventType.THOUGHT) {
					this.emit({
						type: EventType.THOUGHT,
						text: chunk.text,
					});
					// 存起来用于下一次
					thoughtTextBuffer += chunk.text;
				}

				// 本轮 LLM 返回结束
				if (chunk.type === EventType.ACTION) {
					// thought done
					this.emit({ type: EventType.THOUGHT_DONE });
					this.input.push({
						type: EventType.THOUGHT,
						text: thoughtTextBuffer,
					});

					// action 扔回去
					this.input.push(chunk);

					// ovservation， 观察外部反应
					const toolCommand = toolRegistry.get(chunk.name);

					if (toolCommand) {
						const content = await toolCommand.execute(chunk.args, { cwd: process.cwd() });
						this.input.push({
							type: 'observation',
							id: chunk.id,
							name: chunk.name,
							result: content,
						});
					}
				}

				if (chunk.type === EventType.OUTPUT) {
					this.emit({
						type: EventType.OUTPUT,
						text: chunk.text,
					});

					// 下一轮不用了，用户已经有最终答案了
					jobDone = true;
				}
			}
		}

		this.emit({ type: EventType.AGENT_DONE });
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
