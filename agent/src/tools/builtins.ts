import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from './types';

export const readFileTool: ToolDefinition<{ path: string }, Promise<string>> = {
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
			return await fs.readFile(realPath, { encoding: 'utf8' });
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	},
};

export const listFilesTool: ToolDefinition<
	{ path?: string },
	Promise<{
		path: string;
		entries: {
			name: string;
			type: 'file' | 'directory';
		}[];
		errorMessage?: string;
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
		const targetPath = p.path ?? '.';
		const realPath = path.resolve(context.cwd, targetPath);

		try {
			const entries = await fs.readdir(realPath, { withFileTypes: true });
			return {
				path: targetPath,
				entries: entries.map((entry) => ({
					name: entry.name,
					type: entry.isFile() ? 'file' : 'directory',
				})),
			};
		} catch (e) {
			return {
				path: targetPath,
				entries: [],
				errorMessage: e instanceof Error ? e.message : String(e),
			};
		}
	},
};
