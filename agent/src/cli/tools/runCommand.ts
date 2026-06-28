import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getWorkspaceRoot, resolveWorkspacePath } from './pathSafety';

import type { Tool } from '../../agent/tool';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const execFileAsync = promisify(execFile);

const ALLOWED_BINARIES = new Set([
	'npm',
	'npx',
	'pnpm',
	'pnpx',
	'node',
	'tsc',
	'vitest',
	'biome',
	'git',
	'pwd',
	'ls',
	'cat',
	'sed',
	'head',
	'tail',
	'wc',
	'rg',
	'grep',
	'find',
]);
const BLOCKED_BINARIES = new Set(['rm', 'rmdir', 'unlink', 'trash', 'mv', 'dd', 'shred', 'chmod', 'chown', 'chgrp']);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_OUTPUT_CHARS = 64_000;
const MAX_PIPELINE_STAGES = 5;

const BLOCKED_STRUCTURE_PATTERN = /[;&`$]|\n|\r|&&|\|\|/;
const STDERR_DEVNULL_SUFFIX = /\s2>\/dev\/null\s*$/;

const INSTALL_SUBCOMMANDS: Record<string, Set<string>> = {
	npm: new Set(['install', 'i', 'ci', 'update', 'add']),
	pnpm: new Set(['install', 'i', 'add', 'install-deps', 'update']),
	npx: new Set(['create-vite', 'create-next-app', 'create-react-app']),
	pnpx: new Set(['create-vite', 'create-next-app']),
};

const READ_ONLY_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'grep']);

type CommandStage = {
	argv: string[];
	ignoreStderr: boolean;
};

export type ValidatedRunCommand =
	| { ok: true; kind: 'single'; argv: string[]; ignoreStderr: boolean }
	| { ok: true; kind: 'pipeline'; stages: CommandStage[] }
	| { ok: false; reason: string };

export function isBlockedNetworkCommand(argv: string[]): { blocked: true; reason: string } | { blocked: false } {
	const binary = pathBasename(argv[0] ?? '');
	const subcommand = argv[1];

	const blockedSubs = INSTALL_SUBCOMMANDS[binary];
	if (blockedSubs?.has(subcommand)) {
		return {
			blocked: true,
			reason: 'Dependency install / project bootstrap via package manager is disabled in this CLI. Scaffold with write_file and tell the user which install commands to run locally.',
		};
	}

	if (binary === 'npm' && subcommand === 'create') {
		return {
			blocked: true,
			reason: '"npm create" downloads templates and is disabled in this CLI. Scaffold project files with write_file instead.',
		};
	}

	if (binary === 'npx' && subcommand?.startsWith('create-')) {
		return {
			blocked: true,
			reason: 'npx create-* scaffolds are disabled in this CLI. Scaffold project files with write_file instead.',
		};
	}

	return { blocked: false };
}

export function parseCommandLine(command: string): string[] {
	const trimmed = command.trim();
	if (!trimmed) {
		return [];
	}

	const args: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < trimmed.length; i += 1) {
		const char = trimmed[i];

		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}

		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}

		if (!inSingle && !inDouble && /\s/.test(char)) {
			if (current) {
				args.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (current) {
		args.push(current);
	}

	return args;
}

function splitPipelineSegments(command: string) {
	const segments: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < command.length; i += 1) {
		const char = command[i];

		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			current += char;
			continue;
		}

		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			current += char;
			continue;
		}

		if (char === '|' && !inSingle && !inDouble) {
			segments.push(current.trim());
			current = '';
			continue;
		}

		current += char;
	}

	segments.push(current.trim());
	return segments;
}

function parseStageSegment(segment: string): { ok: true; command: string; ignoreStderr: boolean } | { ok: false; reason: string } {
	const trimmed = segment.trim();
	if (!trimmed) {
		return { ok: false, reason: 'Empty pipeline stage.' };
	}

	const ignoreStderr = STDERR_DEVNULL_SUFFIX.test(trimmed);
	const command = ignoreStderr ? trimmed.replace(STDERR_DEVNULL_SUFFIX, '').trim() : trimmed;

	if (!command) {
		return { ok: false, reason: 'Empty pipeline stage.' };
	}

	if (/[<>]/.test(command)) {
		return { ok: false, reason: 'Redirects are not allowed except trailing 2>/dev/null.' };
	}

	return { ok: true, command, ignoreStderr };
}

function validateSingleCommandArgv(command: string): { ok: true; argv: string[] } | { ok: false; reason: string } {
	if (/[|;&`$<>]|\n|\r|&&|\|\|/.test(command)) {
		return { ok: false, reason: 'Shell operators (; | & > < $ ` newlines) are not allowed.' };
	}

	const argv = parseCommandLine(command);
	if (argv.length === 0) {
		return { ok: false, reason: 'Command is required.' };
	}

	const binary = pathBasename(argv[0]);
	if (BLOCKED_BINARIES.has(binary)) {
		return { ok: false, reason: `Destructive command is not allowed: ${binary}.` };
	}

	if (!ALLOWED_BINARIES.has(binary)) {
		return {
			ok: false,
			reason: `Command must start with one of: ${[...ALLOWED_BINARIES].join(', ')}.`,
		};
	}

	if (pathBasename(argv[0]) !== argv[0] || argv[0].startsWith('.')) {
		return { ok: false, reason: 'Use bare command names only (e.g. npm run dev), not paths.' };
	}

	const networkBlocked = isBlockedNetworkCommand(argv);
	if (networkBlocked.blocked) {
		return { ok: false, reason: networkBlocked.reason };
	}

	const destructiveArg = argv.find((arg) => isBlockedDestructiveArgument(binary, arg));
	if (destructiveArg) {
		return {
			ok: false,
			reason: `Destructive or write-oriented argument is not allowed: ${destructiveArg}.`,
		};
	}

	if (binary === 'git') {
		const subcommand = argv[1];
		if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
			return {
				ok: false,
				reason: `Only read-only git subcommands are allowed: ${[...READ_ONLY_GIT_SUBCOMMANDS].join(', ')}.`,
			};
		}
	}

	return { ok: true, argv };
}

