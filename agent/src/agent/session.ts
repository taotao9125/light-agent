import type { AgentLoopInterface } from './agentLoop';
import { type AgentEvent, EventType, type Meta } from '../protocol/events';
import {type SessionStoreInterface} from './store';

type Config = {
	agentLoop: AgentLoopInterface;
	sessionId: string;
	store: SessionStoreInterface
};

type Job = {
	prompt: string;
	resolve: () => void;
	reject: (reason?: unknown) => void;
};


export type SessionEvent = 
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'agent_done'; meta?: Meta }
	| { type: 'agent_error'; message: string;  meta?: Meta }
	| { type: 'input'; text: string; source?: 'user' | 'system'; meta?: Meta }
	| { type: 'thought_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string;  meta?: Meta }
	| { type: 'thought_done'; text: string;  meta?: Meta}
	| { type: 'action_start'; id: string; name: string; args: Record<string, any>; meta?: Meta }
	| { type: 'action_done'; id: string; result: any;  name: string; meta?: Meta }
	| { type: 'output_start'; meta?: Meta }
	| { type: 'output_delta'; text: string;  meta?: Meta }
	| { type: 'output_done'; text: string;  meta?: Meta }


type SessionEventListener = (event: SessionEvent) => void;

export interface AgentSessionInterface {
	prompt: (prompt: string) => Promise<void>;
	on: (listener: SessionEventListener) => () => void;
	getEventLog: () => AgentEvent[];
}

const COMMITTED_EVENT_TYPES = [
	EventType.INPUT,
	EventType.THOUGHT,
	EventType.ACTION,
	EventType.OBSERVATION,
	EventType.OUTPUT,
] as const;

type CommittedEventType = (typeof COMMITTED_EVENT_TYPES)[number];

function isCommittedEvent(event: AgentEvent): event is Extract<AgentEvent, { type: CommittedEventType }> {
	return (COMMITTED_EVENT_TYPES as readonly string[]).includes(event.type);
}

function getTurnKey(event: AgentEvent) {
	const { roundId, turn } = event.meta ?? {};
	if (!roundId || turn == null) return undefined;
	return `${roundId}:${turn}`;
}

export default class AgentSession implements AgentSessionInterface {
	private sessionId: string;
	private agentLoop: AgentLoopInterface;
	private isRunning: boolean;
	private queue: Job[];
	private store: SessionStoreInterface;
	private events: AgentEvent[];
	private listeners: SessionEventListener[];
	private activeThoughtTurns: Set<string>;
	private activeOutputTurns: Set<string>;

	constructor(config: Config) {
		this.sessionId = config.sessionId;
		this.isRunning = false;
		this.queue = [];
		this.events = [];
		this.listeners = [];
		this.activeThoughtTurns = new Set();
		this.activeOutputTurns = new Set();
		this.store = config.store;
		this.agentLoop = config.agentLoop;
		this.agentLoop.on((event) => {
			this.handleAgentEvent(event);
		});
	}

	on(listener: SessionEventListener): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	getEventLog(): AgentEvent[] {
		return [...this.events];
	}

	private handleAgentEvent(event: AgentEvent) {
		for (const lifecycleEvent of this.projectSessionEvents(event)) {
			this.emit(lifecycleEvent);
		}

		if (isCommittedEvent(event)) {
			this.events.push(event);
			this.store.append(this.sessionId, event);
		}

	}

	private projectSessionEvents(event: AgentEvent): SessionEvent[] {
		switch (event.type) {
			case EventType.INPUT:
				return [
					{ type: 'agent_start', meta: event.meta },
					{ type: 'input', text: event.text, source: event.source, meta: event.meta },
				];

			case EventType.THOUGHT_DELTA: {
				const key = getTurnKey(event);
				if (!key || this.activeThoughtTurns.has(key)) {
					return [{ type: 'thought_delta', text: event.text, meta: event.meta }]
				};

				this.activeThoughtTurns.add(key);
				return [
					{ type: 'thought_start', meta: event.meta },
					{ type: 'thought_delta', text: event.text, meta: event.meta }
				];
			}

			case EventType.THOUGHT: {
				const key = getTurnKey(event);
				if (key) this.activeThoughtTurns.delete(key);

				return [{ type: 'thought_done', text: event.text,  meta: event.meta }];
			}

			case EventType.OUTPUT_DELTA: {
				const key = getTurnKey(event);
				if (!key || this.activeOutputTurns.has(key)) {
					return [{ type: 'output_delta', text: event.text, meta: event.meta }];
				}

				this.activeOutputTurns.add(key);

				return [
					{ type: 'output_start', meta: event.meta },
					{ type: 'output_delta', text: event.text, meta: event.meta }
				];
			}

			case EventType.OUTPUT: {
				const key = getTurnKey(event);
				if (key) this.activeOutputTurns.delete(key);

				return [{ type: 'output_done', text: event.text, meta: event.meta }];
			}

			case EventType.ACTION:
				return [{
					type: 'action_start',
					id: event.id,
					name: event.name,
					args: event.args,
					meta: event.meta,
				}];

			case EventType.OBSERVATION:
				return [{
					type: 'action_done',
					id: event.id,
					result: event.result,
					name: event.name,
					meta: event.meta,
				}];

			case EventType.AGENT_ERROR:
				this.activeThoughtTurns.clear();
				this.activeOutputTurns.clear();
				return [{
					type: 'agent_error',
					message: event.message,
					meta: event.meta
				}];

			default:
				return [];
		}
	}

	private emit(event: SessionEvent) {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	prompt(prompt: string) {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.queue.push({
			prompt,
			resolve,
			reject,
		});
		this.run();

		return promise;
	}

	private async run() {
		if (!this.queue.length) return;
		if (this.isRunning) return;

		const nextJob = this.queue.shift();
		if (!nextJob) return;

		try {
			this.isRunning = true;
			await this.agentLoop.prompt(nextJob.prompt);
			this.emit({ type: 'agent_done' });
			nextJob.resolve();
		} catch (e) {
			nextJob.reject(e);
		} finally {
			this.isRunning = false;
			this.run();
		}
	}
}
