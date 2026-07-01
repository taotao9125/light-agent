import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventType } from '@light-agent/protocol/events';
import { afterEach, describe, expect, it } from 'vitest';
import SessionStore from '../store.ts';

describe('SessionStore', () => {
	let rootDir = '';

	afterEach(async () => {
		if (rootDir) {
			await fs.rm(rootDir, { recursive: true, force: true });
		}
	});

	it('canonical 与 trace 应写入不同文件', async () => {
		rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
		const store = new SessionStore({ rootDir });
		const sessionId = 'eval-run-1';

		await store.append(sessionId, {
			type: EventType.INPUT,
			text: 'hello',
			source: 'user',
			meta: { roundId: 'round-1', turn: 1 },
		});

		await store.appendTrace(sessionId, {
			type: EventType.AGENT_TRACE,
			costs: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			startAt: 1,
			endAt: 2,
			model: 'test-model',
			meta: { roundId: 'round-1', turn: 1 },
		});

		await store.append(sessionId, {
			type: EventType.AGENT_STOP,
			cause: 'llm',
			message: 'terminated',
			meta: { roundId: 'round-1', turn: 1 },
		});

		await store.append(sessionId, {
			type: EventType.AGENT_SUMMARY,
			text: 'compressed history summary',
			source: 'system',
			meta: {
				roundId: 'round-1',
				turn: 3,
				endRoundId: 'round-1',
				endTurn: 1,
			},
		});

		const canonical = await store.load(sessionId);
		const traces = await store.loadTraces(sessionId);

		expect(canonical).toHaveLength(3);
		expect(canonical[0]?.type).toBe(EventType.INPUT);
		expect(canonical[1]?.type).toBe(EventType.AGENT_STOP);
		expect(canonical[2]?.type).toBe(EventType.AGENT_SUMMARY);
		expect(traces).toHaveLength(1);
		expect(traces[0]?.costs.totalTokens).toBe(15);

		await expect(fs.readFile(path.join(rootDir, `${sessionId}.jsonl`), 'utf-8')).resolves.toContain('"input"');
		await expect(fs.readFile(path.join(rootDir, `${sessionId}.trace.jsonl`), 'utf-8')).resolves.toContain(
			'"agent_trace"',
		);
	});

	it('supports explicit session/trace file paths', async () => {
		const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
		const sessionFile = path.join(rootDir, 'custom-session.jsonl');
		const traceFile = path.join(rootDir, 'custom-trace.jsonl');
		const contextFile = path.join(rootDir, 'custom-context.jsonl');
		const store = new SessionStore({ rootDir, sessionFile, traceFile, contextFile });
		const sessionId = 'ignored-id';

		await store.append(sessionId, {
			type: EventType.INPUT,
			text: 'hello',
			source: 'user',
			meta: { roundId: 'r1', turn: 1 },
		});
		await store.appendTrace(sessionId, {
			type: EventType.AGENT_TRACE,
			startAt: 1,
			endAt: 2,
			model: 'test-model',
			costs: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		});
		await store.appendContextSnap(sessionId, {
			kind: 'context_snap',
			at: 1,
			strategyEnabled: true,
		});
		await store.flush();

		await expect(fs.readFile(sessionFile, 'utf-8')).resolves.toContain('"input"');
		await expect(fs.readFile(traceFile, 'utf-8')).resolves.toContain('"agent_trace"');
		await expect(fs.readFile(contextFile, 'utf-8')).resolves.toContain('"kind":"context_snap"');
	});

	it('flush 应等待队列中的 append 全部落盘', async () => {
		rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-flush-'));
		const store = new SessionStore({ rootDir });
		const sessionId = 'flush-test';

		const pending = Promise.all([
			store.append(sessionId, {
				type: EventType.INPUT,
				text: 'one',
				source: 'user',
				meta: { roundId: 'round-1', turn: 1 },
			}),
			store.append(sessionId, {
				type: EventType.OUTPUT,
				text: 'two',
				meta: { roundId: 'round-1', turn: 1 },
			}),
		]);

		const flushPromise = store.flush();
		await pending;
		await flushPromise;

		const canonical = await store.load(sessionId);
		expect(canonical).toHaveLength(2);
	});
});
