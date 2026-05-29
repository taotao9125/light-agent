import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventType } from '../protocol/events';
import SessionStore from './store';

describe('SessionStore', () => {
	let rootDir: string;

	afterEach(async () => {
		if (rootDir) {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	async function createStore() {
		rootDir = await mkdtemp(join(tmpdir(), 'agent-store-'));
		return new SessionStore({ rootDir });
	}

	it('append 写入一行 JSONL，load 能读回', async () => {
		const store = await createStore();
		const event = {
			type: EventType.INPUT,
			text: 'hello',
			source: 'user' as const,
			meta: { roundId: 'r1', turn: 0 },
		};

		await store.append('sess-1', event);
		const loaded = await store.load('sess-1');

		expect(loaded).toEqual([event]);
	});

	it('多次 append 按顺序累积', async () => {
		const store = await createStore();
		const first = {
			type: EventType.INPUT,
			text: 'a',
			meta: { roundId: 'r1', turn: 0 },
		};
		const second = {
			type: EventType.OUTPUT,
			text: 'b',
			meta: { roundId: 'r1', turn: 1 },
		};

		await store.append('sess-2', first);
		await store.append('sess-2', second);

		expect(await store.load('sess-2')).toEqual([first, second]);
	});

	it('不同 sessionId 写入独立文件', async () => {
		const store = await createStore();
		const eventA = { type: EventType.INPUT, text: 'a' };
		const eventB = { type: EventType.INPUT, text: 'b' };

		await store.append('a', eventA);
		await store.append('b', eventB);

		expect(await store.load('a')).toEqual([eventA]);
		expect(await store.load('b')).toEqual([eventB]);
	});

	it('load 在文件不存在时抛出', async () => {
		const store = await createStore();
		await expect(store.load('missing')).rejects.toThrow();
	});

	it('append 会自动创建 rootDir', async () => {
		const store = await createStore();
		await store.append('new', { type: EventType.INPUT, text: 'x' });

		const raw = await readFile(join(rootDir, 'new.jsonl'), 'utf-8');
		expect(raw).toContain('"text":"x"');
	});
});
