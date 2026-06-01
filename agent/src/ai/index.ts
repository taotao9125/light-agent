import type { AgentEvent } from '../protocol/events';
import type { ToolMeta } from '../tools/types';
import GoogleAdaptor from './adaptors/google';
import OpenAIAdaptor from './adaptors/openai';

// type VenderName = 'openai' | 'google' | 'deepseek';
type VenderName = string;

export type AiRequestConfig = {
	model: string;
	input: AgentEvent[];
	tools?: ToolMeta[];
	systemPrompt?: string;
};

export interface AiProvider {
	stream(requestConfig: AiRequestConfig): AsyncIterable<AgentEvent>;
}

export type clientConfig = {
	venderName: VenderName;
	apiKey: string;
	baseURL?: string;
};

const AiProvidersFactory = new Map<VenderName, new (config: clientConfig) => AiProvider>();

// openai
AiProvidersFactory.set('openai', OpenAIAdaptor);
// deepseek 兼容 open sdk
AiProvidersFactory.set('deepseek', OpenAIAdaptor);
AiProvidersFactory.set('google', GoogleAdaptor);

// 其他 type 不用 export, input 和 output 类型都可以从 ts 内置工具函数拿到
export type CreateClient = (p: clientConfig) => AiProvider;
export const createClient: CreateClient = (config) => {
	const { venderName } = config;
	const adaptor = AiProvidersFactory.get(venderName);
	if (!adaptor) throw new Error('unknown provider');
	return new adaptor(config);
};
