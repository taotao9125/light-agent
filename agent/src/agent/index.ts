import type { AiProvider } from '../ai/index';
import { type AgentEvent, EventType } from '../protocol/events';
import toolRegistry from '../tools/index';


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
	// input -> thought -> action -> observation -> output
	async runAgentLoop() {
		this.emit({ type: EventType.AGENT_START });

		let jobHasDone = false;

		while (!jobHasDone) {
			let nextTurnThoughtTextBuffer = '';
			let nextTurnOutputTextBuffer = '';
			let toolCallJobs = [];

			let hasEmitThoughtStart = false;
   	 // let hasEmitOutputStart = false;

			const stream = this.provider.stream({
				model: this.model,
				input: this.input,
				tools: this.toolRegistry.list(),
			});

			// 需要等把流迭代完了, 才能知道有没有指令来决定是否进行下一轮
			for await (const chunk of stream) {
				if (chunk.type === EventType.THOUGHT) {

					if (!hasEmitThoughtStart) {
						hasEmitThoughtStart = true;
						this.emit({ type: EventType.THOUGHT_START});
					}

					// 存起来用于下一次
					this.emit({ type: EventType.THOUGHT, text: chunk.text, });
					nextTurnThoughtTextBuffer += chunk.text;
				}

				if (chunk.type === EventType.OUTPUT) {
					this.emit({ type: EventType.OUTPUT, text: chunk.text });
					nextTurnOutputTextBuffer += chunk.text;
				}

				// 一旦有 action, LLM 需要 observe 外部调用, 进入下一步调用
				if (chunk.type === EventType.ACTION) {
					toolCallJobs.push(chunk)
				}

			}

			// 迭代完了，肯定就 thought 完了
			this.emit({ type: EventType.THOUGHT_DONE});

			if (toolCallJobs.length) {

				// has next turn
				jobHasDone = false;

				// 准备下一轮
				this.input.push({ type: EventType.THOUGHT, text: nextTurnThoughtTextBuffer });
				this.input.push({ type: EventType.OUTPUT, text: nextTurnOutputTextBuffer });


				// 观察外部环境输入
				for await (const tool of toolCallJobs) {
					// 也告诉给 LLM，它之前返了哪些指令
					this.input.push(tool);
					const { name, id, args } = tool;
					const toolCommand = toolRegistry.get(name);
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


			} else {
				// 结束了
				jobHasDone = true;
				this.emit({ type: EventType.AGENT_DONE });
				break;
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
