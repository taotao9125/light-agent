import { EventType } from '../protocol/events';
import AgentLoop from './agentLoop';
import buildContextSnap from './context/buildContextSnap';
import contextBuilder, { type Context } from './context/contextBuilder';

import type { Vender } from '../ai/index';
import type { AgentEvent, TraceEvent } from '../protocol/events';
import type { AgentLoopInterface } from './agentLoop';
import type { AgentViewEvent, AgentViewListener } from './helpers';

export type { AgentViewEvent, AgentViewListener } from './helpers';

import { projectAgentView } from './helpers';
import createRecallTool from './internalTools/createRecallTool';
import ToolRegistry, { type Tool } from './tool';

import type { SessionStoreInterface } from './store';

type Config = {
	sessionId: string;
	store?: SessionStoreInterface;
	vender: Vender.Config;
	strategy?: {
		maxTurns?: number;
	};
	context: Context.Config;
};

export interface AgentInterface {
	prompt: (prompt: string) => Promise<void>;
	on: (listener: AgentViewListener) => () => void;
	registerTool: (name: string, tool: Tool.Definition) => void;
	interrupt: () => void;
	getState: () => Record<string, any>;
}

type Job = {
	prompt: string;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	abortController: AbortController;
};

export default class Agent implements AgentInterface {
	private sessionId: string;
	private store?: SessionStoreInterface;
	private agentLoop: AgentLoopInterface;

	private runRecords = {
		queue: [] as Job[],
		activeJob: null as Job | null,
	};

	private context: Context.Config;
	private canonicalEvents: AgentEvent[] = [];
	private traceEvents: TraceEvent[] = [];
	private listeners: AgentViewListener[] = [];
	private toolRegistry = new ToolRegistry();

	constructor(config: Config) {
		this.sessionId = config.sessionId;
		this.store = config.store;
		this.context = config.context;

		this.agentLoop = new AgentLoop({
			vender: config.vender,
			strategy: config.strategy,
		});

		this.agentLoop.on((event) => {
			void this.handleAgentEvent(event);
		});

		const recallTool = createRecallTool(() => this.canonicalEvents);

		this.toolRegistry.register(recallTool.name, recallTool);
	}

	private async handleAgentEvent(event: AgentEvent) {
		for (const viewEvent of projectAgentView(event)) {
			this.emit(viewEvent);
		}

		this.commitEvent(event);
	}

	private async commitEvent(event: AgentEvent) {
		switch (event.type) {
			case EventType.INPUT:
			case EventType.THOUGHT:
			case EventType.ACTIONS:
			case EventType.OBSERVATIONS:
			case EventType.OUTPUT:
			case EventType.AGENT_STOP:
			case EventType.AGENT_SUMMARY:
				this.canonicalEvents.push(event);
				await this.store?.append(this.sessionId, event);
				break;
			case EventType.AGENT_TRACE:
				this.traceEvents.push(event);
				await this.store?.appendTrace(this.sessionId, event);
				break;
		}
	}

	private emit(event: AgentViewEvent) {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async processQueue() {
		if (!this.runRecords.queue.length) return;
		if (this.runRecords.activeJob) return;

		const currentJob = this.runRecords.queue.shift();
		if (!currentJob) return;

		try {
			this.runRecords.activeJob = currentJob;
			await this.agentLoop.prompt(currentJob.prompt, {
				abortSignal: currentJob.abortController.signal,
				pullContextSnap: async () => {
					const lastWindowTokens = this.traceEvents.at(-1)?.costs.totalTokens || 0;
					const strategyEnabled = this.context.strategyEnabled ?? true;
					const snap = await contextBuilder({
						prompts: this.context.prompts,
						skills: this.context.skills,
						events: this.canonicalEvents,
						lastWindowTokens,
						venderAdaptor: this.agentLoop.getVenderAdaptor(),
						tools: this.toolRegistry.getTools(),
						strategyEnabled,
					});

					if (snap.summaryEvent) {
						await this.commitEvent(snap.summaryEvent);
					}

					await this.store?.appendContextSnap(
						this.sessionId,
						buildContextSnap({
							snap,
							canonicalEvents: this.canonicalEvents,
							strategyEnabled,
							lastWindowTokens,
						}),
					);

					return snap;
				},
			});
			currentJob.resolve();
		} catch (e) {
			currentJob.reject(e);
		} finally {
			this.runRecords.activeJob = null;
			void this.processQueue();
		}
	}

	prompt(prompt: string) {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const abortController = new AbortController();
		this.runRecords.queue.push({
			prompt,
			abortController,
			resolve,
			reject,
		});
		void this.processQueue();
		return promise;
	}

	on(listener: AgentViewListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	registerTool(name: string, tool: Tool.Definition) {
		this.toolRegistry.register(name, tool);
	}

	interrupt(reason = 'user interrupted') {
		const activeJob = this.runRecords.activeJob;
		if (!activeJob) return;
		activeJob.abortController.abort(reason);
	}

	getState() {
		return {
			isRunning: !!this.runRecords.activeJob,
			// 这里如果需要更加精细化的 UI 显示如 system prompt token, tool token 等, 需要本地估算, 暂时不做
			currentWindowTokens: this.traceEvents.at(-1)?.costs.totalTokens || 0,
			contextStrategyEnabled: this.context.strategyEnabled ?? true,
		};
	}

	async loadSession(): Promise<void> {
		if (!this.store) return;

		this.canonicalEvents = await this.store.load(this.sessionId);
		this.traceEvents = await this.store.loadTraces(this.sessionId);
	}
}
