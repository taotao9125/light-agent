import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath } from './pathSafety.ts';

import type { Tool } from '@light-agent/agent/tool';

const writeFileTool: Tool.Definition = {
	name: 'write_file',
	description:
		'Create or overwrite a text file within the agent workspace. Use after read_file when implementing or fixing code.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path relative to the agent workspace.',
			},
			content: {
				type: 'string',
				description: 'Full file contents to write.',
			},
		},
		required: ['path', 'content'],
		additionalProperties: false,
	},
	async execute(args: { path: string; content: string }, context) {
		context.signal?.throwIfAborted();

		const resolved = resolveWorkspacePath(args.path);
		if (!resolved.ok) {
			return {
				isError: true,
				content: ['Failed to write file.', `Path: ${args.path}`, `Reason: ${resolved.reason}`].join('\n'),
			};
		}

		try {
			await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
			await fs.writeFile(resolved.absolutePath, args.content, {
				encoding: 'utf8',
				signal: context.signal,
			});

			return {
				isError: false,
				content: [
					'File written successfully.',
					`Path: ${resolved.relativePath}`,
					`Bytes: ${Buffer.byteLength(args.content, 'utf8')}`,
				].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					'Failed to write file.',
					`Path: ${args.path}`,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
				].join('\n'),
			};
		}
	},
};

export default writeFileTool;
