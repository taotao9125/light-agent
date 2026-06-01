import { type AgentEvent, EventType, type Meta } from '../protocol/events';
import type { AgentLoopInterface } from './agentLoop';
import type { SessionStoreInterface } from './store';
import contextBuilder from './contextBuilder';
import toolRegistryClass from './toolRegistry';
import type { ToolDefinition } from './types';
import type { ContextSource } from './contextBuilder';

import type {AgentEventListener, SessionEvent} from './helpers';
import {createAgentEventProjector} from './helpers';


type Config = {
	agentLoop: AgentLoopInterface;
	sessionId: string;
	store?: SessionStoreInterface;
	contextSource: ContextSource
};

export interface AgentInterface {
	prompt: (prompt: string) => Promise<void>;
	on: (listener: AgentEventListener) => () => void;
	registerTool: (name: string, tool: ToolDefinition<any, any>) => void;
	interrupt: () => void;
	getState: () => Record<string, any>;
}





type Job = {
	prompt: string;
	resolve: () => void;
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
	private contextSource: ContextSource;

	private runRecords = {
		queue: [] as Job[] ,
		activeJob: null as Job | null,
	}

	private canonicalEvents: AgentEvent[] = [];
	private listeners: AgentEventListener[] = [];
	private projectAgentEvents = createAgentEventProjector();
	private toolRegistry = new toolRegistryClass();
	constructor(config: Config) {
		this.sessionId = config.sessionId;
		this.store = config.store;
		this.contextSource = config.contextSource;
		this.agentLoop = config.agentLoop;
		this.agentLoop.on((event) => {
			void this.handleAgentEvent(event);
		});
	}

	private async handleAgentEvent(event: AgentEvent) {
		for (const lifecycleEvent of this.projectAgentEvents(event)) {
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

	private buildContext() {
		return contextBuilder({
			events: this.canonicalEvents,
			...this.contextSource
		});
	}

	private async processQueue() {
		if (!this.runRecords.queue.length) return;
		if (this.runRecords.activeJob) return;

		const currentJob = this.runRecords.queue.shift();
		if (!currentJob) return;

		try {
			this.runRecords.activeJob = currentJob;
			await this.agentLoop.prompt(currentJob.prompt, {
				abortSignal: this.runRecords.activeJob.abortController.signal,
				buildContext: this.buildContext.bind(this),
				getTools: () => this.toolRegistry.getTools()
			});
			this.emit({ type: 'agent_done' });
			currentJob.resolve();
		} catch (e) {
			if (currentJob.abortController.signal.aborted) {
				this.emit({
					type: 'agent_aborted',
					reason: currentJob.abortController.signal.reason,
				});
				currentJob.resolve();
				return;
			}
			currentJob.reject(e);
		} finally {
			this.runRecords.activeJob = null;
			this.processQueue();
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
		const avtiveJob = this.runRecords.activeJob
		if (!avtiveJob) return;
		avtiveJob.abortController.abort(reason);
	}

	getState() {
		return {
			isRunning: !!this.runRecords.activeJob,
			canonicalEvents: this.canonicalEvents
		};
	}


}
