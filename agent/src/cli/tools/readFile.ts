import fs from 'node:fs/promises';

import type { Tool } from '../../agent/tool';
import { resolveWorkspacePath } from './pathSafety';

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

		const resolved = resolveWorkspacePath(p.path);
		if (!resolved.ok) {
			return {
				isError: true,
				content: ['Failed to read file.', `Path: ${p.path}`, `Reason: ${resolved.reason}`].join('\n'),
			};
		}

		try {
			const content = await fs.readFile(resolved.absolutePath, {
				encoding: 'utf8',
				signal: context.signal,
			});
			return {
				isError: false,
				content: ['File read successfully.', `Path: ${resolved.relativePath}`, '', content].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					'Failed to read file.',
					`Path: ${p.path}`,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
				].join('\n'),
			};
		}
	},
};

export default readFileTool;
