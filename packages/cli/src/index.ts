#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import Agent from '@light-agent/agent';
import SessionStore from '@light-agent/agent/store';
import { createClient } from '@light-agent/ai';
import path from 'path';
import { parseCliArgs, printCliHelp } from './parseCliArgs.ts';
import { cliPrompts } from './prompts.ts';
import { drainStdinBuffer, isSubmittableCliInput, readCliInput } from './readCliInput.ts';
import gitDiffTool from './tools/gitDiff.ts';
import gitStatusTool from './tools/gitStatus.ts';
import grepTool from './tools/grep.ts';
import readFileTool from './tools/readFile.ts';
import runCommandTool from './tools/runCommand.ts';
import searchDoc from './tools/searchdoc.ts';
import writeFileTool from './tools/writeFile.ts';

import type { Interface } from 'node:readline/promises';
import 'dotenv/config';

const home = os.homedir();

const configPath = path.join(home, '.light-agent/config.json');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

const color = {
	reset: '\x1b[0m',
	dim: '\x1b[90m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
};

function isReadlineClosedError(error: unknown) {
	return (
		error instanceof Error &&
		'code' in error &&
		(error.code === 'ABORT_ERR' || error.code === 'ERR_USE_AFTER_CLOSE')
	);
}

function formatToolLabel(name: string, args: Record<string, unknown>) {
	if (name === 'git_status' || name === 'git_diff') {
		const staged = args.staged ? ' staged' : '';
		const pathArg = typeof args.path === 'string' ? ` ${args.path}` : '';
		return `${name}${staged}${pathArg}`.trim();
	}
	if (name === 'run_command' && typeof args.command === 'string') {
		const cwd = typeof args.cwd === 'string' ? ` (cwd: ${args.cwd})` : '';
		return `${name}  ${args.command}${cwd}`;
	}
	if (name === 'grep') {
		const mode = typeof args.mode === 'string' ? ` ${args.mode}` : '';
		const query = typeof args.query === 'string' && args.query ? ` ${args.query}` : '';
		const pathArg = typeof args.path === 'string' ? ` ${args.path}` : '';
		return `${name}${mode}${query}${pathArg}`.trim();
	}
	if (typeof args.path === 'string') {
		return `${name}  ${args.path}`;
	}
	if (typeof args.query === 'string') {
		return `${name}  ${args.query}`;
	}
	return `${name}  ${JSON.stringify(args)}`;
}

function cursorUp(lines: number) {
	if (lines > 0) {
		process.stdout.write(`\x1b[${lines}A`);
	}
}

function rewriteLine(text: string) {
	writeStdout(`\x1b[2K\r${text}\n`);
}

function writeStdout(text: string) {
	if (!stdout.write(text)) {
		stdout.once('drain', () => {});
	}
}

