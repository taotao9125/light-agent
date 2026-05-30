import { type AgentEvent, EventType, type Meta } from '../protocol/events';
import type { AgentLoopInterface } from './agentLoop';
import contextBuilder from './contextBuider';
import type { SessionStoreInterface } from './store';

type Config = {
	agentLoop: AgentLoopInterface;
	sessionId: string;
	store?: SessionStoreInterface;
};

type Job = {
	prompt: string;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	abortController: AbortController;
};

export type SessionEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'agent_done'; meta?: Meta }
	| { type: 'agent_aborted'; reason?: unknown; meta?: Meta }
	| { type: 'agent_error'; message: string; meta?: Meta }
	| { type: 'input'; text: string; source?: 'user' | 'system'; meta?: Meta }
	| { type: 'thought_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'thought_done'; text: string; meta?: Meta }
	| { type: 'action_start'; id: string; name: string; args: Record<string, any>; meta?: Meta }
	| { type: 'action_done'; id: string; result: any; name: string; meta?: Meta }
	| { type: 'output_start'; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'output_done'; text: string; meta?: Meta }
	| { type: 'interrupt'; reason: string; meta?: Meta };

type SessionEventListener = (event: SessionEvent) => void;

export interface AgentSessionInterface {
	prompt: (prompt: string) => Promise<void>;
	on: (listener: SessionEventListener) => () => void;
	interrupt: () => void;
	getState: () => Record<string, any>;
	getEventLog: () => AgentEvent[];
}

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

function getTurnKey(event: AgentEvent) {
	const { roundId, turn } = event.meta ?? {};
	if (!roundId || turn == null) return undefined;
	return `${roundId}:${turn}`;
}

function createSessionEventProjector() {
	const activeThoughtTurns = new Set<string>();
	const activeOutputTurns = new Set<string>();
	return function projectSessionEvents(event: AgentEvent): SessionEvent[] {
		switch (event.type) {
			case EventType.INPUT:
				return [
					{ type: 'agent_start', meta: event.meta },
					{ type: 'input', text: event.text, source: event.source, meta: event.meta },
				];

			case EventType.THOUGHT_DELTA: {
				const key = getTurnKey(event);
				if (!key || activeThoughtTurns.has(key)) {
					return [{ type: 'thought_delta', text: event.text, meta: event.meta }];
				}

				activeThoughtTurns.add(key);
				return [
					{ type: 'thought_start', meta: event.meta },
					{ type: 'thought_delta', text: event.text, meta: event.meta },
				];
			}

			case EventType.THOUGHT: {
				const key = getTurnKey(event);
				if (key) activeThoughtTurns.delete(key);

				return [{ type: 'thought_done', text: event.text, meta: event.meta }];
			}

			case EventType.OUTPUT_DELTA: {
				const key = getTurnKey(event);
				if (!key || activeOutputTurns.has(key)) {
					return [{ type: 'output_delta', text: event.text, meta: event.meta }];
				}

				activeOutputTurns.add(key);

				return [
					{ type: 'output_start', meta: event.meta },
					{ type: 'output_delta', text: event.text, meta: event.meta },
				];
			}

			case EventType.OUTPUT: {
				const key = getTurnKey(event);
				if (key) activeOutputTurns.delete(key);

				return [{ type: 'output_done', text: event.text, meta: event.meta }];
			}

			case EventType.ACTION:
				return [
					{
						type: 'action_start',
						id: event.id,
						name: event.name,
						args: event.args,
						meta: event.meta,
					},
				];

			case EventType.OBSERVATION:
				return [
					{
						type: 'action_done',
						id: event.id,
						result: event.result,
						name: event.name,
						meta: event.meta,
					},
				];

			case EventType.AGENT_ERROR:
				activeThoughtTurns.clear();
				activeOutputTurns.clear();
				return [
					{
						type: 'agent_error',
						message: event.message,
						meta: event.meta,
					},
				];

			case EventType.INTERRUPT:
				activeThoughtTurns.clear();
				activeOutputTurns.clear();
				return [
					{
						type: 'interrupt',
						reason: event.reason,
						meta: event.meta,
					},
				];

			default:
				return [];
		}
	}
}

export default class AgentSession implements AgentSessionInterface {
	private sessionId: string;
	private store?: SessionStoreInterface;
	private agentLoop: AgentLoopInterface;

	private isRunning = false;
	private queue: Job[] = [];
	private currentJob: Job | null = null;
	private canonicalEvents: AgentEvent[] = [];
	private listeners: SessionEventListener[] = [];
	private projectSessionEvents = createSessionEventProjector();

	constructor(config: Config) {
		this.sessionId = config.sessionId;
		this.store = config.store;
		this.agentLoop = config.agentLoop;
		this.agentLoop.on((event) => {
			void this.handleAgentEvent(event);
		});
	}

	getState() {
		return {
			isRunning: this.isRunning,
		};
	}

	on(listener: SessionEventListener): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	getEventLog(): AgentEvent[] {
		return [...this.canonicalEvents];
	}

	private async handleAgentEvent(event: AgentEvent) {
		for (const lifecycleEvent of this.projectSessionEvents(event)) {
			this.emit(lifecycleEvent);
		}

		await this.commitEvent(event);
	}

	async commitEvent(event: AgentEvent) {
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

	prompt(prompt: string) {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const abortController = new AbortController();
		this.queue.push({
			prompt,
			abortController,
			resolve,
			reject,
		});
		this.run();

		return promise;
	}

	interrupt(reason = 'user interrupted') {
		if (!this.currentJob) return;
		this.currentJob.abortController.abort(reason);
	}

	buildContext() {
		return contextBuilder(this.canonicalEvents);
	}

	private async run() {
		if (!this.queue.length) return;
		if (this.isRunning) return;

		const currentJob = this.queue.shift();
		if (!currentJob) return;

		try {
			this.isRunning = true;
			this.currentJob = currentJob;
			await this.agentLoop.prompt(currentJob.prompt, {
				abortSignal: this.currentJob.abortController.signal,
				buildContext: this.buildContext.bind(this),
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
			this.currentJob = null;
			this.isRunning = false;
			this.run();
		}
	}
}
