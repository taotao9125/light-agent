import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validatePathInCwd } from '../pathSafety.ts';

import type { Tool } from '../tool.ts';

const rgBinaryPath = fileURLToPath(new URL('./rg', import.meta.url));
const MAX_OUTPUT_LENGTH = 20_000;

const grepSchema = z.object({
	pattern: z.string().min(1).describe('要搜索的文本或正则表达式。'),
	path: z.string().default('.').describe('要搜索的文件或目录路径，必须在当前工作目录内。'),
	glob: z.string().optional().describe('可选 glob 过滤，例如 "*.ts" 或 "src/**/*.ts"。'),
	ignoreCase: z.boolean().default(false).describe('是否忽略大小写。'),
	fixedStrings: z.boolean().default(false).describe('是否按普通字符串搜索，而不是正则表达式。'),
});

function runRg(args: string[], cwd: string, signal?: AbortSignal) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(rgBinaryPath, args, {
			cwd,
			signal,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', (chunk: string) => {
			if (stdout.length < MAX_OUTPUT_LENGTH) {
				stdout += chunk;
			}
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			resolve({ code, stdout, stderr });
		});
	});
}

function createGrepTool(): Tool.Definition<typeof grepSchema> {
	return {
		name: 'grep',
		description: '在当前工作目录内搜索文件内容。基于内置 rg 执行，支持正则、大小写选项和 glob 过滤。',
		schema: grepSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 grep。' };
			}

			context.signal?.throwIfAborted();

			const safePath = await validatePathInCwd(context.cwd, args.path);
			if (!safePath.ok) {
				return { isError: true, content: safePath.content };
			}

			const rgArgs = ['--line-number', '--column', '--color', 'never'];
			if (args.ignoreCase) rgArgs.push('--ignore-case');
			if (args.fixedStrings) rgArgs.push('--fixed-strings');
			if (args.glob) rgArgs.push('--glob', args.glob);
			rgArgs.push('--', args.pattern, safePath.path);

			const result = await runRg(rgArgs, context.cwd, context.signal);

			if (result.code === 0) {
				const truncated = result.stdout.length >= MAX_OUTPUT_LENGTH ? '\n[truncated]: 输出过长，已截断。' : '';
				return { isError: false, content: result.stdout.trimEnd() + truncated };
			}

			if (result.code === 1) {
				return { isError: false, content: '未找到匹配结果。' };
			}

			return {
				isError: true,
				content: result.stderr.trim() || `rg 执行失败，退出码：${result.code}`,
			};
		},
	};
}

export default createGrepTool;
