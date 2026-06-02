#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import Agent from '../agent/agent';
import SessionStore from '../agent/store';
import loadRuleSources from './loadRuleSource';
import listFilesToolNew from './tools/listFileNew';
import readFileTool from './tools/readFile';
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

async function main() {
	const sessionId = 'cli_session';

	const sessionStore = new SessionStore({
		rootDir: path.resolve(process.cwd(), '.agent/sessions'),
	});

	const rulesSource = await loadRuleSources(process.cwd());

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
			source: {
				rules: rulesSource,
			},
			contextBuildStrategy: {
				maxSingleObservationToken: 3000,
				keepRecentRounds: 5,
			},
		},
	});

	agent.registerTool(readFileTool.name, readFileTool);
	agent.registerTool(listFilesToolNew.name, listFilesToolNew);

	let isThinking = false;
	let isOutputting = false;
	let isExiting = false;
	let isWaitingForPrompt = false;
	let resolvePromptWait: (() => void) | null = null;
	let interruptPrinted = false;

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

			case 'action_call':
				if (isThinking) {
					process.stdout.write(`${color.reset}\n`);
					isThinking = false;
				}
				process.stdout.write(
					`${color.yellow}tool: ${event.name} ${JSON.stringify(event.args)}${color.reset}\n`,
				);
				break;

			case 'action_result': {
				if (event.isError) {
					const detail = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
					process.stdout.write(
						`${color.red}tool error: ${event.name}${color.reset} ${color.dim}${detail}${color.reset}\n`,
					);
				} else {
					process.stdout.write(`${color.dim}tool done: ${event.name}${color.reset}\n`);
				}
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
