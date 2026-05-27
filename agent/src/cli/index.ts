#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import Agent from '../agent/index';
import AgentSession from '../agent/session';
import { createClient } from '../ai/index';
import toolRegistry from '../tools';
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

async function main() {
	const deepSeekProvider = createClient({
		// 目前只支持 gemini, openai, deepseek
		vendorName: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const agent = new Agent({
		provider: deepSeekProvider,
		model: 'deepseek-v4-flash',
		tools: toolRegistry.getToolShapes(),
	});

	const session = new AgentSession({
		agent,
		sessionId: 'cli_session',
	});

	let isThinking = false;
	let isOutputting = false;

	session.on((event) => {
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
				process.stdout.write(`${color.yellow}tool: ${event.name} ${JSON.stringify(event.args)}${color.reset}\n`);
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
		const text = (await rl.question('\n> ')).trim();
		if (!text) {
			continue;
		}

		if (text === 'exit' || text === 'quit') {
			rl.close();
			break;
		}

		await session.prompt(text);

		const _y = session.getEventLog();
		const _x = _y;
	}
}

main();
