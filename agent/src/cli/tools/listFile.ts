import fs from 'fs/promises';
import path from 'path';
import type { Tool } from '../../agent/tool';
import { errorText, textResult } from './toolResult';

const listFilesTool: Tool.Definition = {
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

			const lines = entries.map((entry) => {
				const type = entry.isFile() ? 'file' : 'directory';
				return `- ${entry.name} [${type}]`;
			});

			return textResult([`Directory: ${targetPath}`, '', ...lines].join('\n'));
		} catch (e) {
			context.signal?.throwIfAborted();
			return textResult(
				[`Failed to list directory.`, `Directory: ${targetPath}`, `Reason: ${errorText(e)}`].join('\n'),
				true,
			);
		}
	},
};

export default listFilesTool;
