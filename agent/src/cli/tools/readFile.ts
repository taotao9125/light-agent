import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../../agent/types';

const readFileTool: ToolDefinition = {
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
				content: [
					{
						type: 'text',
						text: content,
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

export default readFileTool;
