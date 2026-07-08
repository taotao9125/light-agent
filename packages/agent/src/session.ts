import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventType } from '@light-agent/protocol/events';

import type { AgentEvent, SummaryEvent } from '@light-agent/protocol/events';

export type SessionStatus = 'idle' | 'running';

export interface SessionMetadata {
	/** session 唯一标识，用于 open/remove。 */
	id: string;
	/** session 所属工作目录，用于按项目过滤和恢复 cwd。 */
	cwd: string;
	/** 给人看的标题，用于历史列表/窗口列表展示。 */
	title?: string;
	createdAt: string;
	updatedAt: string;
	status: SessionStatus;
	/** 宿主层扩展信息，不承载核心 agent 语义。 */
	metadata?: Record<string, unknown>;
}

/**
 * 单个 agent session。
 */
export interface AgentSession {
	/** 当前 session 的稳定 id。 */
	readonly id: string;
	append(event: AgentEvent): Promise<void>;
	/**
	 * 加载当前 session 的内存窗口。
	 *
	 * 语义应与 Agent 当前 canonicalEvents 保持一致：
	 * - 如果已有 summary，返回 [latestSummaryEvent, ...summary 边界之后的 events]。
	 * - 如果没有 summary，返回当前实现允许保留的 events。
	 * - 返回值可以直接赋给 Agent.canonicalEvents。
	 */
	load(): Promise<AgentEvent[]>;
}

/**
 * Session 生命周期管理器。
 *
 * 定位：
 * - CLI/App/宿主层使用。
 * - Agent 不应该依赖 SessionManager。
 * - 负责 create/open/list/remove/status 等产品层行为。
 */
export interface SessionManager {
	create(input: { cwd: string; title?: string; metadata?: Record<string, unknown> }): Promise<AgentSession>;
	/**
	 * 打开已有 session。
	 *
	 * open 只返回 session 句柄，不代表加载完整历史。
	 * 真正恢复给 Agent 的内存窗口由 session.load() 决定。
	 */
	open(sessionId: string): Promise<AgentSession>;
	/** 打开某个 cwd 下最近活跃的 session，用于 resume/continue。 */
	openLatest(input?: { cwd?: string }): Promise<AgentSession | undefined>;
	/** 列出 session 元信息，用于窗口列表/历史任务列表。 */
	list(input?: { cwd?: string; limit?: number }): Promise<SessionMetadata[]>;
	/** 标记 session 正在运行。调用方应在 agent.prompt 前调用。 */
	markRunning(sessionId: string): Promise<void>;
	/** 标记 session 运行结束。调用方应在 finally 中调用。 */
	markIdle(sessionId: string): Promise<void>;
}

export namespace FileSession {
	export type Config = {
		rootDir: string;
	};
}

type AppendJob = {
	event: AgentEvent;
	resolve: () => void;
	reject: (reason?: unknown) => void;
};

function randomId() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function sortByUpdatedAtDesc(items: SessionMetadata[]) {
	return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
	try {
		const content = await readFile(filePath, 'utf-8');
		if (!content.trim()) return fallback;
		return JSON.parse(content) as T;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return fallback;
		}
		throw error;
	}
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
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

function pruneEventsByLatestSummary(events: AgentEvent[]) {
	const latestSummaryEvent = events.findLast((event) => event.type === EventType.AGENT_SUMMARY);
	if (!latestSummaryEvent) return events;

	return pruneEventsAfterSummary(events, latestSummaryEvent);
}

function pruneEventsAfterSummary(events: AgentEvent[], summaryEvent: SummaryEvent) {
	const endRoundId = summaryEvent.meta?.endRoundId;
	const endTurn = summaryEvent.meta?.endTurn;

	if (!endRoundId || typeof endTurn !== 'number') return events;

	const endEventIndex = events.findLastIndex(
		(event) => event.meta?.roundId === endRoundId && event.meta?.turn === endTurn,
	);

	if (endEventIndex === -1) return events;

	const eventsAfterSummaryBoundary = events
		.slice(endEventIndex + 1)
		.filter((event) => event.type !== EventType.AGENT_SUMMARY);

	return [summaryEvent, ...eventsAfterSummaryBoundary];
}

export class FileAgentSession implements AgentSession {
	readonly id: string;

	private eventsFile: string;
	private isRunning = false;
	private queue: AppendJob[] = [];
	private onAppend: () => Promise<void>;

	constructor(config: { id: string; eventsFile: string; onAppend?: () => Promise<void> }) {
		this.id = config.id;
		this.eventsFile = config.eventsFile;
		this.onAppend = config.onAppend ?? (async () => {});
	}

	async append(event: AgentEvent): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.queue.push({ event, resolve, reject });

		if (!this.isRunning) {
			void this.runAppendQueue();
		}

