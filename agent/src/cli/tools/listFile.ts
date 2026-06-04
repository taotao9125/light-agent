import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../../agent/types';

const listFilesTool: ToolDefinition = {
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
	async execute(p: { path: string }, context) {
		context.signal?.throwIfAborted();

		const targetPath = p.path ?? '.';
		const realPath = path.resolve(process.cwd(), targetPath);

		try {
			const entries = await fs.readdir(realPath, { withFileTypes: true });
			context.signal?.throwIfAborted();

			return {
				isError: false,
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							entries.map((entry) => ({
								name: entry.name,
								type: entry.isFile() ? 'file' : 'directory',
							})),
						),
					},
				],
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: e instanceof Error ? e.message : String(e),
					},
				],
			};
		}
	},
};

export default listFilesTool;
