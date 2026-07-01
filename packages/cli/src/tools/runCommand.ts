import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getWorkspaceRoot, resolveWorkspacePath } from './pathSafety.ts';

import type { ChildProcess } from 'node:child_process';
import type { Tool } from '@light-agent/agent/tool';

const execFileAsync = promisify(execFile);

const BLOCKED_BINARIES = new Set([
	'rm',
	'rmdir',
	'unlink',
	'trash',
	'trash-cli',
	'mv',
	'dd',
	'del',
	'rimraf',
	'shred',
	'chmod',
	'chown',
	'chgrp',
]);
const DEFAULT_TIMEOUT_MS = 300_000;
const BACKGROUND_STARTUP_MS = 2_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_OUTPUT_CHARS = 64_000;

const STDERR_DEVNULL_SUFFIX = /\s2>\/dev\/null\s*$/;

const READ_ONLY_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'grep']);
const LONG_RUNNING_SCRIPT_NAMES = new Set(['dev', 'start', 'serve', 'preview']);
const SHELL_BINARIES = new Set(['sh', 'bash', 'zsh', 'fish']);
const PACKAGE_MANAGER_BINARIES = new Set(['npm', 'pnpm', 'yarn', 'bun']);

export type ValidatedRunCommand = { ok: true; command: string } | { ok: false; reason: string };

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

export function validateRunCommand(command: string): ValidatedRunCommand {
	const trimmed = command.trim();
	if (!trimmed) {
		return { ok: false, reason: 'Command is required.' };
	}

	const shellSafety = validateShellSafety(trimmed);
	if (!shellSafety.ok) {
		return shellSafety;
	}

	return { ok: true, command: trimmed };
}

function validateShellSafety(command: string): { ok: true } | { ok: false; reason: string } {
	const commands = splitShellCommandLike(command);

	for (const part of commands) {
		const argv = parseCommandLine(stripAllowedTrailingStderrRedirect(part));
		if (argv.length === 0) {
			continue;
		}

		const binary = pathBasename(argv[0]);
		if (BLOCKED_BINARIES.has(binary)) {
			return { ok: false, reason: `Destructive command is not allowed: ${binary}.` };
		}

		const destructiveArg = argv.find((arg) => isBlockedDestructiveArgument(binary, arg));
		if (destructiveArg) {
			return {
				ok: false,
				reason: `Destructive or write-oriented argument is not allowed: ${destructiveArg}.`,
			};
		}

		const nestedShellCommand = getNestedShellCommand(binary, argv);
		if (nestedShellCommand) {
			const nestedSafety = validateShellSafety(nestedShellCommand);
			if (!nestedSafety.ok) {
				return nestedSafety;
			}
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
	}

	return { ok: true };
}

async function validatePackageScriptSafety(
	command: string,
	cwd: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	for (const part of splitShellCommandLike(command)) {
		const argv = parseCommandLine(stripAllowedTrailingStderrRedirect(part));
		const scriptName = getPackageScriptName(argv);
		if (!scriptName) {
			continue;
		}

		const script = await readPackageScript(cwd, scriptName);
		if (script === undefined) {
			continue;
		}

		const scriptSafety = validateShellSafety(script);
		if (!scriptSafety.ok) {
			return {
				ok: false,
				reason: `Package script "${scriptName}" is blocked: ${scriptSafety.reason}`,
			};
		}
	}

	return { ok: true };
}

async function readPackageScript(cwd: string, scriptName: string) {
	try {
		const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as {
			scripts?: Record<string, unknown>;
		};
		const script = packageJson.scripts?.[scriptName];
		return typeof script === 'string' ? script : undefined;
	} catch {
		return undefined;
	}
}

function getPackageScriptName(argv: string[]) {
	const binary = pathBasename(argv[0] ?? '');
	if (!PACKAGE_MANAGER_BINARIES.has(binary)) {
		return undefined;
	}

	const subcommand = argv[1];

	if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn' || binary === 'bun') && subcommand === 'run') {
		return argv[2];
	}

	if (binary === 'npm' && subcommand === 'run-script') {
		return argv[2];
	}

	if ((binary === 'npm' || binary === 'yarn') && (subcommand === 'start' || subcommand === 'test')) {
		return subcommand;
	}

	if ((binary === 'pnpm' || binary === 'yarn' || binary === 'bun') && subcommand && !subcommand.startsWith('-')) {
		return subcommand;
	}

	return undefined;
}

function getNestedShellCommand(binary: string, argv: string[]) {
	if (!SHELL_BINARIES.has(binary)) {
		return undefined;
	}

	const commandFlagIndex = argv.findIndex((arg) => arg === '-c' || arg === '-lc');
	if (commandFlagIndex === -1) {
		return undefined;
	}

	return argv[commandFlagIndex + 1];
}

function splitShellCommandLike(command: string) {
	const commands: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < command.length; i += 1) {
		const char = command[i];
		const next = command[i + 1];

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

		if (!inSingle && !inDouble && (char === ';' || char === '|' || char === '\n' || char === '\r')) {
			if (current.trim()) {
				commands.push(current.trim());
			}
			current = '';
			continue;
		}

		if (!inSingle && !inDouble && (char === '&' || char === '|') && next === char) {
			if (current.trim()) {
				commands.push(current.trim());
			}
			current = '';
			i += 1;
			continue;
		}

		current += char;
	}

	if (current.trim()) {
		commands.push(current.trim());
	}

	return commands;
}

