import { EventType } from '@light-agent/protocol/events';
import AgentLoop from './agentLoop.ts';
import contextBuilder from './context/contextBuilder.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, SummaryEvent } from '@light-agent/protocol/events';
import type { Context } from './context/contextBuilder.ts';
import type { AgentViewEvent, AgentViewListener } from './helpers.ts';

export type { AgentViewEvent, AgentViewListener } from './helpers.ts';

import { projectAgentView } from './helpers.ts';
import ToolRegistry from './tool.ts';
import createGrepTool from './tools/createGrepTool.ts';
import createListProjectFilesTreeTool from './tools/createListProjectFilesTreeTool.ts';
import createReadFileTool from './tools/createReadFileTool.ts';
import createRecallTool from './tools/createRecallTool.ts';

import type { SessionStoreInterface } from './store.ts';

type Config = {
	sessionId: string;
	cwd: string;
	store?: SessionStoreInterface;
	venderAdaptor: Vender.Adaptor;
	context: Context.Config;
};

type Job = {
	prompt: string;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	abortController: AbortController;
};

export default class Agent {
	private cwd: string;
	private store?: SessionStoreInterface;
	private agentLoop: AgentLoop;
	private venderAdaptor: Vender.Adaptor;

	private runRecords = {
		queue: [] as Job[],
		activeJob: null as Job | null,
	};

	private context: Context.Config;
	private canonicalEvents: AgentEvent[] = [];
	private listeners: AgentViewListener[] = [];
	public tool: ToolRegistry;

	constructor(config: Config) {
		this.cwd = config.cwd;
		this.store = config.store;
		this.context = config.context;
		this.venderAdaptor = config.venderAdaptor;
		this.tool = new ToolRegistry(() => ({
			cwd: this.cwd,
			signal: this.runRecords.activeJob?.abortController.signal,
		}));

		this.agentLoop = new AgentLoop({
			venderAdaptor: this.venderAdaptor,
			toolRegistry: this.tool,
		});

		this.agentLoop.on((event) => {
			this.handleAgentEvent(event);
		});

		const recallTool = createRecallTool(() => this.canonicalEvents);
		const listProjectFilesTreeTool = createListProjectFilesTreeTool();
		const grepTool = createGrepTool();
		const readFileTool = createReadFileTool();

		this.tool.register(recallTool);
		this.tool.register(listProjectFilesTreeTool);
		this.tool.register(grepTool);
		this.tool.register(readFileTool);
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
			case EventType.Tool_Calls:
			case EventType.Tool_Results:
			case EventType.OUTPUT:
			case EventType.AGENT_STOP:
			case EventType.AGENT_SUMMARY:
			case EventType.AGENT_TRACE:
				this.canonicalEvents.push(event);
				await this.store?.append(event);
				if (event.type === EventType.AGENT_SUMMARY) {
					this.pruneCanonicalEventsAfterSummary(event);
				}
				break;
		}
	}

	private pruneCanonicalEventsAfterSummary(summaryEvent: SummaryEvent) {
		const endRoundId = summaryEvent.meta?.endRoundId;
		const endTurn = summaryEvent.meta?.endTurn;

		if (!endRoundId || typeof endTurn !== 'number') return;

		const endEventIndex = this.canonicalEvents.findLastIndex(
			(event) => event.meta?.roundId === endRoundId && event.meta?.turn === endTurn,
		);

		if (endEventIndex === -1) return;

		const eventsAfterSummaryBoundary = this.canonicalEvents
			.slice(endEventIndex + 1)
			.filter((event) => event.type !== EventType.AGENT_SUMMARY);

		this.canonicalEvents = [summaryEvent, ...eventsAfterSummaryBoundary];
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
					const lastWindowTokens = this.getLastWindowCosts()?.costs.totalTokens || 0;
					const strategyEnabled = this.context.strategyEnabled ?? true;
					const snap = await contextBuilder({
						prompts: this.context.prompts,
						skills: this.context.skills,
						events: this.canonicalEvents,
						venderAdaptor: this.venderAdaptor,
						lastWindowTokens,
						strategyEnabled,
					});

					if (snap.summaryEvent) {
						await this.commitEvent(snap.summaryEvent);
					}

					return snap;
				},
			});
			currentJob.resolve();
		} catch (e) {
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
		void this.processQueue();
		return promise;
	}

	on(listener: AgentViewListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	interrupt(reason = 'user interrupted') {
		const activeJob = this.runRecords.activeJob;
		if (!activeJob) return;
		activeJob.abortController.abort(reason);
	}

	getLastWindowCosts() {
		return this.canonicalEvents.findLast((event) => event.type === EventType.AGENT_TRACE);
	}

	getState() {
		return {
			isRunning: !!this.runRecords.activeJob,
			// 这里如果需要更加精细化的 UI 显示如 system prompt token, tool token 等, 需要本地估算, 暂时不做
			currentWindowTokens: this.getLastWindowCosts()?.costs.totalTokens || 0,
			contextStrategyEnabled: this.context.strategyEnabled ?? true,
		};
	}

	async loadSession(): Promise<void> {
		if (!this.store) return;
		this.canonicalEvents = await this.store.load();
	}
}
