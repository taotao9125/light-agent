import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceRoot, resolveWorkspacePath } from './pathSafety.ts';

import type { Tool } from '@light-agent/agent/tool';

const execFileAsync = promisify(execFile);

const gitStatusTool: Tool.Definition = {
	name: 'git_status',
	description: 'Show git working tree status (read-only). Use to review changed files before finishing a task.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Optional path relative to the workspace to limit status output.',
			},
		},
		additionalProperties: false,
	},
	async execute(args: { path?: string }, context) {
		context.signal?.throwIfAborted();

		const workspaceRoot = getWorkspaceRoot();
		const commandArgs = ['status', '--short', '--branch'];

		if (args.path?.trim()) {
			const scoped = resolveWorkspacePath(args.path);
			if (!scoped.ok) {
				return {
					isError: true,
					content: ['Failed to run git status.', `Path: ${args.path}`, `Reason: ${scoped.reason}`].join('\n'),
				};
			}
			commandArgs.push('--', scoped.relativePath);
		}

		try {
			const { stdout, stderr } = await execFileAsync('git', commandArgs, {
				cwd: workspaceRoot,
				signal: context.signal,
				maxBuffer: 1024 * 1024,
			});

			context.signal?.throwIfAborted();

			const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');

			return {
				isError: false,
				content: ['Git status:', `Workspace: ${workspaceRoot}`, '', output || 'Working tree clean.'].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					'Failed to run git status.',
					args.path ? `Path: ${args.path}` : undefined,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
				]
					.filter((line) => line !== undefined)
					.join('\n'),
			};
		}
	},
};

export default gitStatusTool;
