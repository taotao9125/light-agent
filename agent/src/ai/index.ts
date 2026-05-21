import type { AgentEvent } from '../protocol/events';
import type { ToolMeta } from '../tools/types';
import OpenAIAdaptor from './adaptors/openai';

type Provider = 'openai' | 'google' | 'deepseek';

export type AiRequestConfig = {
	model: string;
	input: AgentEvent[];
	tools?: ToolMeta[];
};

export interface AiProvider {
	stream(requestConfig: AiRequestConfig): AsyncIterable<AgentEvent>;
}

export type clientConfig = {
	provider: Provider;
	apiKey: string;
	baseURL?: string;
};

const AiProvidersFactory = new Map<Provider, new (config: clientConfig) => AiProvider>();

// openai
AiProvidersFactory.set('openai', OpenAIAdaptor);
// deepseek 兼容 open sdk
AiProvidersFactory.set('deepseek', OpenAIAdaptor);

// 其他 type 不用 export, input 和 output 类型都可以从 ts 内置工具函数拿到
export type CreateClient = (p: clientConfig) => AiProvider;
export const createClient: CreateClient = (config) => {
	const { provider } = config;
	const adaptor = AiProvidersFactory.get(provider);
	if (!adaptor) throw new Error('unknown provider');
	return new adaptor(config);
};
