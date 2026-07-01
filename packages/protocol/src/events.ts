// 推理重复循环 {Input → Thought → Actions → Observations → Output}

export const EventType = {
	INPUT: 'input',
	THOUGHT: 'thought',
	THOUGHT_DELTA: 'thought_delta',
	ACTIONS: 'actions',
	OBSERVATIONS: 'observations',
	OUTPUT: 'output',
	OUTPUT_DELTA: 'output_delta',
	AGENT_STOP: 'agent_stop',

	AGENT_TRACE: 'agent_trace',
	AGENT_SUMMARY: 'agent_summary',
} as const;

export type Meta = {
	roundId: string;
	turn: number;
};

export type InputEvent = {
	type: typeof EventType.INPUT;
	text: string;
	source?: 'user' | 'system';
	meta?: Meta;
};

export type SummaryEvent = {
	type: typeof EventType.AGENT_SUMMARY;
	text: string;
	source: 'system';
	meta?: Meta & {
		endRoundId: string;
		endTurn: number;
	};
};

export type ThoughtEvent = {
	type: typeof EventType.THOUGHT;
	text: string;
	meta?: Meta;
};

export type ThoughtDeltaEvent = {
	type: typeof EventType.THOUGHT_DELTA;
	text: string;
	meta?: Meta;
};

export type ActionsEvent = {
	type: typeof EventType.ACTIONS;
	actions: {
		id: string;
		name: string;
		args: Record<string, any>;
	}[];
	meta?: Meta;
};

export type ObservationsEvent = {
	type: typeof EventType.OBSERVATIONS;
	observations: {
		id: string;
		name: string;
		result: string;
		isError: boolean;
	}[];
	meta?: Meta;
};

export type OutputDeltaEvent = {
	type: typeof EventType.OUTPUT_DELTA;
	text: string;
	meta?: Meta;
};

export type OutputEvent = {
	type: typeof EventType.OUTPUT;
	text: string;
	meta?: Meta;
};

export type AgentStopCause = 'llm' | 'user' | 'runtime';

export type AgentStop = {
	type: typeof EventType.AGENT_STOP;
	cause: AgentStopCause;
	message: string;
	meta?: Meta;
};

export type TraceEvent = {
	type: typeof EventType.AGENT_TRACE;
	costs: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	startAt: number;
	endAt: number;
	model: string;
	meta?: Meta;
};

export type AgentEvent =
	| InputEvent
	| ThoughtEvent
	| ActionsEvent
	| ObservationsEvent
	| OutputEvent
	| AgentStop
	| ThoughtDeltaEvent
	| OutputDeltaEvent
	| TraceEvent
	| SummaryEvent;
