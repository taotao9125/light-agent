import { EventType } from '@light-agent/protocol/events';
import PQueue from 'p-queue';
import AgentLoop from './agentLoop.ts';
import contextBuilder from './context/contextBuilder.ts';

import type { Vender } from '@light-agent/ai';
import type { AgentEvent, SummaryEvent } from '@light-agent/protocol/events';
import type { Loop } from './agentLoop.ts';
import type { Context } from './context/contextBuilder.ts';
import type { AgentViewEvent, AgentViewListener } from './helpers.ts';
import type { AgentSession } from './session.ts';

export type { AgentViewEvent, AgentViewListener } from './helpers.ts';

import { projectAgentView } from './helpers.ts';
import ToolRegistry from './tool.ts';
import createRecallTool from './tools/createRecallTool.ts';

type Config = {
	cwd: string;
	session?: AgentSession;
	venderAdaptor: Vender.Adaptor;
	context: Context.Config;
	loop?: {
		retry?: Loop.RetryConfig;
	};
};

export default class Agent {
	private cwd: string;
	private session?: AgentSession;
	private agentLoop: AgentLoop;
	private venderAdaptor: Vender.Adaptor;
	private promptQueue = new PQueue({ concurrency: 1 });
	private runningPromptAbortController: AbortController | null = null;

	private context: Context.Config;
	private canonicalEvents: AgentEvent[] = [];
	private listeners: AgentViewListener[] = [];
	public tool: ToolRegistry;

	constructor(config: Config) {
		this.cwd = config.cwd;
		this.session = config.session;
		this.context = config.context;
		this.venderAdaptor = config.venderAdaptor;
		this.tool = new ToolRegistry(() => ({
			cwd: this.cwd,
			signal: this.runningPromptAbortController?.signal,
		}));

		this.agentLoop = new AgentLoop({
			venderAdaptor: this.venderAdaptor,
			toolRegistry: this.tool,
			retry: config.loop?.retry,
		});

		this.agentLoop.on((event) => {
			this.handleAgentEvent(event);
		});

		this.tool.register(this.createRecallTool());
	}

	private createRecallTool() {
		return createRecallTool(
			() => this.canonicalEvents,
			async () => {
				if (!this.session) return [];
				return await this.session.load();
			},
		);
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
			case EventType.Tool_Result:
			case EventType.OUTPUT:
			case EventType.AGENT_STOP:
			case EventType.AGENT_SUMMARY:
			case EventType.AGENT_TRACE:
				this.canonicalEvents.push(event);
				await this.session?.append(event);
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

	prompt(prompt: string) {
		const abortController = new AbortController();
		return this.promptQueue.add(async () => {
			this.runningPromptAbortController = abortController;
			try {
				await this.agentLoop.prompt(prompt, {
					abortSignal: abortController.signal,
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
			} finally {
				this.runningPromptAbortController = null;
			}
		});
	}

	on(listener: AgentViewListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	interrupt(reason = 'user interrupted') {
		this.runningPromptAbortController?.abort(reason);
	}

	getLastWindowCosts() {
		return this.canonicalEvents.findLast((event) => event.type === EventType.AGENT_TRACE);
	}

	getState() {
		return {
			isRunning: this.promptQueue.pending > 0,
			queuedPrompts: this.promptQueue.size,
			// 这里如果需要更加精细化的 UI 显示如 system prompt token, tool token 等, 需要本地估算, 暂时不做
			currentWindowTokens: this.getLastWindowCosts()?.costs.totalTokens || 0,
			contextStrategyEnabled: this.context.strategyEnabled ?? true,
		};
	}

	async loadSession(): Promise<void> {
		if (!this.session) return;
		this.canonicalEvents = await this.session.load();
	}
}
