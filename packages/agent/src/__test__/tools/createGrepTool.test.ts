import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createGrepTool from '../../tools/createGrepTool.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-grep-'));
	await mkdir(join(root, 'src'));
	await mkdir(join(root, 'docs'));
	await writeFile(join(root, 'src', 'app.ts'), ['const city = "上海";', 'console.log(city);'].join('\n'));
	await writeFile(join(root, 'src', 'agent.ts'), ['export class Agent {}', 'const city = "北京";'].join('\n'));
	await writeFile(join(root, 'docs', 'guide.md'), ['city 指南', 'Tool_Result 说明'].join('\n'));
	await writeFile(join(root, 'README.md'), '没有匹配的说明');
	return root;
}

describe('grep', () => {
	it('应清晰描述 grep 只用于定位已知线索', () => {
		const tool = createGrepTool();

		expect(tool.description).toContain('搜索一个或多个已知普通字符串');
		expect(tool.description).toContain('searchStrs 是固定字符串数组');
		expect(tool.description).toContain('scope 是可选目录范围');
		expect(tool.description).toContain('不要写正则');
		expect(tool.schema.shape.searchStrs.description).toContain('要搜索的固定字符串列表');
		expect(tool.schema.shape.searchStrs.element.description).toContain('要搜索的具体普通字符串');
		expect(tool.schema.shape.scope.description).toContain('可选搜索目录');
		expect(tool.schema.shape.scope.description).toContain('不要传文件路径');
	});

	it('应在 cwd 内搜索匹配内容', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('## grep 匹配结果');
		expect(result.content).toContain('Searched for:');
		expect(result.content).toContain('- `city`');
		expect(result.content).toContain('Scope: `.`');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('  const city = "上海";');
	});

	it('应支持多个字符串搜索并合并结果', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city', 'Tool_Result'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('- `city`');
		expect(result.content).toContain('- `Tool_Result`');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('- src/agent.ts:2');
		expect(result.content).toContain('- docs/guide.md:2');
	});

	it('多个关键词命中同一行时不应重复输出同一行', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['const', 'city'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content.match(/src\/app\.ts:1/g)).toHaveLength(1);
		expect(result.content.match(/src\/agent\.ts:2/g)).toHaveLength(1);
	});

	it('scope 为目录时应只在该目录内搜索', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city'],
				scope: 'src',
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('Scope: `src`');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('- src/agent.ts:2');
		expect(result.content).not.toContain('docs/guide.md');
	});

	it('应在部分 searchStrs 无效时继续搜索有效字符串，并告知跳过项', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city', '.', 'packages/agent/src/agent.ts'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('- `city`');
		expect(result.content).not.toContain('- `.`');
		expect(result.content).toContain('- src/app.ts:1');
		expect(result.content).toContain('[skipped_invalid_searchStrs]:');
		expect(result.content).toContain('- .');
		expect(result.content).toContain('- packages/agent/src/agent.ts');
		expect(result.content).toContain('grep 没有搜索它们');
	});

	it('全部 searchStrs 无效时应返回错误', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['.', 'packages/agent/src/agent.ts'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: grep searchStrs 全部无效');
		expect(result.content).toContain('[invalid_searchStrs]:');
		expect(result.content).toContain('- .');
		expect(result.content).toContain('- packages/agent/src/agent.ts');
		expect(result.content).toContain('[bad]: grep({ searchStrs: ["."] })');
		expect(result.content).toContain('[good]: grep({ searchStrs: ["Tool_Calls"] })');
	});

	it('应把正则样式输入当作固定字符串处理', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['class .* (extends|implements|{)'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('未找到匹配结果。');
		expect(result.content).toContain('- `class .* (extends|implements|{)`');
	});

	it('未找到匹配时应返回可读结果', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['不存在的内容'],
			},
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('未找到匹配结果。');
		expect(result.content).toContain('- `不存在的内容`');
	});

	it('scope 为文件时应返回错误并提示使用 read_file', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city'],
				scope: 'src/app.ts',
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: grep scope 无效');
		expect(result.content).toContain('不支持文件路径');
		expect(result.content).toContain('read_file');
	});

	it('scope 路径不存在时应返回可解释错误', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city'],
				scope: 'missing',
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不存在');
	});

	it('应拒绝 cwd 外路径', async () => {
		const cwd = await createWorkspace();
		const tool = createGrepTool();

		const result = await tool.execute(
			{
				searchStrs: ['city'],
				scope: '..',
			},
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 你传入的路径不在当前工作目录内');
	});
});
