#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createClient } from '../ai/index';
import toolFactory from '../tools';
import 'dotenv/config';

setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));

async function main() {
	const client = createClient({
		provider: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const _ret = await client.chat({
		model: 'deepseek-v4-flash',
		messages: [{ role: 'user', content: '帮我读下 package.json' }],
		tools: toolFactory.list(),
	});

	const _m = _ret;

	// for await (const toolCall of ret.message.tools || []) {
	// 	const tool = toolFactory.get(toolCall.name);
	// 	if (tool) {
	// 		tool.excute(tool.parseArgs(toolCall.args))
	// 	}

	// }
}

// async function main2() {
// 	const client = new OpenAI({
// 		apiKey: process.env.AI_DEEP_SEEK_API_KEY,
// 		baseURL: process.env.AI_DEEP_SEEK_API_HOST,
// 	});

// 	const {data: iter} = await client.chat.completions.create({
// 		model: 'deepseek-v4-flash',
// 		messages: [{ role: 'user', content: '1+1等于多少？直接告诉我答案，不要分析' }],
// 		stream: true
// 	}).withResponse();

// 	let counter = 0;
// 	for await (const thunk of iter) {
// 		process.stdout.write(thunk.choices[0].delta.content || '');
// 	}
// }

main();
