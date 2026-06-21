import fs from 'fs/promises';
import path from 'path';

import type { Tool } from '../../agent/tool';

const readFileTool: Tool.Definition = {
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

	async execute(p: { path: string }, context) {
		context.signal?.throwIfAborted();

		const realPath = path.resolve(process.cwd(), p.path);
		try {
			const content = await fs.readFile(realPath, { encoding: 'utf8', signal: context.signal });
			return {
				isError: false,
				content: ['File read successfully.', `Path: ${p.path}`, '', content].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: ['Failed to read file.', `Path: ${p.path}`, `Reason: ${e instanceof Error ? e.message : String(e)}`].join('\n'),
			};
		}
	},
};

export default readFileTool;
