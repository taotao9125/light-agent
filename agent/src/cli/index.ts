#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import AgentLoop from '../agent/agentLoop';
import Agent from '../agent/agent';
import SessionStore from '../agent/store';
import { createClient } from '../ai/index';


import readFileTool from './tools/readFile';
import listFilesTool from './tools/listFile';
import loadRuleSources from './loadRuleSource'
import 'dotenv/config';

setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));

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
	const deepSeekProvider = createClient({
		// 目前只支持 gemini, openai, deepseek
		vendorName: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const agentLoop = new AgentLoop({
		provider: deepSeekProvider,
		model: 'deepseek-v4-flash',
	});

	const sessionId = 'cli_session';

	const sessionStore = new SessionStore({
		rootDir: path.resolve(process.cwd(), '.agent/sessions'),
	});


	const rulesSource = await loadRuleSources(process.cwd());

	const agent = new Agent({
		agentLoop,
		sessionId,
		store: sessionStore,
		contextSource: {
			rules: rulesSource
		}
	});

	agent.registerTool(readFileTool.name, readFileTool);
	agent.registerTool(listFilesTool.name, listFilesTool);

	let isThinking = false;
	let isOutputting = false;
	let isExiting = false;
	let isWaitingForPrompt = false;
	let resolvePromptWait: (() => void) | null = null;
	let interruptPrinted = false;

	process.on('SIGINT', () => {
		if (isWaitingForPrompt) {
			agent.interrupt();
			resolvePromptWait?.();
			resolvePromptWait = null;
			isThinking = false;
			isOutputting = false;
			if (!interruptPrinted) {
				interruptPrinted = true;
				process.stdout.write(`\n${color.yellow}Agent interrupted${color.reset}\n`);
			}
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

			case 'thought_start':
				if (isOutputting) {
					process.stdout.write('\n');
					isOutputting = false;
				}
				process.stdout.write(`${color.dim}thinking: `);
				isThinking = true;
				break;

			case 'thought_delta':
				process.stdout.write(event.text);
				break;

			case 'thought_done':
				if (isThinking) {
					process.stdout.write(`${color.reset}\n`);
					isThinking = false;
				}
				break;

			case 'action_start':
				if (isThinking) {
					process.stdout.write(`${color.reset}\n`);
					isThinking = false;
				}
				process.stdout.write(
					`${color.yellow}tool: ${event.name} ${JSON.stringify(event.args)}${color.reset}\n`,
				);
				break;

			case 'action_done':
				process.stdout.write(`${color.dim}tool done: ${event.name}${color.reset}\n`);
				break;

			case 'output_start':
				if (!isOutputting) {
					process.stdout.write(`${color.green}output:${color.reset}\n`);
					isOutputting = true;
				}
				break;

			case 'output_delta':
				process.stdout.write(event.text);
				break;

			case 'agent_error':
				process.stderr.write(`\n${color.red}Agent error: ${event.message}${color.reset}\n`);
				break;

			case 'agent_aborted':
				isThinking = false;
				isOutputting = false;
				if (!interruptPrinted) {
					interruptPrinted = true;
					process.stdout.write(`\n${color.yellow}Agent interrupted${color.reset}\n`);
				}
				break;

			case 'interrupt':
				isThinking = false;
				isOutputting = false;
				if (!interruptPrinted) {
					interruptPrinted = true;
					process.stdout.write(`\n${color.yellow}Agent interrupted${color.reset}\n`);
				}
				break;

			case 'agent_done':
				isThinking = false;
				isOutputting = false;
				process.stdout.write('\n');
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
			const promptPromise = agent.prompt(text);
			const promptWaitPromise = new Promise<'interrupted'>((resolve) => {
				resolvePromptWait = () => resolve('interrupted');
			});
			const result = await Promise.race([promptPromise.then(() => 'done' as const), promptWaitPromise]);

			if (result === 'interrupted') {
				promptPromise.catch(() => {});
				continue;
			}
		} catch (e) {
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
