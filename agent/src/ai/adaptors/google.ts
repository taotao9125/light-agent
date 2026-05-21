import { GoogleGenAI } from '@google/genai';
import type { AiProvider, AiRequestConfig, clientConfig } from '../index';

export default class GoogleGenAIAdaptor {
	private client: GoogleGenAI;
	constructor(config: clientConfig) {
		this.client = new GoogleGenAI({
			apiKey: config.apiKey,
		});
	}
	async chat(requestConfig: AiRequestConfig): ReturnType<AiProvider['chat']> {
		const response = await this.client.models.generateContent({
			model: requestConfig.model,
			contents: requestConfig.messages,
		});

		if (!response.candidates?.length) {
			return {
				role: 'assistant',
				content: '',
			};
		}

		return {
			role: 'assistant',
			content: response.candidates?.[0].content?.parts?.[0].text || '',
		};
	}
}
