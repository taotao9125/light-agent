import GoogleAdaptor from './adaptors/google';
import OpenAIAdaptor from './adaptors/openai';

import type { Tool } from '../agent/tool';
import type { AgentEvent } from '../protocol/events';

export namespace Vender {
	export type Config = {
		/** 厂商名 {@example "deepseek"} */
		name: string;
		apiKey: string;
		baseURL: string;
		/** 模型名称 {@example "deepseek-v4-flash"} */
		model: string;
	};

	export type StreamInput = {
		input: AgentEvent[];
		tools?: Tool.Meta[];
		systemPrompt?: string;
	};

	export type GenerateTextInput = {
		systemPrompt?: string;
		messages: Array<{ role: 'user', content: string }>;
	};

	export type GenerateTextResult = {
		text: string;
		usage: {
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
		};
	};


	export interface Adaptor {
		stream(input: StreamInput): AsyncIterable<AgentEvent>;
		_generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
	}
}

const adaptors = new Map<string, new (vender: Vender.Config) => Vender.Adaptor>();

adaptors.set('openai', OpenAIAdaptor);
adaptors.set('deepseek', OpenAIAdaptor);
adaptors.set('google', GoogleAdaptor);

export type CreateClient = (vender: Vender.Config) => Vender.Adaptor;

export const createClient: CreateClient = (vender) => {
	const Adaptor = adaptors.get(vender.name);
	if (!Adaptor) throw new Error(`unknown vender: ${vender.name}`);
	return new Adaptor(vender);
};
