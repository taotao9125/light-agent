#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import Agent from '../agent/agent';
import SessionStore from '../agent/store';
import { cliPrompts } from './prompts';
import listFilesToolNew from './tools/listFileNew';
import readFileTool from './tools/readFile';
import searchDoc from './tools/searchdoc';
import 'dotenv/config';

if (process.env.HTTPS_PROXY) {
	setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}

const rl = readline.createInterface({
	input: stdin,
	output: stdout,
});

const color = {
	reset: '\x1b[0m',
	dim: '\x1b[90m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
};

function isReadlineAbortError(error: unknown) {
	return error instanceof Error && 'code' in error && error.code === 'ABORT_ERR';
}

function formatToolLabel(name: string, args: Record<string, unknown>) {
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
	process.stdout.write(`\x1b[2K\r${text}\n`);
}

async function main() {
	const sessionId = 'cli_session';

	const sessionStore = new SessionStore({
		rootDir: path.resolve(process.cwd(), '.agent/sessions'),
	});

	// -------------------------------------------

	const agent = new Agent({
		vender: {
			name: 'deepseek',
			apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
			baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
			model: 'deepseek-v4-flash',
		},
		sessionId,
		store: sessionStore,
		context: {
			prompts: cliPrompts,
			strategy: {
				maxSingleObservationToken: 3000,
				keepRecentRounds: 5,
			},
		},
	});

	agent.registerTool(readFileTool.name, readFileTool);
	agent.registerTool(listFilesToolNew.name, listFilesToolNew);
	agent.registerTool(searchDoc.name, searchDoc);

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

	function resetStreamState() {
		if (isThinking) {
			process.stdout.write(color.reset);
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

		isExiting = true;
		rl.close();
	});

	agent.on((event) => {
		switch (event.type) {
			case 'agent_start':
				process.stdout.write(`${color.green}开始执行 agent${color.reset}\n`);
				break;

			case 'thought_delta':
				if (isOutputting) {
					process.stdout.write('\n');
					isOutputting = false;
				}
				if (!isThinking) {
					process.stdout.write(`${color.dim}thinking: `);
					isThinking = true;
				}
				process.stdout.write(event.text);
				break;

			case 'actions': {
				if (isThinking) {
					process.stdout.write(`${color.reset}\n`);
					isThinking = false;
				}

				toolBatchStartedAt = Date.now();
				pendingActions = new Map(
					event.actions.map((action) => [action.id, { name: action.name, args: action.args }]),
				);

				if (event.actions.length === 1) {
					const action = event.actions[0];
					process.stdout.write(
						`${color.yellow}tool: ${formatToolLabel(action.name, action.args)}${color.reset}\n`,
					);
					break;
				}

				process.stdout.write(`${color.yellow}parallel tools (${event.actions.length}):${color.reset}\n`);
				parallelToolLineCount = event.actions.length;
				for (const action of event.actions) {
					process.stdout.write(
						`  ${color.dim}⟳${color.reset} ${formatToolLabel(action.name, action.args)}\n`,
					);
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
						process.stdout.write(
							`${color.red}tool error: ${label}${color.reset} ${color.dim}${observation.result}${color.reset}\n`,
						);
					} else {
						process.stdout.write(`${color.dim}tool done: ${label}${color.reset}\n`);
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

				process.stdout.write(`${color.dim}  completed in ${elapsedMs}ms (parallel)${color.reset}\n`);
				pendingActions.clear();
				parallelToolLineCount = 0;
				break;
			}

			case 'output_delta':
				if (isThinking) {
					process.stdout.write(`${color.reset}\n`);
					isThinking = false;
				}
				if (!isOutputting) {
					process.stdout.write(`${color.green}output:${color.reset}\n`);
					isOutputting = true;
				}
				process.stdout.write(event.text);
				break;

			case 'agent_stop':
				resetStreamState();
				if (event.cause === 'user') {
					if (!interruptPrinted) {
						interruptPrinted = true;
						const suffix = event.message && event.message !== 'aborted' ? `: ${event.message}` : '';
						process.stdout.write(`\n${color.yellow}Agent interrupted${suffix}${color.reset}\n`);
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

	while (true) {
		let text = '';
		try {
			text = (await rl.question('\n> ')).trim();
		} catch (e) {
			if (isReadlineAbortError(e)) {
				isExiting = true;
				rl.close();
				break;
			}

			throw e;
		}

		if (!text) {
			continue;
		}

		if (text === 'exit' || text === 'quit') {
			isExiting = true;
			rl.close();
			break;
		}

		try {
			isWaitingForPrompt = true;
			interruptPrinted = false;
			isThinking = false;
			isOutputting = false;

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
		}

		if (isExiting) break;
	}
}

main().catch((e) => {
	if (isReadlineAbortError(e)) {
		rl.close();
		process.exit(0);
	}

	throw e;
});