		return promise;
	}

	async load(): Promise<AgentEvent[]> {
		return pruneEventsByLatestSummary(await readJsonl<AgentEvent>(this.eventsFile));
	}

	private async runAppendQueue() {
		const currentJob = this.queue.shift();
		if (!currentJob) return;

		try {
			this.isRunning = true;
			await mkdir(path.dirname(this.eventsFile), { recursive: true });
			await appendFile(this.eventsFile, `${JSON.stringify(currentJob.event)}\n`, 'utf-8');
			await this.onAppend();
			currentJob.resolve();
		} catch (error) {
			currentJob.reject(error);
		} finally {
			this.isRunning = false;
			void this.runAppendQueue();
		}
	}
}

export default class FileSessionManager implements SessionManager {
	private rootDir: string;
	private indexFile: string;
	private indexQueue: Promise<void> = Promise.resolve();

	constructor(config: FileSession.Config) {
		this.rootDir = config.rootDir;
		this.indexFile = path.join(this.rootDir, 'index.json');
	}

	async create(input: { cwd: string; title?: string; metadata?: Record<string, unknown> }): Promise<AgentSession> {
		const now = new Date().toISOString();
		const session: SessionMetadata = {
			id: `sess_${randomId()}`,
			cwd: input.cwd,
			title: input.title,
			createdAt: now,
			updatedAt: now,
			status: 'idle',
			metadata: input.metadata,
		};

		await this.updateIndex((sessions) => [...this.removeSessionFromIndex(sessions, session.id), session]);
		return this.createAgentSession(session.id);
	}

	async open(sessionId: string): Promise<AgentSession> {
		await this.mustGetSession(sessionId);
		return this.createAgentSession(sessionId);
	}

	async openLatest(input?: { cwd?: string }): Promise<AgentSession | undefined> {
		const latest = (await this.list({ cwd: input?.cwd, limit: 1 }))[0];
		if (!latest) return undefined;
		return this.createAgentSession(latest.id);
	}

	async list(input?: { cwd?: string; limit?: number }): Promise<SessionMetadata[]> {
		let sessions = await this.readIndex();

		if (input?.cwd) {
			sessions = sessions.filter((session) => session.cwd === input.cwd);
		}

		const sortedSessions = sortByUpdatedAtDesc(sessions);
		return typeof input?.limit === 'number' ? sortedSessions.slice(0, input.limit) : sortedSessions;
	}

	async markRunning(sessionId: string): Promise<void> {
		await this.updateSession(sessionId, { status: 'running', updatedAt: new Date().toISOString() });
	}

	async markIdle(sessionId: string): Promise<void> {
		await this.updateSession(sessionId, { status: 'idle', updatedAt: new Date().toISOString() });
	}

	private createAgentSession(sessionId: string) {
		return new FileAgentSession({
			id: sessionId,
			eventsFile: this.getEventsFile(sessionId),
			onAppend: () => this.touchSession(sessionId),
		});
	}

	private async readIndex() {
		return readJsonFile<SessionMetadata[]>(this.indexFile, []);
	}

	private async writeIndex(sessions: SessionMetadata[]) {
		await mkdir(this.rootDir, { recursive: true });
		const tempFile = `${this.indexFile}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(tempFile, `${JSON.stringify(sortByUpdatedAtDesc(sessions), null, 2)}\n`, 'utf-8');
		await rename(tempFile, this.indexFile);
	}

	private async updateIndex(update: (sessions: SessionMetadata[]) => SessionMetadata[]) {
		const run = async () => {
			const sessions = await this.readIndex();
			await this.writeIndex(update(sessions));
		};

		const next = this.indexQueue.then(run, run);
		this.indexQueue = next.catch(() => {});
		return next;
	}

	private removeSessionFromIndex(sessions: SessionMetadata[], sessionId: string) {
		return sessions.filter((session) => session.id !== sessionId);
	}

	private async mustGetSession(sessionId: string) {
		const session = (await this.readIndex()).find((item) => item.id === sessionId);
		if (!session) {
			throw new Error(`session 不存在: ${sessionId}`);
		}
		return session;
	}

	private async updateSession(sessionId: string, patch: Partial<SessionMetadata>) {
		await this.updateIndex((sessions) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) {
				throw new Error(`session 不存在: ${sessionId}`);
			}

			return [...this.removeSessionFromIndex(sessions, sessionId), { ...session, ...patch }];
		});
	}

	private async touchSession(sessionId: string) {
		await this.updateSession(sessionId, { updatedAt: new Date().toISOString() });
	}

	private getSessionDir(sessionId: string) {
		return path.join(this.rootDir, sessionId);
	}

	private getEventsFile(sessionId: string) {
		return path.join(this.getSessionDir(sessionId), 'events.jsonl');
	}
}
