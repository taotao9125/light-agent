import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveWorkspacePath } from './pathSafety.ts';

import type { Tool } from '@light-agent/agent/tool';

const execFileAsync = promisify(execFile);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rgPath = path.resolve(currentDir, 'bins/rg');
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 500;
const MAX_OUTPUT_CHARS = 64_000;

type GrepArgs = {
	query?: string;
	path?: string;
	glob?: string;
	mode?: 'content' | 'files';
	ignoreCase?: boolean;
	limit?: number;
};

function normalizeLimit(limit: unknown) {
	if (!Number.isFinite(limit)) {
		return DEFAULT_LIMIT;
	}

	return Math.max(1, Math.min(Math.floor(Number(limit)), MAX_LIMIT));
}

function truncate(text: string) {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return text;
	}

	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n... output truncated (${text.length} chars total) ...`;
}

function filterFilesByQuery(files: string[], query: string, ignoreCase: boolean) {
	if (!query.trim()) {
		return files;
	}

	const needle = ignoreCase ? query.toLowerCase() : query;
	return files.filter((file) => {
		const haystack = ignoreCase ? file.toLowerCase() : file;
		return haystack.includes(needle);
	});
}

const grepTool: Tool.Definition = {
	name: 'grep',
	description:
		'Search workspace files with ripgrep. Use mode "content" to search text contents, and mode "files" to discover file paths by name/glob. This is read-only.',
	schema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Search text. In content mode this is the ripgrep pattern. In files mode this filters returned file paths and may be empty when glob/path is enough.',
			},
			path: {
				type: 'string',
				description: 'Optional file or directory path relative to the workspace. Defaults to workspace root.',
			},
			glob: {
				type: 'string',
				description: 'Optional glob filter, such as **/*.ts or agent/src/**/*.tsx.',
			},
			mode: {
				type: 'string',
				description: 'Either "content" or "files". Defaults to "content".',
			},
			ignoreCase: {
				type: 'boolean',
				description: 'If true, search case-insensitively.',
			},
			limit: {
				type: 'number',
				description: `Maximum number of matches or file paths to return. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
			},
		},
		additionalProperties: false,
	},
	async execute(args: GrepArgs, context) {
		context.signal?.throwIfAborted();

		const mode = args.mode === 'files' ? 'files' : 'content';
		const query = args.query ?? '';
		const limit = normalizeLimit(args.limit);
		const scoped = resolveWorkspacePath(args.path ?? '.');

		if (!scoped.ok) {
			return {
				isError: true,
				content: ['Failed to grep workspace.', `Path: ${args.path ?? '.'}`, `Reason: ${scoped.reason}`].join(
					'\n',
				),
			};
		}

		const commandArgs =
			mode === 'files'
				? ['--files']
				: ['--line-number', '--column', '--heading', '--color', 'never', '--smart-case'];

		if (args.glob) {
			commandArgs.push('-g', args.glob);
		}

		if (mode === 'content') {
			if (!query.trim()) {
				return {
					isError: true,
					content: 'Failed to grep workspace.\nReason: query is required in content mode.',
				};
			}

			if (args.ignoreCase) {
				commandArgs.push('--ignore-case');
			}

			commandArgs.push(query, scoped.relativePath);
		} else {
			commandArgs.push(scoped.relativePath);
		}

		try {
			const { stdout } = await execFileAsync(rgPath, commandArgs, {
				cwd: scoped.workspaceRoot,
				signal: context.signal,
				maxBuffer: 1024 * 1024 * 8,
			});

			context.signal?.throwIfAborted();

			const lines = stdout
				.split('\n')
				.map((line) => line.trimEnd())
				.filter(Boolean);
			const results = mode === 'files' ? filterFilesByQuery(lines, query, Boolean(args.ignoreCase)) : lines;
			const limited = results.slice(0, limit);

			return {
				isError: false,
				content: truncate(
					[
						'Grep results:',
						`Mode: ${mode}`,
						`Path: ${scoped.relativePath}`,
						args.glob ? `Glob: ${args.glob}` : undefined,
						query ? `Query: ${query}` : undefined,
						`Limit: ${limit}`,
						'',
						limited.length ? limited.join('\n') : 'No matches found.',
					]
						.filter((line) => line !== undefined)
						.join('\n'),
				),
			};
		} catch (e) {
			context.signal?.throwIfAborted();

			const execError = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
			if (execError.code === 1) {
				return {
					isError: false,
					content: [
						'Grep results:',
						`Mode: ${mode}`,
						`Path: ${scoped.relativePath}`,
						args.glob ? `Glob: ${args.glob}` : undefined,
						query ? `Query: ${query}` : undefined,
						`Limit: ${limit}`,
						'',
						'No matches found.',
					]
						.filter((line) => line !== undefined)
						.join('\n'),
				};
			}

			return {
				isError: true,
				content: [
					'Failed to grep workspace.',
					`Mode: ${mode}`,
					`Path: ${args.path ?? '.'}`,
					args.glob ? `Glob: ${args.glob}` : undefined,
					query ? `Query: ${query}` : undefined,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
				]
					.filter((line) => line !== undefined)
					.join('\n'),
			};
		}
	},
};

export default grepTool;
