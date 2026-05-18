import OpenAIAdaptor from './providers/openai';
import GoogleGenAIAdaptor from './providers/google';
import type { ToolMeta } from '../tools/index';

type Provider = 'openai' | 'google' | 'deepseek';
type Role = 'user' | 'assistant';


type AiRequestConfig = {
	model: string;
	messages: { content: string; role: Role }[];
	tools?: ToolMeta[];
};

type AiResponse = {
	content: string;
	role: Role;
	tool_calls?: { name: string; args: unknown }[];
};

type AiStreamResponse = {
	content: string;
	role: Role;
	type: 'start' | 'text_delta' | 'end' | 'error';
}

interface AI {
	chat(requestConfig: AiRequestConfig): Promise<AiResponse>;
	stream(requestConfig: AiRequestConfig): AsyncIterable<AiStreamResponse>
}

type clientConfig = {
	provider: Provider;
	apiKey: string;
	baseURL?: string;
};


const AiProvidersFactory = new Map<Provider, new (config: clientConfig) => AI>();

// openai
AiProvidersFactory.set('openai', OpenAIAdaptor);
// deepseek 兼容 open sdk
AiProvidersFactory.set('deepseek', OpenAIAdaptor);
// google
// AiProvidersFactory.set('google', GoogleGenAIAdaptor);

// 其他 type 不用 export, input 和 output 类型都可以从 ts 内置工具函数拿到
export type CreateClient = (p: clientConfig) => AI;
export const createClient: CreateClient = (config) => {
	const { provider } = config;
	const adaptor = AiProvidersFactory.get(provider);
	if (!adaptor) throw new Error('unknow provider');
	return new adaptor(config);
};
