import { open, readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { validatePathInCwd } from '../pathSafety.ts';

import type { Tool } from '../tool.ts';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILE_CHARS = 30_000;

const readFileSchema = z.object({
	path: z.string().min(1).describe('要读取的文件路径，必须在当前工作目录内。'),
});

async function readTextPreview(filePath: string, fileSize: number) {
	if (fileSize <= MAX_FILE_BYTES) {
		return {
			content: await readFile(filePath, 'utf8'),
			bytesRead: fileSize,
			truncatedByBytes: false,
		};
	}

	const file = await open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(MAX_FILE_BYTES);
		const { bytesRead } = await file.read(buffer, 0, MAX_FILE_BYTES, 0);
		return {
			content: buffer.subarray(0, bytesRead).toString('utf8'),
			bytesRead,
			truncatedByBytes: true,
		};
	} finally {
		await file.close();
	}
}

function createReadFileTool(): Tool.Definition<typeof readFileSchema> {
	return {
		name: 'read_file',
		description: '读取当前工作目录内的文本文件内容。路径必须位于当前工作目录内。',
		schema: readFileSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 read_file。' };
			}

			context.signal?.throwIfAborted();

			const safePath = await validatePathInCwd(context.cwd, args.path);
			if (!safePath.ok) {
				return { isError: true, content: safePath.content };
			}

			const fileStat = await stat(safePath.path);
			if (fileStat.isDirectory()) {
				return {
					isError: true,
					content: [
						'[what]: 你传入的是目录，不是文件，read_file 无法读取目录内容',
						`[path]: ${args.path}`,
						'[how]: 请传入具体文件路径；如果不确定文件位置，请先用 grep 搜索。',
					].join('\n'),
				};
			}

			const preview = await readTextPreview(safePath.path, fileStat.size);
			const truncatedByChars = preview.content.length > MAX_FILE_CHARS;
			const visibleContent = truncatedByChars ? preview.content.slice(0, MAX_FILE_CHARS) : preview.content;
			const truncated = preview.truncatedByBytes || truncatedByChars;

			return {
				isError: false,
				content: [
					`path: ${safePath.relativePath || '.'}`,
					`size_bytes: ${fileStat.size}`,
					`read_bytes: ${preview.bytesRead}`,
					'content:',
					visibleContent,
					truncated ? '[truncated]: 文件内容过长，已截断。' : undefined,
				]
					.filter(Boolean)
					.join('\n'),
			};
		},
	};
}

export default createReadFileTool;
