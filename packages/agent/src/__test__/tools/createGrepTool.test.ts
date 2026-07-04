import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createGrepTool from '../../tools/createGrepTool.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-grep-'));
	await mkdir(join(root, 'src'));
	await writeFile(join(root, 'src', 'app.ts'), ['const city = "上海";', 'console.log(city);'].join('\n'));
	await writeFile(join(root, 'README.md'), '没有匹配的说明');
	return root;
}

describe('grep', () => {
	it('应在 cwd 内搜索匹配内容', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				pattern: 'city',
				path: 'src',
				glob: '*.ts',
				ignoreCase: false,
				fixedStrings: true,
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('app.ts');
		expect(result.content).toContain('city');
	});

	it('未找到匹配时应返回可读结果', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				pattern: '不存在的内容',
				path: '.',
				ignoreCase: false,
				fixedStrings: true,
			},
			{ cwd },
		);

		expect(result).toEqual({ isError: false, content: '未找到匹配结果。' });
	});

	it('应拒绝 cwd 外路径', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				pattern: 'anything',
				path: '..',
				ignoreCase: false,
				fixedStrings: true,
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不在当前工作目录内');
	});
});
