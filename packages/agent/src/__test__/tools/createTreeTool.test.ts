import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createTreeTool from '../../tools/createTreeTool.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-list-tree-'));
	const outside = await mkdtemp(join(tmpdir(), 'light-agent-list-tree-outside-'));
	await mkdir(join(root, 'packages', 'agent', 'src'), { recursive: true });
	await mkdir(join(root, 'packages', 'ai'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"name":"demo"}\n');
	await writeFile(join(root, 'packages', 'agent', 'src', 'agent.ts'), 'export class Agent {}\n');
	await writeFile(join(root, 'packages', 'ai', 'index.ts'), 'export const ai = true;\n');
	await writeFile(join(outside, 'secret.ts'), 'secret');
	await symlink(outside, join(root, 'outside-link'));
	return root;
}

describe('tree', () => {
	it('应基于 rg --files 输出项目文件树和文件大小', async () => {
		const cwd = await createWorkspace();
		const tool = createTreeTool();

		const result = await tool.execute({ path: '.', maxFiles: 20 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('## 项目文件树');
		expect(result.content).toContain('Path: `.`');
		expect(result.content).toContain('- packages');
		expect(result.content).toContain('  - agent');
		expect(result.content).toContain('    - src');
		expect(result.content).toContain('      - agent.ts | size: 22 bytes');
		expect(result.content).toContain('- package.json | size: 16 bytes');
	});

	it('应支持查看子目录文件树', async () => {
		const cwd = await createWorkspace();
		const tool = createTreeTool();

		const result = await tool.execute({ path: 'packages/agent', maxFiles: 20 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('Path: `packages/agent`');
		expect(result.content).toContain('- packages');
		expect(result.content).toContain('  - agent');
		expect(result.content).toContain('      - agent.ts | size: 22 bytes');
		expect(result.content).not.toContain('package.json');
	});

	it('应按 maxFiles 截断输出', async () => {
		const cwd = await createWorkspace();
		const tool = createTreeTool();

		const result = await tool.execute({ path: '.', maxFiles: 1 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('Files: 1');
		expect(result.content).toContain('> 文件数量超过上限，已截断。');
	});

	it('应拒绝 cwd 外路径', async () => {
		const cwd = await createWorkspace();
		const tool = createTreeTool();

		const result = await tool.execute({ path: '..', maxFiles: 20 }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不在当前工作目录内');
	});
});
