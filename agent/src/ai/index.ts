import OpenAIAdaptor from './providers/openai';
import GoogleGenAIAdaptor from './providers/google';
import type { ToolMeta } from '../tools/index';

type Provider = 'openai' | 'google' | 'deepseek';
type Role = 'user' | 'assistant';

// type StreamEvent = {
// 	type: 'start' | 'text_delta' | 'end' | 'stop' | 'tool_calls'
// 	partial: Message
// }

type AiRequestConfig = {
	model: string;
	messages: { content: string; role: Role }[];
	tools?: ToolMeta[];
};

type AiResponse = {
	message: { content: string; role: Role };
	tool_calls?: { name: string; args: unknown }[];
};

interface AI {
	chat(requestConfig: AiRequestConfig): Promise<AiResponse>;
}

type clientConfig = {
	provider: Provider;
	apiKey: string;
	baseURL?: string;
};


const AiProviders = new Map<Provider, new (config: clientConfig) => AI>();

// openai
AiProviders.set('openai', OpenAIAdaptor);
// deepseek 兼容 open sdk
AiProviders.set('deepseek', OpenAIAdaptor);
// google
AiProviders.set('google', GoogleGenAIAdaptor);

// 其他不用 export, input, output类型都可以内置函数拿到
export type CreateClient = (p: clientConfig) => AI;
export const createClient: CreateClient = (config) => {
	const { provider } = config;
	const adaptor = AiProviders.get(provider);
	if (!adaptor) throw new Error('unknow provider');
	return new adaptor(config);
};
