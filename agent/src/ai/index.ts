import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';


type provider = 'openai' | 'google';
type role = 'user' | 'assistant' | 'system';

type message = {
	role: role;
	content: string;
};

type TAiRequestConfig = {
	model: string;
	messages: message[];
};

type TAiResponse = {
	message: message;
};

interface AI {
	chat(requestConfig: TAiRequestConfig): Promise<TAiResponse>;
}

type clientConfig = {
	provider: provider;
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

	async chat(requestConfig: TAiRequestConfig): Promise<TAiResponse> {
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
	async chat(requestConfig: TAiRequestConfig): Promise<TAiResponse> {
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

const AiAdaptors = new Map<provider, (p: clientConfig) => AI>();

AiAdaptors.set('openai', (config: clientConfig): AI => {
	return new OpenAIAdaptor(config);
});

AiAdaptors.set('google', (config: clientConfig): AI => {
	return new GoogleGenAIAdaptor(config);
});


export function createClient(config: clientConfig): AI {
	const { provider } = config;
	const adaptor = AiAdaptors.get(provider);
	if (!adaptor) throw new Error('unknow provider');
	return adaptor(config);
}
