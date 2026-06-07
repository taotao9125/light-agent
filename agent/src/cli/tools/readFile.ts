import fs from 'fs/promises';
import path from 'path';
import type { Tool } from '../../agent/tool';
import { errorText, textResult } from './toolResult';

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
			return textResult(['File read successfully.', `Path: ${p.path}`, '', content].join('\n'));
		} catch (e) {
			context.signal?.throwIfAborted();
			return textResult(['Failed to read file.', `Path: ${p.path}`, `Reason: ${errorText(e)}`].join('\n'), true);
		}
	},
};

export default readFileTool;
