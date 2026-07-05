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
	it('应清晰描述 grep 只用于定位已知线索', () => {
		const tool = createGrepTool();

		expect(tool.description).toContain('搜索一个已知字符串或正则表达式');
		expect(tool.description).toContain('grep 只有一个参数 searchStr');
		expect(tool.description).toContain('不接收 path/glob/ignoreCase/fixedStrings');
		expect(tool.schema.shape.searchStr.description).toContain('要搜索的具体字符串或正则表达式');
		expect(tool.schema.shape.searchStr.description).toContain('不要传目录路径、文件路径');
	});

	it('应在 cwd 内搜索匹配内容', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStr: 'city',
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('## grep 匹配结果');
		expect(result.content).toContain('Searched for `city`.');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('  const city = "上海";');
	});

	it('应拒绝把泛匹配或目录文件路径当作 searchStr', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const dotResult = await tool.execute(
			{
				searchStr: '.',
			},
			{ cwd },
		);
		const pathResult = await tool.execute(
			{
				searchStr: 'packages/agent/src/agent.ts',
			},
			{ cwd },
		);

		expect(dotResult.isError).toBe(true);
		expect(dotResult.content).toContain('[what]: grep searchStr 无效');
		expect(dotResult.content).toContain('[bad]: grep({ searchStr: "." })');
		expect(pathResult.isError).toBe(true);
		expect(pathResult.content).toContain('[bad]: grep({ searchStr: "packages/agent" })');
		expect(pathResult.content).toContain(
			'[good]: grep({ searchStr: "Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id" })',
		);
	});

	it('未找到匹配时应返回可读结果', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStr: '不存在的内容',
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
				searchStr: '../outside',
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: grep searchStr 无效');
	});
});
