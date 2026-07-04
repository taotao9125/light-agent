import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validatePathInCwd } from '../pathSafety.ts';
import { childSpawn } from './helper.ts';

import type { Tool } from '../tool.ts';

const rgBinaryPath = fileURLToPath(new URL('./rg', import.meta.url));
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_FILES = 300;
const MAX_FILES_LIMIT = 1_000;

const listProjectFilesTreeSchema = z.object({
	path: z.string().default('.').describe('要查看文件树的目录路径，必须在当前工作目录内。默认查看当前工作目录。'),
	maxFiles: z
		.number()
		.int()
		.min(1)
		.max(MAX_FILES_LIMIT)
		.default(DEFAULT_MAX_FILES)
		.describe('最多展示的文件数量。用于避免项目过大时输出过长。'),
});

type TreeNode = {
	name: string;
	path: string;
	type: 'directory' | 'file';
	size?: number;
	children: Map<string, TreeNode>;
};

function createDirectoryNode(name: string, nodePath: string): TreeNode {
	return {
		name,
		path: nodePath,
		type: 'directory',
		children: new Map(),
	};
}

function createFileNode(name: string, nodePath: string, size: number): TreeNode {
	return {
		name,
		path: nodePath,
		type: 'file',
		size,
		children: new Map(),
	};
}

function sortNodes(nodes: Iterable<TreeNode>) {
	return [...nodes].sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

function insertFile(root: TreeNode, filePath: string, size: number) {
	const parts = filePath.split('/').filter(Boolean);
	let current = root;

	for (const [index, part] of parts.entries()) {
		const nodePath = parts.slice(0, index + 1).join('/');
		const isFile = index === parts.length - 1;

		if (isFile) {
			current.children.set(part, createFileNode(part, nodePath, size));
			continue;
		}

		let child = current.children.get(part);
		if (!child) {
			child = createDirectoryNode(part, nodePath);
			current.children.set(part, child);
		}

		current = child;
	}
}

function buildTree(files: Array<{ path: string; size: number }>) {
	const root = createDirectoryNode('', '');

	for (const file of files) {
		insertFile(root, file.path, file.size);
	}

	return root;
}

function formatBytes(size: number) {
	return `${size} bytes`;
}

function formatTreeNode(node: TreeNode, depth: number, lines: string[]) {
	const indent = '  '.repeat(depth);

	if (node.type === 'file') {
		lines.push(`${indent}- ${node.name} | size: ${formatBytes(node.size ?? 0)}`);
		return;
	}

	if (node.name) {
		lines.push(`${indent}- ${node.name}`);
	}

	for (const child of sortNodes(node.children.values())) {
		formatTreeNode(child, node.name ? depth + 1 : depth, lines);
	}
}

function formatTree(input: { path: string; files: Array<{ path: string; size: number }>; truncated: boolean }) {
	const root = buildTree(input.files);
	const lines = ['## 项目文件树', '', `Path: \`${input.path}\``, `Files: ${input.files.length}`, ''];

	formatTreeNode(root, 0, lines);

	if (input.truncated) {
		lines.push('', `> 文件数量超过上限，已截断。请缩小 path 或提高 maxFiles 后重新查看。`);
	}

	return lines.join('\n');
}

function parseFiles(stdout: string) {
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

async function collectFileStats(cwd: string, filePaths: string[]) {
	const files: Array<{ path: string; size: number }> = [];

	for (const filePath of filePaths) {
		const fileStat = await stat(path.join(cwd, filePath));
		if (!fileStat.isFile()) continue;
		files.push({ path: filePath, size: fileStat.size });
	}

	return files;
}

function createListProjectFilesTreeTool(): Tool.Definition<typeof listProjectFilesTreeSchema> {
	return {
		name: 'list_project_files_tree',
		description:
			'查看当前工作目录内的项目文件树，用于探索项目结构、目录分层、包划分和关键文件位置。需要了解项目架构或不知道应该搜索什么关键词时，先使用这个工具；不要用 grep 浏览目录结构。',
		schema: listProjectFilesTreeSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 list_project_files_tree。' };
			}

			context.signal?.throwIfAborted();

			const safePath = await validatePathInCwd(context.cwd, args.path);
			if (!safePath.ok) {
				return { isError: true, content: safePath.content };
			}

			const searchPath = safePath.relativePath || '.';
			const result = await childSpawn({
				command: rgBinaryPath,
				args: ['--files', '--glob=!.git/*', '--color', 'never', searchPath],
				cwd: context.cwd,
				signal: context.signal,
				maxStdoutBytes: MAX_STDOUT_BYTES,
				maxStderrBytes: MAX_STDERR_BYTES,
			});

			if (result.aborted) {
				return { isError: true, content: 'list_project_files_tree 已取消。' };
			}

			if (result.timedOut) {
				return { isError: true, content: 'list_project_files_tree 执行超时，已终止。' };
			}

			if (result.code !== 0) {
				return {
					isError: true,
					content: result.stderr.trim() || `rg --files 执行失败，退出码：${result.code}`,
				};
			}

			const allPaths = parseFiles(result.stdout);
			const visiblePaths = allPaths.slice(0, args.maxFiles);
			const files = await collectFileStats(context.cwd, visiblePaths);

			if (!files.length) {
				return { isError: false, content: `## 项目文件树\n\nPath: \`${searchPath}\`\n\n未找到文件。` };
			}

			const content = formatTree({
				path: searchPath,
				files,
				truncated: result.stdoutTruncated || allPaths.length > visiblePaths.length,
			})

			console.log(content)


			return {
				isError: false,
				content
			};
		},
	};
}

export default createListProjectFilesTreeTool;
