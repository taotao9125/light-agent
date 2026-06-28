import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Tool } from '../../agent/tool';
import { getWorkspaceRoot, resolveWorkspacePath } from './pathSafety';

const execFileAsync = promisify(execFile);

const gitDiffTool: Tool.Definition = {
	name: 'git_diff',
	description:
		'Show git diff for the working tree or staged changes (read-only). Use to verify edits before finishing.',
	schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Optional file or directory path relative to the workspace.',
			},
			staged: {
				type: 'boolean',
				description: 'If true, show staged changes only (--cached). Defaults to false.',
			},
		},
		additionalProperties: false,
	},
	async execute(args: { path?: string; staged?: boolean }, context) {
		context.signal?.throwIfAborted();

		const workspaceRoot = getWorkspaceRoot();
		const commandArgs = ['diff'];

		if (args.staged) {
			commandArgs.push('--cached');
		}

		if (args.path?.trim()) {
			const scoped = resolveWorkspacePath(args.path);
			if (!scoped.ok) {
				return {
					isError: true,
					content: ['Failed to run git diff.', `Path: ${args.path}`, `Reason: ${scoped.reason}`].join('\n'),
				};
			}
			commandArgs.push('--', scoped.relativePath);
		}

		try {
			const { stdout, stderr } = await execFileAsync('git', commandArgs, {
				cwd: workspaceRoot,
				signal: context.signal,
				maxBuffer: 4 * 1024 * 1024,
			});

			context.signal?.throwIfAborted();

			const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');

			return {
				isError: false,
				content: [
					'Git diff:',
					`Workspace: ${workspaceRoot}`,
					args.staged ? 'Scope: staged' : 'Scope: unstaged',
					'',
					output || 'No diff.',
				].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					'Failed to run git diff.',
					args.path ? `Path: ${args.path}` : undefined,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
				]
					.filter((line) => line !== undefined)
					.join('\n'),
			};
		}
	},
};

export default gitDiffTool;
