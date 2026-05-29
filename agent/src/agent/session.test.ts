import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventType } from '../protocol/events';
import type { AgentLoopInterface } from './agentLoop';
import type { AgentEvent, SessionEvent } from './session';
import AgentSession from './session';
import SessionStore from './store';

const meta = { roundId: 'round-1', turn: 1 };

function createMockAgentLoop(): AgentLoopInterface & {
	emit: (event: AgentEvent) => void;
	setPromptHandler: (handler: AgentLoopInterface['prompt']) => void;
} {
	const listeners: Array<(event: AgentEvent) => void> = [];
	let promptHandler: AgentLoopInterface['prompt'] = async () => {};

	return {
		on(listener) {
			listeners.push(listener);
		},
		getCurrentPromptLog: () => [],
		prompt(prompt, options) {
			return promptHandler(prompt, options);
		},
		emit(event) {
			for (const listener of listeners) {
				listener(event);
			}
		},
		setPromptHandler(handler) {
			promptHandler = handler;
		},
	};
}

function collectSessionEvents(session: AgentSession): SessionEvent[] {
	const events: SessionEvent[] = [];
	session.on((event) => events.push(event));
	return events;
}

describe('AgentSession', () => {
	let tmpDir: string;

	afterEach(async () => {
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	async function createSession(loop: ReturnType<typeof createMockAgentLoop>, withStore = false) {
		tmpDir = await mkdtemp(join(tmpdir(), 'agent-session-'));
		return new AgentSession({
			sessionId: 'test-session',
			agentLoop: loop,
			store: withStore ? new SessionStore({ rootDir: tmpDir }) : undefined,
		});
	}

	it('将 INPUT 投影为 agent_start 与 input', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const events = collectSessionEvents(session);

		loop.setPromptHandler(async () => {
			loop.emit({
				type: EventType.INPUT,
				text: 'hi',
				source: 'user',
				meta,
			});
		});

		await session.prompt('hi');

		expect(events).toContainEqual({ type: 'agent_start', meta });
		expect(events).toContainEqual({
			type: 'input',
			text: 'hi',
			source: 'user',
			meta,
		});
	});

	it('首次 THOUGHT_DELTA 带 meta 会先发出 thought_start', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const events = collectSessionEvents(session);

		loop.setPromptHandler(async () => {
			loop.emit({
				type: EventType.THOUGHT_DELTA,
				text: 'thinking',
				meta,
			});
			loop.emit({ type: EventType.THOUGHT, text: 'thinking', meta });
		});

		await session.prompt('q');

		const thoughtStartIndex = events.findIndex((e) => e.type === 'thought_start');
		const thoughtDeltaIndex = events.findIndex((e) => e.type === 'thought_delta');
		expect(thoughtStartIndex).toBeGreaterThanOrEqual(0);
		expect(thoughtDeltaIndex).toBeGreaterThan(thoughtStartIndex);
		expect(events).toContainEqual({
			type: 'thought_done',
			text: 'thinking',
			meta,
		});
	});

	it('提交 INPUT/THOUGHT/OUTPUT 等到 event log 与 store', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop, true);
		const input = {
			type: EventType.INPUT,
			text: 'persist',
			meta: { roundId: 'r2', turn: 0 },
		};
		const output = {
			type: EventType.OUTPUT,
			text: 'answer',
			meta: { roundId: 'r2', turn: 1 },
		};

		loop.setPromptHandler(async () => {
			loop.emit(input);
			loop.emit(output);
		});

		await session.prompt('persist');

		expect(session.getEventLog()).toEqual([input, output]);

		const store = new SessionStore({ rootDir: tmpDir });
		await vi.waitFor(async () => {
			const persisted = await store.load('test-session');
			expect(persisted).toHaveLength(2);
			expect(persisted).toEqual(expect.arrayContaining([input, output]));
		});
	});

	it('prompt 完成后发出 agent_done', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const events = collectSessionEvents(session);

		loop.setPromptHandler(async () => {});

		await session.prompt('done');

		expect(events.at(-1)).toEqual({ type: 'agent_done' });
	});

	it('interrupt 会中止当前任务并发出 agent_aborted', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const events = collectSessionEvents(session);

		loop.setPromptHandler(async (_prompt, options) => {
			await new Promise<void>((_resolve, reject) => {
				options?.abortSignal?.addEventListener(
					'abort',
					() => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					},
					{ once: true },
				);
			});
		});

		const pending = session.prompt('block');
		await vi.waitFor(() => expect(session.getState().isRunning).toBe(true));
		session.interrupt('user stop');
		await pending;

		expect(events).toContainEqual({
			type: 'agent_aborted',
			reason: 'user stop',
		});
	});

	it('顺序执行队列中的多个 prompt', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const order: string[] = [];

		loop.setPromptHandler(async (prompt) => {
			order.push(prompt);
		});

		await Promise.all([session.prompt('first'), session.prompt('second')]);

		expect(order).toEqual(['first', 'second']);
	});

	it('AGENT_ERROR 投影为 agent_error 并清空活跃 turn 状态', async () => {
		const loop = createMockAgentLoop();
		const session = await createSession(loop);
		const events = collectSessionEvents(session);

		loop.setPromptHandler(async () => {
			loop.emit({ type: EventType.THOUGHT_DELTA, text: 'x', meta });
			loop.emit({
				type: EventType.AGENT_ERROR,
				message: 'boom',
				meta,
			});
			loop.emit({ type: EventType.THOUGHT_DELTA, text: 'y', meta });
		});

		await session.prompt('err');

		expect(events).toContainEqual({
			type: 'agent_error',
			message: 'boom',
			meta,
		});
		const deltasAfterError = events.filter((e) => e.type === 'thought_delta' && e.text === 'y');
		expect(deltasAfterError).toHaveLength(1);
		expect(events.filter((e) => e.type === 'thought_start')).toHaveLength(2);
	});
});
