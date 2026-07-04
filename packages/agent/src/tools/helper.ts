import { spawn } from 'node:child_process';

export type ChildSpawnOptions = {
	command: string;
	args?: string[];
	cwd: string;
	signal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	maxStdoutBytes?: number;
	maxStderrBytes?: number;
};

export type ChildSpawnResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	timedOut: boolean;
	aborted: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const FORCE_KILL_DELAY_MS = 2_000;

function collectOutput(maxBytes: number) {
	const chunks: Buffer[] = [];
	let bytes = 0;
	let truncated = false;

	return {
		push(chunk: Buffer) {
			if (bytes >= maxBytes) {
				truncated = true;
				return;
			}

			const remaining = maxBytes - bytes;
			const visibleChunk = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
			chunks.push(visibleChunk);
			bytes += visibleChunk.length;

			if (visibleChunk.length < chunk.length) {
				truncated = true;
			}
		},
		text() {
			return Buffer.concat(chunks).toString('utf8');
		},
		isTruncated() {
			return truncated;
		},
	};
}

export function childSpawn(options: ChildSpawnOptions): Promise<ChildSpawnResult> {
	const {
		command,
		args = [],
		cwd,
		signal,
		env,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxStdoutBytes = DEFAULT_MAX_OUTPUT_BYTES,
		maxStderrBytes = DEFAULT_MAX_OUTPUT_BYTES,
	} = options;

	signal?.throwIfAborted();

	return new Promise((resolve, reject) => {
		const stdout = collectOutput(maxStdoutBytes);
		const stderr = collectOutput(maxStderrBytes);
		let timedOut = false;
		let aborted = false;
		let spawnError: Error | null = null;
		let forceKillTimer: NodeJS.Timeout | undefined;

		const child = spawn(command, args, {
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false,
			windowsHide: true,
		});

		const requestKill = () => {
			if (child.killed) return;
			child.kill('SIGTERM');
			forceKillTimer = setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL');
			}, FORCE_KILL_DELAY_MS);
			forceKillTimer.unref?.();
		};

		const abortHandler = () => {
			aborted = true;
			requestKill();
		};

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			requestKill();
		}, timeoutMs);
		timeoutTimer.unref?.();

		signal?.addEventListener('abort', abortHandler, { once: true });

		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

		child.on('error', (error) => {
			spawnError = error;
		});

		child.on('close', (code, closeSignal) => {
			clearTimeout(timeoutTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			signal?.removeEventListener('abort', abortHandler);

			if (spawnError && !timedOut && !aborted) {
				reject(spawnError);
				return;
			}

			resolve({
				code,
				signal: closeSignal,
				stdout: stdout.text(),
				stderr: stderr.text(),
				stdoutTruncated: stdout.isTruncated(),
				stderrTruncated: stderr.isTruncated(),
				timedOut,
				aborted,
			});
		});
	});
}
