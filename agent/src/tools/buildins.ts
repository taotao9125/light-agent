import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from './types';

export const readFileTool: ToolDefinition<{ path: string }, Promise<string>> = {
	name: 'read_tile',
	description: 'Asynchronously reads the entire contents of a file.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'file path',
			},
		},
	},

	execute(p) {
		const realPath = path.join(process.cwd(), 'agent', p.path);
		return fs.readFile(realPath, { encoding: 'utf8' });
	},
};
