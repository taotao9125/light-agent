import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createReadFileTool from '../../tools/createReadFileTool.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-read-file-'));
	const outside = await mkdtemp(join(tmpdir(), 'light-agent-read-file-outside-'));
	await mkdir(join(root, 'src'));
	await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\nexport const next = 2;\n');
	await writeFile(join(outside, 'secret.ts'), 'secret');
	await symlink(join(outside, 'secret.ts'), join(root, 'src', 'secret-link.ts'));
	return root;
}

function createLargeLineFile(lineCount: number) {
	return Array.from({ length: lineCount }, (_, index) => {
		const line = index + 1;
		return `line-${line} ${'x'.repeat(1000)}`;
	}).join('\n');
}

describe('read_file', () => {
	it('path only 应读取 cwd 内小文本文件完整内容', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/app.ts' }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[path]: src/app.ts');
		expect(result.content).toContain('[complete]: true');
		expect(result.content).toContain('1 | export const value = 1;');
		expect(result.content).toContain('2 | export const next = 2;');
	});

	it('小文件即使传入行号也应完整返回', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/app.ts', startLine: 2, endLine: 2 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[complete]: true');
		expect(result.content).toContain('1 | export const value = 1;');
		expect(result.content).toContain('2 | export const next = 2;');
	});

	it('无线索大文件应从第 1 行开始返回行窗口和 next', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'large.txt'), createLargeLineFile(160));

		const result = await tool.execute({ path: 'src/large.txt' }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[complete]: false');
		expect(result.content).toContain('[range]: 1-');
		expect(result.content).toContain('1 | line-1');
		expect(result.content).toContain('[next]: read_file({ path: "src/large.txt", startLine:');
		expect(result.content).toContain('[hint]: 如果要找具体符号、关键词或错误文本，请先用 grep 定位');
	});

	it('有 startLine 的大文件应从指定行开始返回窗口', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'large.txt'), createLargeLineFile(160));

		const result = await tool.execute({ path: 'src/large.txt', startLine: 50 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[range]: 50-');
		expect(result.content).toContain('50 | line-50');
		expect(result.content).not.toMatch(/^1 \| line-1/m);
	});

	it('有 startLine 和 endLine 的大文件应返回预算内明确范围', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'large.txt'), createLargeLineFile(160));

		const result = await tool.execute({ path: 'src/large.txt', startLine: 20, endLine: 22 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[range]: 20-22');
		expect(result.content).toContain('20 | line-20');
		expect(result.content).toContain('22 | line-22');
		expect(result.content).not.toContain('[next]:');
	});

	it('指定范围超过预算时应返回前一段并给下一次 startLine', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'large.txt'), createLargeLineFile(220));

		const result = await tool.execute({ path: 'src/large.txt', startLine: 10, endLine: 220 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[range]: 10-');
		expect(result.content).toContain('[next]: read_file({ path: "src/large.txt", startLine:');
		expect(result.content).toContain('endLine: 220');
	});

	it('超长单行应返回 byteOffset 续读参数', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'long-line.txt'), `head\n${'a'.repeat(130 * 1024)}\ntail\n`);

		const result = await tool.execute({ path: 'src/long-line.txt', startLine: 2, endLine: 2 }, { cwd });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[range]: 2-2');
		expect(result.content).toContain('[reason]: 当前行超过读取预算，已按 byteOffset 返回该行窗口。');
		expect(result.content).toContain(
			'[next]: read_file({ path: "src/long-line.txt", startLine: 2, endLine: 2, byteOffset: 102400 })',
		);
	});

	it('超长单行读完后应让 next 指向下一行', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'long-line.txt'), `head\n${'a'.repeat(130 * 1024)}\ntail\n`);

		const result = await tool.execute(
			{ path: 'src/long-line.txt', startLine: 2, endLine: 2, byteOffset: 102400 },
			{ cwd },
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('[reason]: 超长单行已读完，下一次会回到行读取模式。');
		expect(result.content).not.toContain('[next]:');
	});

	it('应拒绝 startLine 大于 endLine', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/app.ts', startLine: 3, endLine: 2 }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: read_file 行号范围无效');
	});

	it('应拒绝超出总行数的 startLine', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'large.txt'), createLargeLineFile(160));

		const result = await tool.execute({ path: 'src/large.txt', startLine: 200 }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: read_file startLine 超出文件总行数');
		expect(result.content).toContain('[total_lines]: 160');
	});

	it('应拒绝把 byteOffset 用于多行范围', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();

		const result = await tool.execute({ path: 'src/app.ts', startLine: 1, endLine: 2, byteOffset: 10 }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: read_file byteOffset 参数无效');
	});

	it('应拒绝超出当前行长度的 byteOffset', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'long-line.txt'), `head\n${'a'.repeat(130 * 1024)}\ntail\n`);

		const result = await tool.execute(
			{ path: 'src/long-line.txt', startLine: 2, endLine: 2, byteOffset: 200 * 1024 },
			{ cwd },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: read_file byteOffset 超出当前行长度');
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

	it('应拒绝二进制文件', async () => {
		const cwd = await createWorkspace();
		const tool = createReadFileTool();
		await writeFile(join(cwd, 'src', 'bin.dat'), Buffer.from([0x01, 0x00, 0x02]));

		const result = await tool.execute({ path: 'src/bin.dat' }, { cwd });

		expect(result.isError).toBe(true);
		expect(result.content).toContain('[what]: 目标文件看起来是二进制文件，read_file 当前暂不支持读取二进制文件');
	});
});
