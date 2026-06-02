import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../../agent/types';

const listFilesTool: ToolDefinition<
	{ path?: string },
	Promise<{ isError: boolean; isAborted?: boolean; content: string }>
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
		const realPath = path.resolve(process.cwd(), targetPath);

		try {
			// 没执行就打断
			context.signal?.throwIfAborted();
			const entries = await fs.readdir(realPath, { withFileTypes: true });
			// 已经执行，就执行完再打断
			context.signal?.throwIfAborted();

			return {
				isError: false,
				content: JSON.stringify(
					entries.map((entry) => ({
						name: entry.name,
						type: entry.isFile() ? 'file' : 'directory',
					})),
				),
			};
		} catch (e) {
			// abort 往上抛
			if (context.signal?.aborted) {
				return { isAborted: true, isError: false, content: '' };
			}

			return {
				content: e instanceof Error ? e.message : String(e),
				isError: true,
			};
		}
	},
};

export default listFilesTool;
