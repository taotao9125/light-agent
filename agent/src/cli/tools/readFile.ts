import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../../agent/types';

const readFileTool: ToolDefinition<{ path: string }, Promise<string>> = {
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
		context.signal?.throwIfAborted();

		const realPath = path.resolve(process.cwd(), p.path);
		try {
			return await fs.readFile(realPath, { encoding: 'utf8', signal: context.signal });
		} catch (e) {
			context.signal?.throwIfAborted();
			throw e instanceof Error ? e : new Error(String(e));
		}
	},
};

export default readFileTool;
