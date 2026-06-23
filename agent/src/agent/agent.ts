import { EventType } from '../protocol/events';
import AgentLoop from './agentLoop';
import contextBuilder, { type Context } from './context/contextBuilder';

import type { Vender } from '../ai/index';
import type { AgentEvent, TraceEvent } from '../protocol/events';
import type { AgentLoopInterface } from './agentLoop';
import type { AgentViewEvent, AgentViewListener } from './helpers';

export type { AgentViewEvent, AgentViewListener } from './helpers';

import { projectAgentView } from './helpers';
import ToolRegistry, { type Tool } from './tool';
import createRecallTool from './internalTools/createRecallTool';

import type { SessionStoreInterface } from './store';

type Config = {
	sessionId: string;
	store?: SessionStoreInterface;
	vender: Vender.Config;
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
		});

		

		this.agentLoop.on((event) => {
			void this.handleAgentEvent(event);
		});

		const recallTool = createRecallTool(() => this.canonicalEvents)

		this.toolRegistry.register(recallTool.name, recallTool);
	}

	private getVenderAdaptor() {
		return this.agentLoop.getVenderAdaptor();
	}

	private async handleAgentEvent(event: AgentEvent) {
		for (const viewEvent of projectAgentView(event)) {
			this.emit(viewEvent);
		}

		this.commitEvent(event);
	}

	private commitEvent(event: AgentEvent) {
		switch (event.type) {
			case EventType.INPUT:
			case EventType.THOUGHT:
			case EventType.ACTIONS:
			case EventType.OBSERVATIONS:
			case EventType.OUTPUT:
				this.canonicalEvents.push(event);
				break;
			case EventType.AGENT_TRACE:
				this.traceEvents.push(event);
				break;
		}

		// await this.store?.append(this.sessionId, event);
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
					const snap = await contextBuilder({
						events: this.canonicalEvents,
						traces: this.traceEvents,
						venderAdaptor: this.getVenderAdaptor(),
						...this.context,
					});
					return snap;
				},
				pullToolsSnap: () => this.toolRegistry.getTools(),
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
			canonicalEvents: this.canonicalEvents,
		};
	}
}