async function main() {
	const cliArgs = parseCliArgs();
	if (cliArgs.help) {
		process.stdout.write(`${printCliHelp()}\n`);
		return;
	}

	const sessionId = path.basename(cliArgs.sessionFile, '.jsonl');
	let activeReadline: Interface | null = null;

	const sessionStore = new SessionStore({
		rootDir: path.dirname(cliArgs.sessionFile),
		sessionFile: cliArgs.sessionFile,
		traceFile: cliArgs.traceFile,
		contextFile: cliArgs.contextFile,
	});

	// -------------------------------------------

	const venderAdaptor = createClient({
		name: 'deepseek',
		apiKey: config.API_KEY as string,
		baseURL: config.API_HOST as string,
		model: 'deepseek-v4-flash',
	});

	const agent = new Agent({
		venderAdaptor,
		strategy: {
			maxTurns: cliArgs.maxTurns,
		},
		sessionId,
		store: sessionStore,
		context: {
			prompts: cliPrompts,
			strategyEnabled: cliArgs.contextStrategy,
		},
	});

	await agent.loadSession();

	agent.registerTool(readFileTool.name, readFileTool);
	agent.registerTool(writeFileTool.name, writeFileTool);
	agent.registerTool(grepTool.name, grepTool);
	agent.registerTool(searchDoc.name, searchDoc);
	agent.registerTool(gitStatusTool.name, gitStatusTool);
	agent.registerTool(gitDiffTool.name, gitDiffTool);
	agent.registerTool(runCommandTool.name, runCommandTool);

	// -------------------------------------------
	let isThinking = false;
	let isOutputting = false;
	let isExiting = false;
	let isWaitingForPrompt = false;
	let resolvePromptWait: (() => void) | null = null;
	let interruptPrinted = false;
	let toolBatchStartedAt = 0;
	let pendingActions = new Map<string, { name: string; args: Record<string, unknown> }>();
	let parallelToolLineCount = 0;

	function endThinkingLine() {
		if (isThinking) {
			writeStdout(`${color.reset}\n`);
			isThinking = false;
		}
	}

	function closeReadline() {
		if (!activeReadline) {
			return;
		}
		activeReadline.close();
		activeReadline = null;
	}

	function shutdown() {
		if (isExiting) {
			return;
		}
		isExiting = true;
		closeReadline();
	}

	function createReadline() {
		closeReadline();
		drainStdinBuffer();
		activeReadline = readline.createInterface({
			input: stdin,
			output: stdout,
			terminal: Boolean(stdin.isTTY),
		});
		return activeReadline;
	}

	function resetStreamState() {
		if (isThinking) {
			writeStdout(color.reset);
		}
		isThinking = false;
		isOutputting = false;
	}

	process.on('SIGINT', () => {
		if (isWaitingForPrompt) {
			agent.interrupt();
			resolvePromptWait?.();
			resolvePromptWait = null;
			return;
		}

		shutdown();
	});

	agent.on((event) => {
		switch (event.type) {
			case 'agent_start':
				writeStdout(`${color.green}开始执行 agent${color.reset}\n`);
				break;

			case 'thought_delta':
				if (isOutputting) {
					writeStdout('\n');
					isOutputting = false;
				}
				if (!isThinking) {
					writeStdout(`${color.dim}thinking: `);
					isThinking = true;
				}
				writeStdout(event.text);
				break;

			case 'actions': {
				endThinkingLine();

				toolBatchStartedAt = Date.now();
				pendingActions = new Map(
					event.actions.map((action) => [action.id, { name: action.name, args: action.args }]),
				);

				if (event.actions.length === 1) {
					const action = event.actions[0];
					writeStdout(`${color.yellow}tool: ${formatToolLabel(action.name, action.args)}${color.reset}\n`);
					break;
				}

				writeStdout(`${color.yellow}parallel tools (${event.actions.length}):${color.reset}\n`);
				parallelToolLineCount = event.actions.length;
				for (const action of event.actions) {
					writeStdout(`  ${color.dim}⟳${color.reset} ${formatToolLabel(action.name, action.args)}\n`);
				}
				break;
			}

			case 'observations': {
				const elapsedMs = Date.now() - toolBatchStartedAt;
				const isParallel = event.observations.length > 1;

				if (!isParallel) {
					const observation = event.observations[0];
					const action = pendingActions.get(observation.id);
					const label = action ? formatToolLabel(action.name, action.args) : observation.name;

					if (observation.isError) {
						writeStdout(
							`${color.red}tool error: ${label}${color.reset} ${color.dim}${observation.result}${color.reset}\n`,
						);
					} else {
						writeStdout(`${color.dim}tool done: ${label}${color.reset}\n`);
					}
					pendingActions.clear();
					break;
				}

				cursorUp(parallelToolLineCount);

				for (const observation of event.observations) {
					const action = pendingActions.get(observation.id);
					const label = action ? formatToolLabel(action.name, action.args) : observation.name;

					if (observation.isError) {
						rewriteLine(
							`  ${color.red}✗${color.reset} ${label} ${color.dim}${observation.result}${color.reset}`,
						);
					} else {
						rewriteLine(`  ${color.green}✓${color.reset} ${label}`);
					}
				}

				writeStdout(`${color.dim}  completed in ${elapsedMs}ms (parallel)${color.reset}\n`);
				pendingActions.clear();
				parallelToolLineCount = 0;
				break;
			}

			case 'output_delta':
				if (isThinking) {
					writeStdout(`${color.reset}\n`);
					isThinking = false;
				}
				if (!isOutputting) {
					writeStdout(`${color.green}output:${color.reset}\n`);
					isOutputting = true;
				}
				writeStdout(event.text);
				break;

			case 'agent_stop':
				resetStreamState();
				if (event.cause === 'user') {
					if (!interruptPrinted) {
						interruptPrinted = true;
						const suffix = event.message && event.message !== 'aborted' ? `: ${event.message}` : '';
						writeStdout(`\n${color.yellow}Agent interrupted${suffix}${color.reset}\n`);
					}
				} else {
					process.stderr.write(
						`\n${color.red}Agent stopped (${event.cause}): ${event.message}${color.reset}\n`,
					);
				}
				break;

			default:
				break;
		}
	});

	process.stdout.write(
		[
			`${color.dim}Session: ${cliArgs.sessionFile}${color.reset}`,
			`${color.dim}Trace:   ${cliArgs.traceFile}${color.reset}`,
			`${color.dim}Context: ${cliArgs.contextFile}${color.reset}`,
			`${color.dim}Context strategy: ${cliArgs.contextStrategy ? 'on' : 'off'}${color.reset}`,
			`${color.dim}Tip: paste multi-line prompts directly; or type """ for multiline mode. While agent runs, wait before typing.${color.reset}`,
		].join('\n') + '\n',
	);

	while (!isExiting) {
		let text = '';
		const rl = createReadline();
		try {
			text = (await readCliInput(rl, { onCancel: () => shutdown() })).trim();
		} catch (e) {
			closeReadline();
			if (isReadlineClosedError(e) || isExiting) {
				break;
			}

			throw e;
		} finally {
			closeReadline();
		}

		if (!isSubmittableCliInput(text)) {
			continue;
		}

		if (text === 'exit' || text === 'quit') {
			shutdown();
			break;
		}

		try {
			isWaitingForPrompt = true;
			interruptPrinted = false;
			isThinking = false;
			isOutputting = false;
			drainStdinBuffer();

			const promptPromise = agent.prompt(text);
			const promptWaitPromise = new Promise<'interrupted'>((resolve) => {
				resolvePromptWait = () => resolve('interrupted');
			});

			const raceResult = await Promise.race([
				promptPromise.then(() => ({ kind: 'completed' as const })),
				promptWaitPromise.then(() => ({ kind: 'interrupted' as const })),
			]);

			if (raceResult.kind === 'interrupted') {
				promptPromise.catch(() => {});
				continue;
			}

			resetStreamState();
			process.stdout.write('\n');
		} catch (e) {
			resetStreamState();
			process.stderr.write(`\n${color.red}Internal error: ${String(e)}${color.reset}\n`);

			if (agent.getState().isRunning) {
				continue;
			}

			throw e;
		} finally {
			isWaitingForPrompt = false;
			resolvePromptWait = null;
			drainStdinBuffer();
		}
	}
}

main().catch((e) => {
	if (isReadlineClosedError(e)) {
		process.exit(0);
	}

	throw e;
});