export function validateRunCommand(command: string): ValidatedRunCommand {
	const trimmed = command.trim();
	if (!trimmed) {
		return { ok: false, reason: 'Command is required.' };
	}

	if (BLOCKED_STRUCTURE_PATTERN.test(trimmed)) {
		return { ok: false, reason: 'Shell operators (; && || $ ` newlines) are not allowed.' };
	}

	const rawSegments = splitPipelineSegments(trimmed);
	if (rawSegments.length > MAX_PIPELINE_STAGES) {
		return { ok: false, reason: `Too many pipeline stages (max ${MAX_PIPELINE_STAGES}).` };
	}

	const stages: CommandStage[] = [];

	for (const rawSegment of rawSegments) {
		const parsedStage = parseStageSegment(rawSegment);
		if (!parsedStage.ok) {
			return parsedStage;
		}

		const validatedStage = validateSingleCommandArgv(parsedStage.command);
		if (!validatedStage.ok) {
			return validatedStage;
		}

		stages.push({
			argv: validatedStage.argv,
			ignoreStderr: parsedStage.ignoreStderr,
		});
	}

	if (stages.length === 1) {
		return {
			ok: true,
			kind: 'single',
			argv: stages[0].argv,
			ignoreStderr: stages[0].ignoreStderr,
		};
	}

	return { ok: true, kind: 'pipeline', stages };
}

function isBlockedDestructiveArgument(binary: string, arg: string) {
	if (arg === '-i' || arg.startsWith('--in-place')) {
		return binary === 'sed';
	}

	if (arg === '-delete' || arg === '-exec' || arg === '-execdir') {
		return binary === 'find';
	}

	if (
		binary === 'git' &&
		['clean', 'reset', 'checkout', 'restore', 'rm', 'commit', 'add', 'push', 'merge', 'rebase'].includes(arg)
	) {
		return true;
	}

	return false;
}

function pathBasename(command: string) {
	const normalized = command.replace(/\\/g, '/');
	return normalized.split('/').pop() ?? command;
}

