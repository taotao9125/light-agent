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
	AGENT_ERROR: 'agent_error',
} as const;

type Meta = {
	roundId: string;
}

export type InputEvent = {
	type: typeof EventType.INPUT;
	text: string;
	source?: 'user' | 'system';
	meta?: Meta;
};

export type ThoughtEvent = {
	type: typeof EventType.THOUGHT;
	text: string;
	meta?: Meta;
};

export type ActionEvent = {
	type: typeof EventType.ACTION;
	id: string;
	name: string;
	args: Record<string, any>;
	meta?: Meta;
};

export type ObservationEvent = {
	type: typeof EventType.OBSERVATION;
	id: string;
	name: string;
	result: any;
	meta?: Meta;
};

export type OutputEvent = {
	type: typeof EventType.OUTPUT;
	text: string;
	meta?: Meta;
};

export type AgentError = { type: typeof EventType.AGENT_ERROR; message: string ; meta?: Meta};

export type AgentStartEvent = { type: typeof EventType.AGENT_START; meta?: Meta};
export type AgentThoughtStartEvent = { type: typeof EventType.THOUGHT_START; meta?: Meta };
export type AgentThoughtDoneEvent = { type: typeof EventType.THOUGHT_DONE; meta?: Meta };
export type AgentDoneEvent = { type: typeof EventType.AGENT_DONE; meta?: Meta };


export type AgentEvent =
	| InputEvent
	| ThoughtEvent
	| ActionEvent
	| ObservationEvent
	| OutputEvent
	| AgentError
	// 下面是方便 UI 订阅的
	| AgentStartEvent
	| AgentThoughtStartEvent
	| AgentThoughtDoneEvent
	| AgentDoneEvent
	
