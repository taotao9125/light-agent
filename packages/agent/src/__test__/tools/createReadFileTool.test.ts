import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createReadFileTool from '../../tools/createReadFileTool.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-read-file-'));
	const outside = await mkdtemp(join(tmpdir(), 'light-agent-read-file-outside-'));
	await mkdir(join(root, 'src'));
	await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\n');
	await writeFile(join(outside, 'secret.ts'), 'secret');
	await symlink(join(outside, 'secret.ts'), join(root, 'src', 'secret-link.ts'));
	return root;
}

describe('read_file', () => {
	it('应读取 cwd 内文本文件', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/app.ts' }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('path: src/app.ts');
		expect(result.content).toContain('export const value = 1;');
	});

	it('大文件应只读取前缀并标记截断', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		const largeContent = `${'a'.repeat(300_000)}TAIL_SHOULD_NOT_BE_READ`;
		await writeFile(join(cwd, 'src', 'large.txt'), largeContent);

		const result = await tool.execute({ path: 'src/large.txt' }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('size_bytes:');
		expect(result.content).toContain('read_bytes: 262144');
		expect(result.content).toContain('[truncated]: 文件内容过长，已截断。');
		expect(result.content).not.toContain('TAIL_SHOULD_NOT_BE_READ');
	});

	it('应拒绝读取目录', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src' }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的是目录');
	});

	it('应拒绝 symlink 路径逃逸', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/secret-link.ts' }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不在当前工作目录内');
	});

	it('应返回不存在路径的可读错误', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'missing.ts' }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不存在');
	});
});
