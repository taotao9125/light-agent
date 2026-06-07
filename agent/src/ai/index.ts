import type { AgentEvent } from '../protocol/events';
import type { Tool } from '../agent/tool';
import GoogleAdaptor from './adaptors/google';
import OpenAIAdaptor from './adaptors/openai';

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

	export interface Adaptor {
		stream(input: StreamInput): AsyncIterable<AgentEvent>;
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
