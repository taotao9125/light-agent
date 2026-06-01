
import type { AgentEvent } from '../protocol/events';

export type ToolMeta = {
	name: string;
	description: string;
	schema: {
		type: 'object';
		properties: Record<
			string,
			{
				type: unknown;
				description: string;
			}
		>;
		required?: string[];
		additionalProperties?: boolean;
	};
};

export type ToolContext = {
	cwd: string;
	signal?: AbortSignal;
};

export interface ToolDefinition<T, U> extends ToolMeta {
	execute(p: T, context: ToolContext): U;
}



export type Vender = {
	/** 厂商名 {@example "deepseek"} */
	name: string;
	/** api key */
	apiKey: string;
	/** base url */
	baseURL: string;
	/** 模型名称 {@example "deepseek-v4-flash"} */
	model: string;
}
export type AgentLoopConfig = {
	vender: Vender;
	strategy?: {
		maxTurns?: number;
	}
};


export type Rule = { content: string; name?: string; path?: string };

export type ContextBuildStrategy = {
	maxSingleObservationToken?: number;
	keepRecentRounds?: number;
}
export type ContextBuildInput = {
	source: {
		rules?: Rule[];
		skills?: string[];
		memories?: string[];
	}
	cwd?: string;
	contextBuildStrategy: ContextBuildStrategy
}

export type ContextBuildOuput = {
	events: AgentEvent[];
	systemPrompt: string;
};
