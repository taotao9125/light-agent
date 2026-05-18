#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createClient } from '../ai/index';
import 'dotenv/config';


import OpenAI from 'openai';

setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));

// async function main() {
// 	const client = createClient({
// 		provider: 'deepseek',
// 		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
// 		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
// 	});

// 	const ret = await client.chat({
// 		model: 'deepseek-v4-flash',
// 		messages: [{ role: 'user', content: 'Are semicolons optional in JavaScript?' }],
// 	});


// }


async function main2() {
	const client = new OpenAI({
		apiKey: process.env.AI_DEEP_SEEK_API_KEY,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST,
	});

	const {data: iter} = await client.chat.completions.create({
		model: 'deepseek-v4-flash',
		messages: [{ role: 'user', content: 'Are semicolons optional in JavaScript?' }],
		stream: true
	}).withResponse();

	let counter = 0;
	for await (const thunk of iter) {

		process.stdout.write(thunk.choices[0].delta.content || '');
		counter++;
		if (counter >= 10) debugger;
	}
}

main2();
