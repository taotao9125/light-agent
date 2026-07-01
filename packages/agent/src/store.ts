import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EventType } from '@light-agent/protocol/events';

import type { AgentEvent, TraceEvent } from '@light-agent/protocol/events';

/** Session persistence. */
export namespace Session {
	export type StoreConfig = {
		rootDir: string;
		sessionFile?: string;
		traceFile?: string;
		contextFile?: string;
	};
}

export interface SessionStoreInterface {
	load: (sessionId: string) => Promise<AgentEvent[]>;
	loadTraces: (sessionId: string) => Promise<TraceEvent[]>;
	append: (sessionId: string, event: AgentEvent) => Promise<void>;
	appendTrace: (sessionId: string, event: TraceEvent) => Promise<void>;
	appendContextSnap: (sessionId: string, record: Record<string, unknown>) => Promise<void>;
	flush: () => Promise<void>;
}

type AppendJob = {
	filePath: string;
	line: string;
	resolve: () => void;
	reject: (reason?: unknown) => void;
};

export default class SessionStore implements SessionStoreInterface {
	private rootDir: string;
	private sessionFile?: string;
	private traceFile?: string;
	private contextFile?: string;
	private isRunning = false;
	private queue: AppendJob[] = [];
	private flushWaiters: Array<{ resolve: () => void; reject: (reason?: unknown) => void }> = [];

	constructor(config: Session.StoreConfig) {
		this.rootDir = config.rootDir;
		this.sessionFile = config.sessionFile;
		this.traceFile = config.traceFile;
		this.contextFile = config.contextFile;
	}

	private getCanonicalFilePath(sessionId: string) {
		return this.sessionFile ?? path.join(this.rootDir, `${sessionId}.jsonl`);
	}

	private getTraceFilePath(sessionId: string) {
		return this.traceFile ?? path.join(this.rootDir, `${sessionId}.trace.jsonl`);
	}

	private getContextFilePath(sessionId: string) {
		return this.contextFile ?? path.join(this.rootDir, `${sessionId}.context.jsonl`);
	}

	private async readJsonl<T>(filePath: string): Promise<T[]> {
		try {
			const content = await readFile(filePath, 'utf-8');
			return content
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line) as T);
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	async load(sessionId: string): Promise<AgentEvent[]> {
		const events = await this.readJsonl<AgentEvent>(this.getCanonicalFilePath(sessionId));
		// 兼容旧版混写在一个 jsonl 里的 trace
		return events.filter((event) => event.type !== EventType.AGENT_TRACE);
	}

	async loadTraces(sessionId: string): Promise<TraceEvent[]> {
		const traceFileEvents = await this.readJsonl<TraceEvent>(this.getTraceFilePath(sessionId));
		if (traceFileEvents.length > 0) {
			return traceFileEvents;
		}

		const legacyEvents = await this.readJsonl<AgentEvent>(this.getCanonicalFilePath(sessionId));
		return legacyEvents.filter((event): event is TraceEvent => event.type === EventType.AGENT_TRACE);
	}

	private resolveFlushWaiters() {
		if (this.isRunning || this.queue.length > 0) {
			return;
		}

		for (const waiter of this.flushWaiters.splice(0)) {
			waiter.resolve();
		}
	}

	private async run() {
		const currentJob = this.queue.shift();
		if (!currentJob) {
			this.resolveFlushWaiters();
			return;
		}

		try {
			this.isRunning = true;
			await mkdir(this.rootDir, { recursive: true });
			await appendFile(currentJob.filePath, currentJob.line, 'utf-8');
			currentJob.resolve();
		} catch (error) {
			currentJob.reject(error);
			for (const waiter of this.flushWaiters.splice(0)) {
				waiter.reject(error);
			}
		} finally {
			this.isRunning = false;
			void this.run();
		}
	}

	private enqueueAppend(filePath: string, payload: unknown) {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.queue.push({
			filePath,
			line: `${JSON.stringify(payload)}\n`,
			resolve,
			reject,
		});

		if (!this.isRunning) {
			void this.run();
		}

		return promise;
	}

	async append(sessionId: string, event: AgentEvent): Promise<void> {
		return this.enqueueAppend(this.getCanonicalFilePath(sessionId), event);
	}

	async appendTrace(sessionId: string, event: TraceEvent): Promise<void> {
		return this.enqueueAppend(this.getTraceFilePath(sessionId), event);
	}

	async appendContextSnap(sessionId: string, record: Record<string, unknown>): Promise<void> {
		return this.enqueueAppend(this.getContextFilePath(sessionId), record);
	}

	async flush(): Promise<void> {
		if (!this.isRunning && this.queue.length === 0) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.flushWaiters.push({ resolve, reject });
		});
	}
}
