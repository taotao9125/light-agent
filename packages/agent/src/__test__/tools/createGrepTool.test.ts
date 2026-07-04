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

		expect(tool.description).toContain('只有当你已经知道要搜索的具体字符串或正则时才使用 grep');
		expect(tool.description).toContain('不要用 grep 浏览项目');
		expect(tool.description).toContain('Searched for Tool_Calls|Tool_Results');
		expect(tool.schema.shape.pattern.description).toContain('要定位的具体关键词、符号名、函数名');
		expect(tool.schema.shape.pattern.description).toContain('pattern 是要搜索的内容，不是目录路径');
		expect(tool.schema.shape.pattern.description).toContain('不要传 "."、"./packages"、".*"');
		expect(tool.schema.shape.path.description).toContain('已知大致目录时应优先缩小到具体目录');
		expect(tool.schema.shape.glob.description).toContain('已知文件类型时应填写');
	});

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
		expect(result.content).toContain('## grep 匹配结果');
		expect(result.content).toContain('Searched for `city` in `src`.');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('  const city = "上海";');
	});

	it('应拒绝把泛匹配或目录路径当作 pattern', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const dotResult = await tool.execute(
			{
				pattern: '.',
				path: '.',
				ignoreCase: false,
				fixedStrings: false,
			},
			{ cwd },
		);
		const pathResult = await tool.execute(
			{
				pattern: './packages',
				path: '.',
				ignoreCase: false,
				fixedStrings: false,
			},
			{ cwd },
		);

		expect(dotResult.isError).toBe(true);
		expect(dotResult.content).toContain('[what]: grep pattern 无效');
		expect(dotResult.content).toContain('[bad]: grep({ pattern: ".", path: "." })');
		expect(pathResult.isError).toBe(true);
		expect(pathResult.content).toContain('[bad]: grep({ pattern: "./packages", path: "." })');
		expect(pathResult.content).toContain(
			'[good]: grep({ pattern: "Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id", path: "packages" })',
		);
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
