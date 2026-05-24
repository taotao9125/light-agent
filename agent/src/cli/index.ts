#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
 import { stdin, stdout} from 'node:process';

import Agent from '../agent/index';
import { createClient } from '../ai/index';
import toolRegistry from '../tools';
import 'dotenv/config';

setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));


const rl = readline.createInterface({
	input: stdin,
	output: stdout
})

async function main() {
	const deepSeekProvider = createClient({
		// 目前只支持 gemini, openai, deepseek
		provider: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const agent = new Agent({
		provider: deepSeekProvider,
		model: 'deepseek-v4-flash',
		toolRegistry: toolRegistry,
	});


	let isFirstOutput = false;

	agent.on((event) => {
		switch (event.type) {
			case 'agent_start':
				process.stdout.write(`\x1b[32m开始执行 agent \x1b[0m\n`);
				break;

			case 'thought_start':
				process.stdout.write(`\x1b[90m🧠 推理中: \x1b[0m`);
				break;

			case 'thought':
				// 实时打印思维流，注意不要乱换行
				// 如果文字太长，终端会自动折行，单行 \r 会失效。复杂的折行可以用 process.stdout.cursorTo
				process.stdout.write(`\x1b[90m${event.text}\x1b[0m`);
				break;

			case 'thought_done':
				// 推理结束，打个勾，换行！把这块区域锁死，后面再也别碰它了
				process.stdout.write(` \x1b[32m✓\x1b[0m\n`);
				isFirstOutput = true; // 重置输出标记
				break;

			case 'output':
				if (isFirstOutput) {
					console.log();
					process.stdout.write(`\x1b[32m🤖 Agent 输出: \x1b[0m\n`);
					isFirstOutput = false;
				}
				// 流式打印最终输出
				process.stdout.write(event.text);
				break;

			case 'agent_error':
				process.stderr.write(`\n\x1b[31mAgent error: ${event.message}\x1b[0m\n`);
				break;

			case 'agent_done':
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
		};

    if (text === 'exit' || text === 'quit') {
      rl.close();
      break;
    }

		await agent.prompt(text);
		// 下面是 debug
		const logs = agent.logs();
		fs.writeFileSync(path.join(process.cwd(), 'log.json'), JSON.stringify(logs, null, 2))
	}

	

	
}

main();
