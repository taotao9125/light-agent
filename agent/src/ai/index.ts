import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
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

type CreateClient = (p: clientConfig) => AI;

class OpenAIAdaptor implements AI {
	private client: OpenAI;
	constructor(config: clientConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	async chat(requestConfig: Parameters<AI['chat']>[0]): ReturnType<AI['chat']> {
		const response = await this.client.chat.completions.create({
			model: requestConfig.model,
			messages: requestConfig.messages,
			tools: requestConfig.tools?.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.schema,
				},
				tool_choice: 'auto',
			})),
		});

		return {
			message: {
				role: response.choices[0].message.role,
				content: response.choices[0].message.content ?? '',
			},
			tool_calls: (response.choices[0].message.tool_calls ?? []).map((tool) => {
				return {
					name: tool.function.name,
					args: JSON.parse(tool.function.arguments),
				};
			}),
		};
	}
}

class GoogleGenAIAdaptor implements AI {
	private client: GoogleGenAI;
	constructor(config: clientConfig) {
		this.client = new GoogleGenAI({
			apiKey: config.apiKey,
		});
	}
	async chat(requestConfig: Parameters<AI['chat']>[0]): ReturnType<AI['chat']> {
		const response = await this.client.models.generateContent({
			model: requestConfig.model,
			contents: requestConfig.messages,
		});

		if (!response.candidates?.length) {
			return {
				message: {
					role: 'assistant',
					content: '',
				},
			};
		}

		return {
			message: {
				role: 'assistant',
				content: response.candidates?.[0].content?.parts?.[0].text || '',
			},
		};
	}
}

const AiProviders = new Map<Provider, new (config: clientConfig) => AI>();

// openai
AiProviders.set('openai', OpenAIAdaptor);
// deepseek 兼容 open sdk
AiProviders.set('deepseek', OpenAIAdaptor);
// google
AiProviders.set('google', GoogleGenAIAdaptor);

export const createClient: CreateClient = (config) => {
	const { provider } = config;
	const adaptor = AiProviders.get(provider);
	if (!adaptor) throw new Error('unknow provider');
	return new adaptor(config);
};
