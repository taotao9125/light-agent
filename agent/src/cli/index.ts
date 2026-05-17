#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createClient } from '../ai/index';
import 'dotenv/config';



setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY as string));

async function main() {
	const client = createClient({
		provider: 'openai',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const ret = await client.chat({
		model: 'deepseek-v4-flash',
		messages: [{ role: 'user', content: 'Are semicolons optional in JavaScript?' }],
	});

  console.log(ret)
  
}

main();