function stripAllowedTrailingStderrRedirect(command: string) {
	return STDERR_DEVNULL_SUFFIX.test(command) ? command.replace(STDERR_DEVNULL_SUFFIX, '').trim() : command;
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

async function execShellCommand(command: string, cwd: string, signal: AbortSignal) {
	if (isLikelyLongRunningCommand(command)) {
		return execBackgroundShellCommand(command, cwd, signal);
	}

	if (!command.includes('|') && !command.includes(';') && !command.includes('&') && !command.includes('>')) {
		const argv = parseCommandLine(command);
		const [binary, ...commandArgs] = argv;
		const { stdout, stderr } = await execFileAsync(binary, commandArgs, {
			cwd,
			signal,
			maxBuffer: 1024 * 1024 * 8,
			env: process.env,
		});

		return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
	}

	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const children: ChildProcess[] = [];
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

		const child = spawn('sh', ['-lc', command], {
			cwd,
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		children.push(child);

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', fail);

		child.on('close', (code: number | null) => {
			signal.removeEventListener('abort', onAbort);
			if (settled) {
				return;
			}

			if (code === 0) {
				settled = true;
				resolve({ stdout, stderr });
				return;
			}

			const error = new Error(`Command failed with exit code ${code ?? 'unknown'}`) as Error & {
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
	return execShellCommand(validated.command, cwd, signal);
}

function isLikelyLongRunningCommand(command: string) {
	const commands = splitShellCommandLike(command);
	if (commands.length !== 1) {
		return false;
	}

	const argv = parseCommandLine(stripAllowedTrailingStderrRedirect(commands[0]));
	const scriptName = getPackageScriptName(argv);
	return scriptName !== undefined && LONG_RUNNING_SCRIPT_NAMES.has(scriptName);
}

async function execBackgroundShellCommand(command: string, cwd: string, signal: AbortSignal) {
	const logFile = path.join(os.tmpdir(), `light-agent-run-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
	const shellCommand = `exec ${command} > ${shellQuote(logFile)} 2>&1`;

	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		let settled = false;
		let startedTimer: NodeJS.Timeout | undefined;
		const child = spawn('sh', ['-lc', shellCommand], {
			cwd,
			detached: true,
			env: process.env,
			stdio: 'ignore',
		});

		const finish = (result: { stdout: string; stderr: string }, isError = false) => {
			if (settled) {
				return;
			}
			settled = true;
			signal.removeEventListener('abort', onAbort);
			if (startedTimer) {
				clearTimeout(startedTimer);
			}
			if (isError) {
				const error = new Error('Background command exited during startup.') as Error & {
					stdout?: string;
					stderr?: string;
					code?: number | string;
				};
				error.stdout = result.stdout;
				error.stderr = result.stderr;
				reject(error);
				return;
			}
			resolve(result);
		};

		const onAbort = () => {
			if (!settled) {
				try {
					if (child.pid) {
						process.kill(-child.pid, 'SIGTERM');
					}
				} catch {
					child.kill('SIGTERM');
				}
				finish({ stdout: '', stderr: String(signal.reason ?? 'Aborted') }, true);
			}
		};

		if (signal.aborted) {
			onAbort();
			return;
		}

		signal.addEventListener('abort', onAbort, { once: true });

		startedTimer = setTimeout(async () => {
			child.unref();
			const output = truncateOutput(await readTextFileIfExists(logFile));
			finish({
				stdout: [
					'Background command started.',
					`Pid: ${child.pid}`,
					`Log: ${logFile}`,
					'',
					output || '(no output yet)',
				].join('\n'),
				stderr: '',
			});
		}, BACKGROUND_STARTUP_MS);

		child.once('error', async (error) => {
			finish({ stdout: await readTextFileIfExists(logFile), stderr: error.message }, true);
		});

		child.once('exit', async (code, exitSignal) => {
			if (settled) {
				return;
			}

			const output = await readTextFileIfExists(logFile);
			if (code === 0) {
				finish({ stdout: output, stderr: '' });
				return;
			}

			finish(
				{
					stdout: output,
					stderr: `Command exited during startup with ${exitSignal ? `signal ${exitSignal}` : `code ${code}`}.`,
				},
				true,
			);
		});
	});
}

async function readTextFileIfExists(filePath: string) {
	try {
		return await fs.readFile(filePath, 'utf8');
	} catch {
		return '';
	}
}

function shellQuote(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

const runCommandTool: Tool.Definition = {
	name: 'run_command',
	description:
		'Run a shell command inside the agent workspace. Package manager installs, project commands, scripts, pipelines, and common shell operators are allowed. Delete/move/destructive commands are blocked.',
	schema: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description:
					'Command to run in a shell. Examples: "pnpm run dev --host", "npm install", "pnpm add react", "npm run build", "find src -name *.ts | wc -l". Do not use rm/rmdir/mv or destructive shell patterns.',
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

		const packageScriptSafety = await validatePackageScriptSafety(validated.command, cwd);
		if (!packageScriptSafety.ok) {
			return {
				isError: true,
				content: [
					'Failed to run command.',
					`Command: ${args.command}`,
					`Cwd: ${pathRelativeToWorkspace(cwd, workspaceRoot)}`,
					`Reason: ${packageScriptSafety.reason}`,
				].join('\n'),
			};
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
