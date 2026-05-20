#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createClient } from '../ai/index';
import toolRegistry from '../tools';
import Agent from '../agent/index';
import 'dotenv/config';

import OpenAI from 'openai';

setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));

async function main() {

	const deepSeekProvider = createClient({
		// 目前只支持 gemini, openai, deepseek
		provider: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});




	// const _t = _ret;
	
	// if (_ret.toolCalls?.length) {
	// 	for (const tool of _ret.toolCalls) {
	// 		const toolName = tool.name;
	// 		const args = tool.args;
	// 		const _toolRet= await toolRegistry.get(toolName)?.execute(args, {
	// 			cwd: process.cwd()
	// 		})
	// 		const x = _toolRet;
	// 	}
	// }


	// const agent = new Agent({
	// 	provider: deepSeekProvider,
	// 	model: 'deepseek-v4-flash',
	// 	toolRegistry: toolRegistry
	// })

	// agent.on((event) => {
	// 	const _e = event;
	// 	console.log(_e)
		
	// })

	// agent.prompt([{ role: 'user', content: '帮我读下当前目录下的 package.json 文件' }]);

	

	let messages = [{ role: 'user', content: '帮我读下当前目录下的 package.json 文件' }];

	const _ret2 = deepSeekProvider.stream({
		model: 'deepseek-v4-flash',
		messages: messages,
		tools: toolRegistry.list(),
	});

	for await (const chunk of _ret2) {
		
		if (chunk.type === 'reasoning') {
			process.stdout.write(`\x1b[32m${chunk.content}\x1b[0m`);
		}

		if (chunk.type ==='text_delta') {
			process.stdout.write(chunk.content)
		}

		if (chunk.type === 'tool_call') {
			debugger;
		}
	
	}


	// const _m = _ret;

	// for await (const toolCall of ret.message.tools || []) {
	// 	const tool = toolRegistry.get(toolCall.name);
	// 	if (tool) {
	// 		tool.execute(tool.parseArgs(toolCall.args))
	// 	}

	// }
}

async function main2() {
	const client = new OpenAI({
		apiKey: process.env.AI_DEEP_SEEK_API_KEY,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST,
	});

	const {data: iter} = await client.chat.completions.create({
		model: 'deepseek-v4-flash',
		messages: [{ role: 'user', content: '1+1等于多少？直接告诉我答案，不要分析' }],
		stream: true
	}).withResponse();

	let counter = 0;
	for await (const chunk of iter) {
		process.stdout.write(chunk.choices[0].delta.content || '');
		
		if (chunk.choices[0].finish_reason) {
			debugger;
		}
	}
}

main();
