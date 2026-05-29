import { type AgentEvent, EventType } from './events';

export type Context = {
	events: AgentEvent[];
	systemPrompt: string;
};
