import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../../agent/types';

const execFileAsync = promisify(execFile);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rgPath = path.resolve(currentDir, 'bins/rg');

const listFilesNewTool: ToolDefinition = {
	name: 'list_files_new',
	description: 'List project files recursively using ripgrep, respecting ignore rules such as .gitignore.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Directory path relative to the agent working directory. Defaults to current directory.',
			},
			glob: {
				type: 'string',
				description: 'Optional glob filter, such as **/*.ts or src/**/*.tsx.',
			},
			limit: {
				type: 'number',
				description: 'Maximum number of file paths to return. Defaults to 200.',
			},
		},
		additionalProperties: false,
	},
	async execute(args: { path: string; glob?: string; limit?: number }, context) {
		context.signal?.throwIfAborted();

		const targetPath = args.path ?? '.';
		const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
		const commandArgs = ['--files'];

		if (args.glob) {
			commandArgs.push('-g', args.glob);
		}

		commandArgs.push(targetPath);

		try {
			const { stdout } = await execFileAsync(rgPath, commandArgs, {
				cwd: process.cwd(),
				signal: context.signal,
				maxBuffer: 1024 * 1024,
			});

			context.signal?.throwIfAborted();

			return {
				isError: false,
				content: [
					{
						type: 'text',
						text: stdout
							.split('\n')
							.map((line) => line.trim())
							.filter(Boolean)
							.slice(0, limit)
							.join('\n'),
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

export default listFilesNewTool;
