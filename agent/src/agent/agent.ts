import { type AgentEvent, EventType } from '../protocol/events';
import type { AgentLoopInterface, PromptCallStatus } from './agentLoop';
import AgentLoop from './agentLoop';
import contextBuilder from './contextBuilder';
import type { AgentEventListener, SessionEvent } from './helpers';
import { projectAgentEvents } from './helpers';
import type { SessionStoreInterface } from './store';
import toolRegistryClass from './toolRegistry';
import type { ContextBuildInput, ToolDefinition, Vender } from './types';

type Config = {
	sessionId: string;
	store?: SessionStoreInterface;
	vender: Vender;
	context: ContextBuildInput;
};

export interface AgentInterface {
	prompt: (prompt: string) => Promise<PromptCallStatus>;
	on: (listener: AgentEventListener) => () => void;
	registerTool: (name: string, tool: ToolDefinition<any, any>) => void;
	interrupt: () => void;
	getState: () => Record<string, any>;
}

type Job = {
	prompt: string;
	resolve: (result: PromptCallStatus) => void;
	reject: (reason?: unknown) => void;
	abortController: AbortController;
};

const COMMITTED_EVENT_TYPES = new Set<string>([
	EventType.INPUT,
	EventType.THOUGHT,
	EventType.ACTION,
	EventType.OBSERVATION,
	EventType.OUTPUT,
	EventType.INTERRUPT,
	EventType.AGENT_ERROR,
]);

function isCommittedEvent(event: AgentEvent) {
	return COMMITTED_EVENT_TYPES.has(event.type);
}

export default class Agent implements AgentInterface {
	private sessionId: string;
	private store?: SessionStoreInterface;
	private agentLoop: AgentLoopInterface;

	private runRecords = {
		queue: [] as Job[],
		activeJob: null as Job | null,
	};

	private context: ContextBuildInput;
	private canonicalEvents: AgentEvent[] = [];
	private listeners: AgentEventListener[] = [];
	private toolRegistry = new toolRegistryClass();
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
	}

	private async handleAgentEvent(event: AgentEvent) {
		for (const lifecycleEvent of projectAgentEvents(event)) {
			this.emit(lifecycleEvent);
		}

		await this.commitEvent(event);
	}

	private async commitEvent(event: AgentEvent) {
		if (isCommittedEvent(event)) {
			this.canonicalEvents.push(event);
			await this.store?.append(this.sessionId, event);
		}
	}

	private emit(event: SessionEvent) {
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
			const result = await this.agentLoop.prompt(currentJob.prompt, {
				abortSignal: currentJob.abortController.signal,
				pullContextSnap: () => contextBuilder({ events: this.canonicalEvents, ...this.context }),
				pullToolsSnap: () => this.toolRegistry.getTools(),
			});

			switch (result.status) {
				case 'success':
				  this.emit({ type: 'agent_done' });
				  break;
				case 'aborted':
				  this.emit({ type: 'agent_aborted', reason: result.reason });
				  break;
				// fail: AGENT_ERROR 已在 loop emit，不用 agent_done
			  }

			currentJob.resolve(result);
		} catch (e) {
			currentJob.reject(e);
		} finally {
			this.runRecords.activeJob = null;
			this.processQueue();
		}
	}

	prompt(prompt: string) {
		const { promise, resolve, reject } = Promise.withResolvers<PromptCallStatus>();
		const abortController = new AbortController();
		this.runRecords.queue.push({
			prompt,
			abortController,
			resolve,
			reject,
		});
		this.processQueue();
		return promise;
	}

	on(listener: AgentEventListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	registerTool(name: string, tool: ToolDefinition<any, any>) {
		this.toolRegistry.register(name, tool);
	}

	interrupt(reason = 'user interrupted') {
		const avtiveJob = this.runRecords.activeJob;
		if (!avtiveJob) return;
		avtiveJob.abortController.abort(reason);
	}

	getState() {
		return {
			isRunning: !!this.runRecords.activeJob,
			canonicalEvents: this.canonicalEvents,
		};
	}
}
