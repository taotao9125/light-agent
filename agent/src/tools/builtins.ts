import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from './types';

export const readFileTool: ToolDefinition<{ path: string }, Promise<{
	content: string;
	isError: boolean;
}>> = {
	name: 'read_file',
	description: 'Read the full contents of a specific file when the user asks to inspect, open, or read a file.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The user-specified file path to read, resolved relative to the agent working directory.',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},

	async execute(p, context) {
		const realPath = path.resolve(context.cwd, p.path);
		try {
			return {
				content: await fs.readFile(realPath, { encoding: 'utf8', signal: context.signal }),
				isError: false
			};
		} catch (e) {
			// 用户取消往上抛
			if (context.signal?.aborted) {
				throw e;
			}
			return {
				content: e instanceof Error ? e.message : String(e),
				isError: true
			}
		}
	},
};

export const listFilesTool: ToolDefinition<
	{ path?: string },
	Promise<{
		isError: boolean;
		content: string | {
			name: string;
			type: 'file' | 'directory';
		}[];
	}>
> = {
	name: 'list_files',
	description: 'List files and directories directly under a directory.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Directory path relative to the agent working directory. Defaults to current directory.',
			},
		},
	},
	async execute(p, context) {
		// 工具执行并不能完全打断，逻辑是没执行的就不要执行了，已执行的不要返回结果了。
		const targetPath = p.path ?? '.';

		const realPath = path.resolve(context.cwd, targetPath);
		// readdir 不支持 signal, 手动打
		context.signal?.throwIfAborted();
		try {
			const entries = await fs.readdir(realPath, { withFileTypes: true });
			context.signal?.throwIfAborted();
			return {
				isError: false,
				content: entries.map((entry) => ({
					name: entry.name,
					type: entry.isFile() ? 'file' : 'directory',
				})),
			};
		} catch (e) {

			// 用户取消往上抛
			if (context.signal?.aborted) {
				throw e;
			}

			return {
				content: e instanceof Error ? e.message : String(e),
				isError: true,
			};
		}
	},
};