function truncateOutput(text: string) {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return text;
	}

	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n... output truncated (${text.length} chars total) ...`;
}

function mergeAbortSignals(signals: AbortSignal[]) {
	const controller = new AbortController();

	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			return controller.signal;
		}

		signal.addEventListener(
			'abort',
			() => {
				controller.abort(signal.reason);
			},
			{ once: true },
		);
	}

	return controller.signal;
}

async function execSingleStage(stage: CommandStage, cwd: string, signal: AbortSignal) {
	const [binary, ...commandArgs] = stage.argv;

	if (stage.ignoreStderr) {
		return execStagesAsPipeline([stage], cwd, signal);
	}

	const { stdout, stderr } = await execFileAsync(binary, commandArgs, {
		cwd,
		signal,
		maxBuffer: 1024 * 1024 * 8,
		env: process.env,
	});

	return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
}

async function execStagesAsPipeline(stages: CommandStage[], cwd: string, signal: AbortSignal) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const children: ChildProcessWithoutNullStreams[] = [];
		let settled = false;

		const cleanup = () => {
			for (const child of children) {
				if (!child.killed) {
					child.kill('SIGTERM');
				}
			}
		};

		const fail = (error: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};

		const onAbort = () => {
			fail(signal.reason ?? new Error('Aborted'));
		};

		if (signal.aborted) {
			onAbort();
			return;
		}

		signal.addEventListener('abort', onAbort, { once: true });

		let previous: ChildProcessWithoutNullStreams | undefined;

		for (const stage of stages) {
			const [binary, ...args] = stage.argv;
			const child = spawn(binary, args, {
				cwd,
				env: process.env,
				stdio: [previous ? 'pipe' : 'ignore', 'pipe', stage.ignoreStderr ? 'ignore' : 'pipe'],
			});

			if (previous?.stdout && child.stdin) {
				previous.stdout.pipe(child.stdin);
			}

			child.on('error', fail);
			children.push(child);
			previous = child;
		}

		const last = children.at(-1);
		if (!last) {
			fail(new Error('Pipeline has no stages.'));
			return;
		}

		let stdout = '';
		let stderr = '';

		last.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		last.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		last.on('close', (code) => {
			signal.removeEventListener('abort', onAbort);
			if (settled) {
				return;
			}

			if (code === 0) {
				settled = true;
				resolve({ stdout, stderr });
				return;
			}

			const error = new Error(`Command failed with exit code ${code ?? 'unknown'}`) as NodeJS.ErrnoException & {
				stdout?: string;
				stderr?: string;
				code?: number;
			};
			error.stdout = stdout;
			error.stderr = stderr;
			error.code = code ?? undefined;
			fail(error);
		});
	});
}

async function execValidatedCommand(validated: ValidatedRunCommand & { ok: true }, cwd: string, signal: AbortSignal) {
	if (validated.kind === 'pipeline') {
		return execStagesAsPipeline(validated.stages, cwd, signal);
	}

	if (validated.ignoreStderr) {
		return execStagesAsPipeline([{ argv: validated.argv, ignoreStderr: true }], cwd, signal);
	}

	return execSingleStage({ argv: validated.argv, ignoreStderr: false }, cwd, signal);
}

const runCommandTool: Tool.Definition = {
	name: 'run_command',
	description:
		'Run an allowlisted non-destructive command inside the agent workspace. Supports read-only pipelines between allowlisted binaries (e.g. "find src -name *.ts | wc -l", "find src -type f 2>/dev/null | head"). No dependency installs, no project bootstraps, no delete/move/destructive commands, and no general shell operators.',
	schema: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description:
					'Allowlisted command. Optional read-only pipeline with | between allowlisted binaries. Optional trailing 2>/dev/null per stage. Examples: "npm run build", "find src -name *.ts | wc -l". Do not use install/ci/add/create, rm/rmdir/mv, or write/destructive shell patterns.',
			},
			cwd: {
				type: 'string',
				description: 'Optional working directory relative to the workspace. Defaults to workspace root.',
			},
			timeoutMs: {
				type: 'number',
				description: `Optional timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
			},
		},
		required: ['command'],
		additionalProperties: false,
	},
	async execute(args: { command: string; cwd?: string; timeoutMs?: number }, context) {
		context.signal?.throwIfAborted();

		const validated = validateRunCommand(args.command);
		if (!validated.ok) {
			return {
				isError: true,
				content: ['Failed to run command.', `Command: ${args.command}`, `Reason: ${validated.reason}`].join(
					'\n',
				),
			};
		}

		const workspaceRoot = getWorkspaceRoot();
		let cwd = workspaceRoot;

		if (args.cwd?.trim()) {
			const scoped = resolveWorkspacePath(args.cwd);
			if (!scoped.ok) {
				return {
					isError: true,
					content: ['Failed to run command.', `Cwd: ${args.cwd}`, `Reason: ${scoped.reason}`].join('\n'),
				};
			}
			cwd = scoped.absolutePath;
		}

		const timeoutMs = Math.min(
			Math.max(Number.isFinite(args.timeoutMs) ? Math.floor(args.timeoutMs!) : DEFAULT_TIMEOUT_MS, 1_000),
			MAX_TIMEOUT_MS,
		);

		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => {
			timeoutController.abort(new Error(`Command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		const signals = [timeoutController.signal];
		if (context.signal) {
			signals.push(context.signal);
		}
		const signal = mergeAbortSignals(signals);

		try {
			const { stdout, stderr } = await execValidatedCommand(validated, cwd, signal);

			context.signal?.throwIfAborted();

			const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n').trim());

			return {
				isError: false,
				content: [
					'Command completed successfully.',
					`Command: ${args.command}`,
					`Cwd: ${pathRelativeToWorkspace(cwd, workspaceRoot)}`,
					`Exit code: 0`,
					'',
					output || '(no output)',
				].join('\n'),
			};
		} catch (e) {
			context.signal?.throwIfAborted();

			const execError = e as NodeJS.ErrnoException & {
				stdout?: string;
				stderr?: string;
				code?: number | string;
				signal?: string;
			};

			const stdout = typeof execError.stdout === 'string' ? execError.stdout : '';
			const stderr = typeof execError.stderr === 'string' ? execError.stderr : '';
			const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n').trim());
			const exitCode =
				typeof execError.code === 'number'
					? execError.code
					: execError.signal
						? `signal ${execError.signal}`
						: execError.code;

			return {
				isError: true,
				content: [
					'Command failed.',
					`Command: ${args.command}`,
					`Cwd: ${pathRelativeToWorkspace(cwd, workspaceRoot)}`,
					exitCode !== undefined ? `Exit code: ${exitCode}` : undefined,
					`Reason: ${e instanceof Error ? e.message : String(e)}`,
					'',
					output || '(no output)',
				]
					.filter((line) => line !== undefined)
					.join('\n'),
			};
		} finally {
			clearTimeout(timeoutId);
		}
	},
};

function pathRelativeToWorkspace(cwd: string, workspaceRoot: string) {
	const relative = path.relative(workspaceRoot, cwd);
	return relative || '.';
}

export default runCommandTool;
