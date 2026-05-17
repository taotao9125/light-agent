import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';


type Provider = 'openai' | 'google';
type Role = 'user' | 'assistant' | 'system';

type Message = {
	role: Role;
	content: string;
};

type AiRequestConfig = {
	model: string;
	messages: Message[];
};

type AiResponse = {
	message: Message;
};

interface AI {
	chat(requestConfig: AiRequestConfig): Promise<AiResponse>;
}

type clientConfig = {
	provider: Provider;
	apiKey: string;
	baseURL?: string;
};

class OpenAIAdaptor implements AI {
	private client: OpenAI;
	constructor(config: clientConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	async chat(requestConfig: AiRequestConfig): Promise<AiResponse> {
		const response = await this.client.chat.completions.create({
			model: requestConfig.model,
			messages: requestConfig.messages,
		});

		return {
			message: {
				role: response.choices[0].message.role,
				content: response.choices[0].message.content ?? '',
			},
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
	async chat(requestConfig: AiRequestConfig): Promise<AiResponse> {
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


type AiConstructor = new (config: clientConfig) => AI;
const AiAdaptors = new Map<Provider, AiConstructor>();

AiAdaptors.set('openai', OpenAIAdaptor);

AiAdaptors.set('google', GoogleGenAIAdaptor);


export function createClient(config: clientConfig): AI {
	const { provider } = config;
	const adaptor = AiAdaptors.get(provider);
	if (!adaptor) throw new Error('unknow provider');
	return new adaptor(config);
}
