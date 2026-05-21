// 推理重复循环 {InputEvent → ThoughtEvent → ActionEvent → ObservationEvent }
//                   ↓
//              OutputEvent（最终输出）

export const EventType = {
	INPUT: 'input',
	THOUGHT: 'thought',
	ACTION: 'action',
	OBSERVATION: 'observation',
	OUTPUT: 'output',

	// 方便 UI 订阅
	AGENT_START: 'agent_start',
	THOUGHT_START: 'thought_start',
	THOUGHT_DONE: 'thought_done',
	AGENT_DONE: 'agent_done',
	AGNET_ERROR: 'agent_error',
} as const;

export type InputEvent = {
	type: typeof EventType.INPUT;
	text: string;
	source?: 'user' | 'system';
};

export type ThoughtEvent = {
	type: typeof EventType.THOUGHT;
	text: string;
};

export type ActionEvent = {
	type: typeof EventType.ACTION;
	id: string;
	name: string;
	args: Record<string, any>;
};

export type ObservationEvent = {
	type: typeof EventType.OBSERVATION;
	id: string;
	name: string;
	result: any;
};

export type OutputEvent = {
	type: typeof EventType.OUTPUT;
	text: string;
};

export type AgentStartEvent = { type: typeof EventType.AGENT_START };
export type AgentThoughtStartEvent = { type: typeof EventType.THOUGHT_START };
export type AgentThoughtDoneEvent = { type: typeof EventType.THOUGHT_DONE };
export type AgentDoneEvent = { type: typeof EventType.AGENT_DONE };
export type AgentError = { type: typeof EventType.AGNET_ERROR; message: string };

export type AgentEvent =
	| InputEvent
	| ThoughtEvent
	| ActionEvent
	| ObservationEvent
	| OutputEvent
	// 下面是方便 UI 订阅的
	| AgentStartEvent
	| AgentThoughtStartEvent
	| AgentThoughtDoneEvent
	| AgentDoneEvent
	| AgentError;
