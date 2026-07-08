import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventType } from '@light-agent/protocol/events';
import { afterEach, describe, expect, it } from 'vitest';
import FileSessionManager from '../session.ts';

describe('FileSessionManager', () => {
	let rootDir = '';

	afterEach(async () => {
		if (rootDir) {
			await fs.rm(rootDir, { recursive: true, force: true });
			rootDir = '';
		}
	});

	async function createManager() {
		rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-session-'));
		return new FileSessionManager({ rootDir });
	}

	it('应创建 session 并写入 metadata 索引', async () => {
		const manager = await createManager();

		const session = await manager.create({
			cwd: '/tmp/project-a',
			title: '分析项目架构',
			metadata: { source: 'test' },
		});

		const sessions = await manager.list();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: session.id,
			cwd: '/tmp/project-a',
			title: '分析项目架构',
			status: 'idle',
			metadata: { source: 'test' },
		});
	});

	it('空 metadata 索引应按空列表处理', async () => {
		const manager = await createManager();
		await fs.writeFile(path.join(rootDir, 'index.json'), '', 'utf-8');

		await expect(manager.list()).resolves.toEqual([]);
	});

	it('应按 cwd 打开最近活跃 session', async () => {
		const manager = await createManager();

		const first = await manager.create({ cwd: '/tmp/project-a', title: '旧任务' });
		const second = await manager.create({ cwd: '/tmp/project-a', title: '新任务' });
		await manager.create({ cwd: '/tmp/project-b', title: '其他项目' });
		await first.append({
			type: EventType.INPUT,
			text: '让旧任务变成最近',
			source: 'user',
			meta: { roundId: 'round-1', turn: 1 },
		});

		const latest = await manager.openLatest({ cwd: '/tmp/project-a' });

		expect(latest?.id).toBe(first.id);
		expect(second.id).not.toBe(first.id);
	});

	it('应更新 running 和 idle 状态', async () => {
		const manager = await createManager();
		const session = await manager.create({ cwd: '/tmp/project-a' });

		await manager.markRunning(session.id);
		expect((await manager.list())[0]?.status).toBe('running');

		await manager.markIdle(session.id);
		expect((await manager.list())[0]?.status).toBe('idle');
	});

	it('并发 append 时应串行更新 metadata 索引', async () => {
		const manager = await createManager();
		const session = await manager.create({ cwd: '/tmp/project-a' });

		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				session.append({
					type: EventType.INPUT,
					text: `输入 ${index}`,
					source: 'user',
					meta: { roundId: 'round-1', turn: index + 1 },
				}),
			),
		);

		const indexContent = await fs.readFile(path.join(rootDir, 'index.json'), 'utf-8');
		expect(() => JSON.parse(indexContent)).not.toThrow();
		expect(await session.load()).toHaveLength(20);
	});

	it('load 应返回与 Agent.canonicalEvents 一致的 summary 窗口', async () => {
		const manager = await createManager();
		const session = await manager.create({ cwd: '/tmp/project-a' });

		await session.append({
			type: EventType.INPUT,
			text: '第一轮输入',
			source: 'user',
			meta: { roundId: 'round-1', turn: 1 },
		});
		await session.append({
			type: EventType.OUTPUT,
			text: '第一轮输出',
			meta: { roundId: 'round-1', turn: 1 },
		});
		await session.append({
			type: EventType.INPUT,
			text: '第二轮输入',
			source: 'user',
			meta: { roundId: 'round-1', turn: 2 },
		});
		await session.append({
			type: EventType.AGENT_SUMMARY,
			text: '第一轮摘要',
			source: 'system',
			meta: {
				roundId: 'round-1',
				turn: 3,
				endRoundId: 'round-1',
				endTurn: 1,
			},
		});

		await expect(session.load()).resolves.toMatchObject([
			{
				type: EventType.AGENT_SUMMARY,
				text: '第一轮摘要',
			},
			{
				type: EventType.INPUT,
				text: '第二轮输入',
			},
		]);
	});
});
